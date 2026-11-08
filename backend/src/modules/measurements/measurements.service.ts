import { Injectable } from "@nestjs/common";
import { Measurement, Prisma, SignalQuality } from "@prisma/client";
import { ERROR_CODES } from "../../common/constants";
import { AppException } from "../../common/errors/app.exception";
import { decodeCursor, encodeCursor } from "../../common/pagination/cursor";
import { PrismaService } from "../../prisma/prisma.service";
import { DevicesService } from "../devices/devices.service";
import { ListMeasurementsQueryDto } from "./dto/list-measurements-query.dto";
import { SeriesBucket, SeriesQueryDto } from "./dto/series-query.dto";
import { LatestMeasurementQueryDto } from "./dto/latest-measurement-query.dto";

const PARAMETER_COLUMN: Record<
  "HEART_RATE" | "SPO2" | "TEMPERATURE",
  "heartRate" | "spo2" | "temperature"
> = {
  HEART_RATE: "heartRate",
  SPO2: "spo2",
  TEMPERATURE: "temperature",
};

const BUCKET_MS: Record<SeriesBucket, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

const MAX_SERIES_BUCKETS = 5_000;

@Injectable()
export class MeasurementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devicesService: DevicesService,
  ) {}

  async list(userId: string, query: ListMeasurementsQueryDto) {
    if (query.deviceId) {
      await this.devicesService.assertAccess(userId, query.deviceId);
    }

    const limit = query.limit ?? 50;
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from > to) {
      throw AppException.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        "from must be earlier than to.",
      );
    }

    const where: Prisma.MeasurementWhereInput = { userId };
    if (query.deviceId) {
      where.deviceId = query.deviceId;
    }
    if (query.parameter) {
      where[PARAMETER_COLUMN[query.parameter]] = { not: null };
    }
    if (from || to) {
      where.measuredAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const cursor = decodeCursor(query.cursor);
    if (cursor) {
      where.OR = [
        { measuredAt: { lt: cursor.date } },
        { measuredAt: cursor.date, id: { lt: cursor.id } },
      ];
    }

    const rows = await this.prisma.measurement.findMany({
      where,
      orderBy: [{ measuredAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];

    return {
      items: items.map(toMeasurementDto),
      meta: {
        limit,
        hasMore,
        nextCursor:
          hasMore && last ? encodeCursor(last.measuredAt, last.id) : null,
      },
    };
  }

  async latest(userId: string, query: LatestMeasurementQueryDto) {
    if (query.deviceId) {
      await this.devicesService.assertAccess(userId, query.deviceId);
    }

    const measurement = await this.prisma.measurement.findFirst({
      where: {
        userId,
        ...(query.deviceId ? { deviceId: query.deviceId } : {}),
      },
      orderBy: [{ measuredAt: "desc" }, { id: "desc" }],
    });

    return measurement ? toMeasurementDto(measurement) : null;
  }

  async get(userId: string, id: string) {
    const measurement = await this.prisma.measurement.findFirst({
      where: { id, userId },
    });
    if (!measurement) {
      throw AppException.notFound(
        ERROR_CODES.MEASUREMENT_NOT_FOUND,
        "Measurement not found.",
      );
    }
    return toMeasurementDto(measurement);
  }

  async series(userId: string, query: SeriesQueryDto) {
    if (query.deviceId) {
      await this.devicesService.assertAccess(userId, query.deviceId);
    }

    const bucket = query.bucket ?? "5m";
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (from > to) {
      throw AppException.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        "from must be earlier than to.",
      );
    }

    const bucketCount = (to.getTime() - from.getTime()) / BUCKET_MS[bucket];
    if (bucketCount > MAX_SERIES_BUCKETS) {
      throw AppException.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        `The requested range produces more than ${MAX_SERIES_BUCKETS} data points. Use a larger bucket or a narrower range.`,
      );
    }

    const column = query.parameter
      ? Prisma.raw(`"${PARAMETER_COLUMN[query.parameter]}"`)
      : undefined;
    const deviceFilter = query.deviceId
      ? Prisma.sql`AND "device_id" = ${query.deviceId}::uuid`
      : Prisma.empty;
    const parameterFilter = column
      ? Prisma.sql`AND ${column} IS NOT NULL`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      Array<{
        bucket: Date;
        heartRate: number | null;
        spo2: number | null;
        temperature: number | null;
        sampleCount: number;
      }>
    >(Prisma.sql`
      SELECT
        date_bin(${bucket}::interval, "measured_at", TIMESTAMPTZ '2000-01-01') AS "bucket",
        AVG("heart_rate")::float8 AS "heartRate",
        AVG("spo2")::float8 AS "spo2",
        AVG("temperature")::float8 AS "temperature",
        COUNT(*)::int AS "sampleCount"
      FROM "measurements"
      WHERE "user_id" = ${userId}::uuid
        AND "measured_at" >= ${from}
        AND "measured_at" <= ${to}
        ${deviceFilter}
        ${parameterFilter}
      GROUP BY 1
      ORDER BY 1 ASC
    `);

    return rows;
  }
}

export function toMeasurementDto(measurement: Measurement) {
  return {
    id: measurement.id,
    deviceId: measurement.deviceId,
    userId: measurement.userId,
    messageId: measurement.messageId,
    sequence:
      measurement.sequence === null ? null : Number(measurement.sequence),
    heartRate: measurement.heartRate,
    spo2: measurement.spo2,
    temperature:
      measurement.temperature === null ? null : Number(measurement.temperature),
    signalQuality: measurement.signalQuality as SignalQuality,
    measuredAt: measurement.measuredAt,
    receivedAt: measurement.receivedAt,
  };
}
