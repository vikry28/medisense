import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DeviceStatus } from "@prisma/client";
import { connect, IClientOptions, MqttClient } from "mqtt";
import { readFileSync } from "node:fs";
import { DevicesService } from "../devices/devices.service";
import {
  MeasurementIngestionService,
  TelemetryRejectedError,
} from "../measurements/measurement-ingestion.service";
import { TelemetryValidationError } from "../measurements/telemetry.validator";

interface StatusPayload {
  status: DeviceStatus;
  firmwareVersion?: string;
}

@Injectable()
export class MqttService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MqttService.name);
  private readonly enabled: boolean;
  private readonly topicPattern: RegExp;
  private client?: MqttClient;

  constructor(
    private readonly config: ConfigService,
    private readonly ingestionService: MeasurementIngestionService,
    private readonly devicesService: DevicesService,
  ) {
    this.enabled = this.config.get<boolean>("MQTT_ENABLED", true);
    const prefix = this.config.get<string>("MQTT_TOPIC_PREFIX", "medisense");
    this.topicPattern = new RegExp(
      `^${escapeRegExp(prefix)}/device/([^/]+)/(telemetry|status)$`,
    );
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.warn("MQTT ingestion is disabled (MQTT_ENABLED=false)");
      return;
    }

    const options: IClientOptions = {
      clientId: this.config.get<string>("MQTT_CLIENT_ID", "medisense-backend"),
      username: this.config.get<string>("MQTT_USERNAME") || undefined,
      password: this.config.get<string>("MQTT_PASSWORD") || undefined,
      clean: false,
      reconnectPeriod: 5_000,
      connectTimeout: 10_000,
      rejectUnauthorized: this.config.get<boolean>(
        "MQTT_REJECT_UNAUTHORIZED",
        true,
      ),
    };
    this.loadTlsMaterial(options);

    const url = this.config.get<string>("MQTT_URL", "mqtt://localhost:1883");
    this.logger.log(`Connecting to MQTT broker at ${url}`);
    this.client = connect(url, options);

    this.client.on("connect", () => {
      const prefix = this.config.get<string>("MQTT_TOPIC_PREFIX", "medisense");
      const topics = [
        `${prefix}/device/+/telemetry`,
        `${prefix}/device/+/status`,
      ];
      this.client?.subscribe(topics, { qos: 1 }, (error) => {
        if (error) {
          this.logger.error({ err: error }, "MQTT subscription failed");
          return;
        }
        this.logger.log(`Subscribed to ${topics.join(", ")}`);
      });
    });

    this.client.on("reconnect", () => this.logger.warn("Reconnecting to MQTT"));
    this.client.on("offline", () => this.logger.warn("MQTT client is offline"));
    this.client.on("error", (error) =>
      this.logger.error({ err: error }, "MQTT client error"),
    );
    this.client.on("message", (topic, payload) => {
      void this.handleMessage(topic, payload).catch((error) => {
        this.logger.error(
          { err: error, topic },
          "Unhandled MQTT message error",
        );
      });
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.client) {
      return;
    }
    const client = this.client;
    this.client = undefined;
    await new Promise<void>((resolve) =>
      client.end(false, {}, () => resolve()),
    );
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isConnected(): boolean {
    return this.client?.connected ?? false;
  }

  private loadTlsMaterial(options: IClientOptions): void {
    const caPath = this.config.get<string>("MQTT_CA_PATH");
    const certPath = this.config.get<string>("MQTT_CERT_PATH");
    const keyPath = this.config.get<string>("MQTT_KEY_PATH");

    if (caPath) {
      options.ca = this.readTlsFile("MQTT_CA_PATH", caPath);
    }
    if (certPath) {
      options.cert = this.readTlsFile("MQTT_CERT_PATH", certPath);
    }
    if (keyPath) {
      options.key = this.readTlsFile("MQTT_KEY_PATH", keyPath);
    }
  }

  private readTlsFile(name: string, path: string): Buffer {
    try {
      return readFileSync(path);
    } catch (error) {
      throw new Error(
        `Unable to read ${name} at "${path}": ${(error as Error).message}`,
      );
    }
  }

  private async handleMessage(topic: string, raw: Buffer): Promise<void> {
    const match = this.topicPattern.exec(topic);
    if (!match) {
      return;
    }

    const deviceCode = match[1];
    const kind = match[2];

    if (kind === "telemetry") {
      await this.handleTelemetry(deviceCode, raw);
      return;
    }

    await this.handleStatus(deviceCode, raw);
  }

  private async handleTelemetry(
    deviceCode: string,
    raw: Buffer,
  ): Promise<void> {
    try {
      const result = await this.ingestionService.ingest(deviceCode, raw);
      if (result.status === "stored") {
        this.logger.debug(
          `Stored measurement ${result.measurement.id} for ${deviceCode}`,
        );
      }
    } catch (error) {
      if (error instanceof TelemetryValidationError) {
        this.logger.warn(
          `Rejected telemetry from ${deviceCode}: ${error.code} - ${error.message}`,
        );
        return;
      }
      if (error instanceof TelemetryRejectedError) {
        this.logger.warn(
          `Rejected telemetry from ${deviceCode}: ${error.code} - ${error.message}`,
        );
        return;
      }
      throw error;
    }
  }

  private async handleStatus(deviceCode: string, raw: Buffer): Promise<void> {
    let payload: StatusPayload;
    try {
      payload = parseStatusPayload(raw);
    } catch (error) {
      this.logger.warn(
        `Rejected status from ${deviceCode}: ${(error as Error).message}`,
      );
      return;
    }

    const result = await this.devicesService.setStatusFromMqtt(
      deviceCode,
      payload,
    );
    if (!result) {
      this.logger.debug(`Ignored status for unpaired device ${deviceCode}`);
      return;
    }
    this.logger.debug(`Device ${deviceCode} status is now ${payload.status}`);
  }
}

function parseStatusPayload(raw: Buffer): StatusPayload {
  let value: unknown;
  try {
    value = JSON.parse(raw.toString());
  } catch {
    throw new Error("payload is not valid JSON");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("payload must be a JSON object");
  }

  const data = value as Record<string, unknown>;
  const status =
    typeof data.status === "string" ? data.status.toLowerCase() : "";
  if (status !== "online" && status !== "offline") {
    throw new Error('status must be "online" or "offline"');
  }

  const firmwareVersion =
    typeof data.firmwareVersion === "string" &&
    data.firmwareVersion.length <= 32
      ? data.firmwareVersion
      : undefined;

  return {
    status: status === "online" ? DeviceStatus.ONLINE : DeviceStatus.OFFLINE,
    ...(firmwareVersion ? { firmwareVersion } : {}),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
