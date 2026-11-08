import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import {
  SignalQualityKey,
  TelemetryPayloadDto,
} from "./dto/telemetry-payload.dto";

export class TelemetryValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "TelemetryValidationError";
  }
}

export interface NormalizedTelemetry {
  deviceCode: string;
  messageId: string;
  sequence?: number;
  measuredAt: Date;
  heartRate?: number;
  spo2?: number;
  temperature?: number;
  signalQuality: SignalQualityKey;
  firmwareVersion?: string;
}

const MAX_PAST_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 5 * 60 * 1000;

export async function parseTelemetryPayload(
  raw: Buffer | string | unknown,
  topicDeviceCode: string,
  now = new Date(),
): Promise<NormalizedTelemetry> {
  let value: unknown = raw;
  if (Buffer.isBuffer(raw) || typeof raw === "string") {
    try {
      value = JSON.parse(raw.toString());
    } catch {
      throw new TelemetryValidationError(
        "INVALID_JSON",
        "Telemetry payload is not valid JSON.",
      );
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TelemetryValidationError(
      "INVALID_PAYLOAD",
      "Telemetry payload must be a JSON object.",
    );
  }

  const dto = plainToInstance(TelemetryPayloadDto, value);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
    validationError: { target: false, value: false },
  });

  if (errors.length > 0) {
    throw new TelemetryValidationError(
      "INVALID_PAYLOAD",
      "Telemetry payload validation failed.",
      flattenErrors(errors),
    );
  }

  if (dto.deviceCode !== topicDeviceCode) {
    throw new TelemetryValidationError(
      "DEVICE_MISMATCH",
      "The deviceCode in the payload does not match the MQTT topic.",
    );
  }

  const measuredAt = new Date(dto.timestamp);
  if (
    measuredAt.getTime() < now.getTime() - MAX_PAST_MS ||
    measuredAt.getTime() > now.getTime() + MAX_FUTURE_MS
  ) {
    throw new TelemetryValidationError(
      "TIMESTAMP_OUT_OF_RANGE",
      "The measurement timestamp is outside the accepted window.",
    );
  }

  const { heartRate, spo2, temperature } = dto.measurements;
  if (
    heartRate === undefined &&
    spo2 === undefined &&
    temperature === undefined
  ) {
    throw new TelemetryValidationError(
      "NO_MEASUREMENTS",
      "At least one measurement value is required.",
    );
  }

  return {
    deviceCode: dto.deviceCode,
    messageId: dto.messageId,
    ...(dto.sequence === undefined ? {} : { sequence: dto.sequence }),
    measuredAt,
    ...(heartRate === undefined ? {} : { heartRate }),
    ...(spo2 === undefined ? {} : { spo2 }),
    ...(temperature === undefined ? {} : { temperature }),
    signalQuality: dto.signalQuality ?? SignalQualityKey.GOOD,
    ...(dto.firmwareVersion === undefined
      ? {}
      : { firmwareVersion: dto.firmwareVersion }),
  };
}

function flattenErrors(
  errors: ValidationError[],
  parent = "",
): Array<{ field: string; messages: string[] }> {
  const output: Array<{ field: string; messages: string[] }> = [];
  for (const error of errors) {
    const field = parent ? `${parent}.${error.property}` : error.property;
    if (error.constraints) {
      output.push({ field, messages: Object.values(error.constraints) });
    }
    if (error.children?.length) {
      output.push(...flattenErrors(error.children, field));
    }
  }
  return output;
}
