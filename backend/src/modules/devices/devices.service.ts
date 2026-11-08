import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Device, DeviceAssignment, DeviceStatus, Prisma } from "@prisma/client";
import { randomInt } from "node:crypto";
import { ERROR_CODES } from "../../common/constants";
import { EVENTS } from "../../common/events";
import { AppException } from "../../common/errors/app.exception";
import { hmacSha256, safeEqualHex } from "../../common/utils/hash";
import { PrismaService } from "../../prisma/prisma.service";
import { PairDeviceDto } from "./dto/pair-device.dto";
import { UpdateDeviceDto } from "./dto/update-device.dto";

type DeviceWithAssignment = Device & { assignments: DeviceAssignment[] };

export interface DeviceStatusEvent {
  userId: string;
  deviceId: string;
  deviceCode: string;
  status: DeviceStatus;
  lastSeenAt: Date | null;
}

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);
  private readonly pairingPepper: string;
  private readonly pairingTtlMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {
    this.pairingPepper = this.config.getOrThrow<string>("PAIRING_CODE_PEPPER");
    this.pairingTtlMinutes = this.config.get<number>(
      "PAIRING_CODE_TTL_MINUTES",
      15,
    );
  }

  async list(userId: string) {
    const rows = await this.prisma.deviceAssignment.findMany({
      where: { userId, unassignedAt: null },
      include: { device: true },
      orderBy: { assignedAt: "desc" },
    });
    return rows.map((row) => toDeviceDto(row.device, row.assignedAt));
  }

  async get(userId: string, deviceId: string) {
    const { device, assignment } = await this.assertAccess(userId, deviceId);
    return toDeviceDto(device, assignment.assignedAt);
  }

  async pair(userId: string, dto: PairDeviceDto) {
    const device = await this.prisma.device.findUnique({
      where: { deviceCode: dto.deviceCode },
    });
    if (!device) {
      throw AppException.notFound(
        ERROR_CODES.DEVICE_NOT_FOUND,
        "Device not found.",
      );
    }

    const active = await this.prisma.deviceAssignment.findFirst({
      where: { deviceId: device.id, unassignedAt: null },
    });
    if (active) {
      throw AppException.conflict(
        ERROR_CODES.DEVICE_ALREADY_PAIRED,
        "This device is already paired with an account.",
      );
    }

    const pairingCode = dto.pairingCode?.trim() || undefined;
    const developmentPairing =
      pairingCode === undefined && this.isDevelopmentPairingAllowed();

    if (!developmentPairing) {
      if (!pairingCode) {
        throw AppException.badRequest(
          ERROR_CODES.DEVICE_PAIRING_CODE_INVALID,
          "A pairing code is required.",
        );
      }

      if (!device.pairingCodeHash || !device.pairingCodeExpiresAt) {
        throw AppException.badRequest(
          ERROR_CODES.DEVICE_PAIRING_CODE_INVALID,
          "This device does not have an active pairing code.",
        );
      }

      if (device.pairingCodeExpiresAt.getTime() <= Date.now()) {
        throw AppException.badRequest(
          ERROR_CODES.DEVICE_PAIRING_CODE_EXPIRED,
          "The pairing code has expired. Generate a new code on the device.",
        );
      }

      const expected = this.hashPairingCode(device.deviceCode, pairingCode);
      if (!safeEqualHex(expected, device.pairingCodeHash)) {
        throw AppException.badRequest(
          ERROR_CODES.DEVICE_PAIRING_CODE_INVALID,
          "The pairing code is invalid.",
        );
      }
    } else {
      this.logger.warn(
        `Development pairing by deviceCode only used for ${device.deviceCode}`,
      );
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const assignment = await tx.deviceAssignment.create({
          data: { userId, deviceId: device.id },
        });
        const updated = await tx.device.update({
          where: { id: device.id },
          data: {
            name: dto.name?.trim() ?? device.name,
            pairingCodeHash: null,
            pairingCodeExpiresAt: null,
          },
        });
        return { assignment, device: updated };
      });

      return toDeviceDto(result.device, result.assignment.assignedAt);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw AppException.conflict(
          ERROR_CODES.DEVICE_ALREADY_PAIRED,
          "This device is already paired with an account.",
        );
      }
      throw error;
    }
  }

  async rename(userId: string, deviceId: string, dto: UpdateDeviceDto) {
    await this.assertAccess(userId, deviceId);
    const device = await this.prisma.device.update({
      where: { id: deviceId },
      data: { name: dto.name.trim() },
    });
    return toDeviceDto(device);
  }

  async unpair(userId: string, deviceId: string): Promise<void> {
    const { device, assignment } = await this.assertAccess(userId, deviceId);

    await this.prisma.$transaction(async (tx) => {
      await tx.deviceAssignment.update({
        where: { id: assignment.id },
        data: { unassignedAt: new Date() },
      });
      await tx.device.update({
        where: { id: deviceId },
        data: { status: DeviceStatus.OFFLINE },
      });
    });

    this.events.emit(EVENTS.DEVICE_STATUS_CHANGED, {
      userId,
      deviceId,
      deviceCode: device.deviceCode,
      status: DeviceStatus.OFFLINE,
      lastSeenAt: device.lastSeenAt,
    } satisfies DeviceStatusEvent);
  }

  async regeneratePairingCode(userId: string, deviceId: string) {
    const assignment = await this.prisma.deviceAssignment.findFirst({
      where: { userId, deviceId },
      include: { device: true },
      orderBy: { assignedAt: "desc" },
    });
    if (!assignment) {
      throw AppException.notFound(
        ERROR_CODES.DEVICE_NOT_FOUND,
        "Device not found.",
      );
    }

    const active = await this.prisma.deviceAssignment.findFirst({
      where: { deviceId, unassignedAt: null },
    });
    if (active) {
      throw AppException.conflict(
        ERROR_CODES.DEVICE_ALREADY_PAIRED,
        "Unpair the device before generating a new pairing code.",
      );
    }

    const { device } = assignment;
    const pairingCode = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const expiresAt = new Date(Date.now() + this.pairingTtlMinutes * 60 * 1000);

    await this.prisma.device.update({
      where: { id: deviceId },
      data: {
        pairingCodeHash: this.hashPairingCode(device.deviceCode, pairingCode),
        pairingCodeExpiresAt: expiresAt,
      },
    });

    return { pairingCode, expiresAt };
  }

  async assertAccess(
    userId: string,
    deviceId: string,
  ): Promise<{ device: Device; assignment: DeviceAssignment }> {
    const assignment = await this.prisma.deviceAssignment.findFirst({
      where: { userId, deviceId, unassignedAt: null },
      include: { device: true },
    });

    if (!assignment) {
      throw AppException.notFound(
        ERROR_CODES.DEVICE_NOT_FOUND,
        "Device not found.",
      );
    }

    return { device: assignment.device, assignment };
  }

  async findActiveByCode(
    deviceCode: string,
  ): Promise<DeviceWithAssignment | null> {
    return this.prisma.device.findUnique({
      where: { deviceCode },
      include: { assignments: { where: { unassignedAt: null }, take: 1 } },
    });
  }

  async markSeen(
    deviceId: string,
    firmwareVersion?: string,
  ): Promise<{
    device: Device;
    userId: string | null;
    statusChanged: boolean;
  } | null> {
    const current = await this.prisma.device.findUnique({
      where: { id: deviceId },
      include: { assignments: { where: { unassignedAt: null }, take: 1 } },
    });
    if (!current) {
      return null;
    }

    const assignment = current.assignments[0];
    if (!assignment) {
      return { device: current, userId: null, statusChanged: false };
    }

    const previousStatus = current.status;
    const device = await this.prisma.device.update({
      where: { id: deviceId },
      data: {
        status: DeviceStatus.ONLINE,
        lastSeenAt: new Date(),
        ...(firmwareVersion ? { firmwareVersion } : {}),
      },
    });

    const statusChanged = previousStatus !== DeviceStatus.ONLINE;
    if (statusChanged) {
      this.emitStatus(assignment.userId, device);
    }

    return { device, userId: assignment.userId, statusChanged };
  }

  async setOffline(deviceId: string): Promise<void> {
    const current = await this.prisma.device.findUnique({
      where: { id: deviceId },
      include: { assignments: { where: { unassignedAt: null }, take: 1 } },
    });
    if (!current) {
      return;
    }

    const device = await this.prisma.device.update({
      where: { id: deviceId },
      data: { status: DeviceStatus.OFFLINE },
    });

    const userId = current.assignments[0]?.userId;
    if (userId && current.status !== DeviceStatus.OFFLINE) {
      this.emitStatus(userId, device);
    }
  }

  async setStatusFromMqtt(
    deviceCode: string,
    payload: { status: DeviceStatus; firmwareVersion?: string },
  ) {
    const device = await this.findActiveByCode(deviceCode);
    if (!device) {
      return null;
    }
    const assignment = device.assignments[0];
    if (!assignment) {
      return null;
    }

    const updated = await this.prisma.device.update({
      where: { id: device.id },
      data: {
        status: payload.status,
        ...(payload.status === DeviceStatus.ONLINE
          ? { lastSeenAt: new Date() }
          : {}),
        ...(payload.firmwareVersion
          ? { firmwareVersion: payload.firmwareVersion }
          : {}),
      },
    });

    if (device.status !== updated.status) {
      this.emitStatus(assignment.userId, updated);
    }

    return { device: updated, userId: assignment.userId };
  }

  async sweepOffline(thresholdSeconds: number): Promise<number> {
    const cutoff = new Date(Date.now() - thresholdSeconds * 1000);
    const stale = await this.prisma.device.findMany({
      where: { status: DeviceStatus.ONLINE, lastSeenAt: { lt: cutoff } },
      include: { assignments: { where: { unassignedAt: null }, take: 1 } },
    });

    let updatedCount = 0;
    for (const device of stale) {
      const updated = await this.prisma.device.update({
        where: { id: device.id },
        data: { status: DeviceStatus.OFFLINE },
      });
      updatedCount += 1;

      const userId = device.assignments[0]?.userId;
      if (userId) {
        this.emitStatus(userId, updated);
      }
    }

    return updatedCount;
  }

  hashPairingCode(deviceCode: string, pairingCode: string): string {
    return hmacSha256(`${deviceCode}:${pairingCode}`, this.pairingPepper);
  }

  private isDevelopmentPairingAllowed(): boolean {
    return this.config.get<boolean>("PAIRING_ALLOW_DEVICE_CODE", false);
  }

  private emitStatus(userId: string, device: Device): void {
    this.events.emit(EVENTS.DEVICE_STATUS_CHANGED, {
      userId,
      deviceId: device.id,
      deviceCode: device.deviceCode,
      status: device.status,
      lastSeenAt: device.lastSeenAt,
    } satisfies DeviceStatusEvent);
  }
}

export function toDeviceDto(device: Device, assignedAt?: Date) {
  return {
    id: device.id,
    deviceCode: device.deviceCode,
    name: device.name,
    type: device.type,
    status: device.status,
    firmwareVersion: device.firmwareVersion,
    lastSeenAt: device.lastSeenAt,
    ...(assignedAt ? { assignedAt } : {}),
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
  };
}
