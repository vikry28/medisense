import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  DeviceStatus,
  Measurement,
  Prisma,
  SignalQuality,
} from "@prisma/client";
import { EVENTS } from "../../common/events";
import { PrismaService } from "../../prisma/prisma.service";
import { AlertsService, toAlertDto } from "../alerts/alerts.service";
import { DeviceStatusEvent, DevicesService } from "../devices/devices.service";
import { toMeasurementDto } from "./measurements.service";
import {
  NormalizedTelemetry,
  parseTelemetryPayload,
} from "./telemetry.validator";

export class TelemetryRejectedError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TelemetryRejectedError";
  }
}

export type IngestionResult =
  | { status: "stored"; measurement: Measurement }
  | { status: "duplicate"; messageId: string };

@Injectable()
export class MeasurementIngestionService {
  private readonly logger = new Logger(MeasurementIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly devicesService: DevicesService,
    private readonly alertsService: AlertsService,
    private readonly events: EventEmitter2,
  ) {}

  async ingest(
    topicDeviceCode: string,
    rawPayload: Buffer | string,
  ): Promise<IngestionResult> {
    const payload = await parseTelemetryPayload(rawPayload, topicDeviceCode);

    const device = await this.devicesService.findActiveByCode(topicDeviceCode);
    if (!device) {
      throw new TelemetryRejectedError(
        "DEVICE_NOT_FOUND",
        `Unknown device ${topicDeviceCode}.`,
      );
    }

    const assignment = device.assignments[0];
    if (!assignment) {
      throw new TelemetryRejectedError(
        "DEVICE_NOT_PAIRED",
        `Device ${topicDeviceCode} is not paired with any account.`,
      );
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const measurement = await tx.measurement.create({
          data: {
            deviceId: device.id,
            userId: assignment.userId,
            messageId: payload.messageId,
            ...(payload.sequence === undefined
              ? {}
              : { sequence: BigInt(payload.sequence) }),
            ...(payload.heartRate === undefined
              ? {}
              : { heartRate: payload.heartRate }),
            ...(payload.spo2 === undefined ? {} : { spo2: payload.spo2 }),
            ...(payload.temperature === undefined
              ? {}
              : { temperature: payload.temperature }),
            signalQuality: payload.signalQuality as SignalQuality,
            measuredAt: payload.measuredAt,
          },
        });

        const updatedDevice = await tx.device.update({
          where: { id: device.id },
          data: {
            status: DeviceStatus.ONLINE,
            lastSeenAt: new Date(),
            ...(payload.firmwareVersion
              ? { firmwareVersion: payload.firmwareVersion }
              : {}),
          },
        });

        const alerts = await this.alertsService.evaluateAndCreate(
          tx,
          assignment.userId,
          measurement,
        );

        return {
          measurement,
          alerts,
          device: updatedDevice,
          statusChanged: device.status !== DeviceStatus.ONLINE,
        };
      });

      this.emitStoredEvents(
        assignment.userId,
        topicDeviceCode,
        payload,
        result,
      );

      return { status: "stored", measurement: result.measurement };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        this.logger.debug(
          `Duplicate telemetry ignored for ${topicDeviceCode} (${payload.messageId})`,
        );
        return { status: "duplicate", messageId: payload.messageId };
      }
      throw error;
    }
  }

  private emitStoredEvents(
    userId: string,
    deviceCode: string,
    payload: NormalizedTelemetry,
    result: {
      measurement: Measurement;
      alerts: Awaited<ReturnType<AlertsService["evaluateAndCreate"]>>;
      device: {
        id: string;
        deviceCode: string;
        status: DeviceStatus;
        lastSeenAt: Date | null;
      };
      statusChanged: boolean;
    },
  ): void {
    this.events.emit(EVENTS.MEASUREMENT_CREATED, {
      userId,
      deviceId: result.measurement.deviceId,
      deviceCode,
      measurement: toMeasurementDto(result.measurement),
      signalQuality: payload.signalQuality,
    });

    for (const alert of result.alerts) {
      this.events.emit(EVENTS.ALERT_CREATED, {
        userId,
        alert: toAlertDto(alert),
      });
    }

    if (result.statusChanged) {
      this.events.emit(EVENTS.DEVICE_STATUS_CHANGED, {
        userId,
        deviceId: result.device.id,
        deviceCode: result.device.deviceCode,
        status: result.device.status,
        lastSeenAt: result.device.lastSeenAt,
      } satisfies DeviceStatusEvent);
    }
  }
}
