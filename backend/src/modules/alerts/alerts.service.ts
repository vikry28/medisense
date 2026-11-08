import { Injectable } from "@nestjs/common";
import {
  Alert,
  AlertConfig,
  AlertParameter,
  AlertStatus,
  Measurement,
  Prisma,
} from "@prisma/client";
import { ERROR_CODES } from "../../common/constants";
import { AppException } from "../../common/errors/app.exception";
import { decodeCursor, encodeCursor } from "../../common/pagination/cursor";
import { PrismaService } from "../../prisma/prisma.service";
import {
  AlertEvaluator,
  AlertParameterKey,
  AlertThreshold,
  DEFAULT_THRESHOLDS,
} from "./alert-evaluator";
import { AlertConfigItemDto } from "./dto/update-alert-configs.dto";
import { ListAlertsQueryDto } from "./dto/list-alerts-query.dto";

const MEASUREMENT_FIELD: Record<
  AlertParameterKey,
  "heartRate" | "spo2" | "temperature"
> = {
  [AlertParameterKey.HEART_RATE]: "heartRate",
  [AlertParameterKey.SPO2]: "spo2",
  [AlertParameterKey.TEMPERATURE]: "temperature",
};

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evaluator: AlertEvaluator,
  ) {}

  async ensureDefaults(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    await db.alertConfig.createMany({
      data: Object.entries(DEFAULT_THRESHOLDS).map(
        ([parameter, threshold]) => ({
          userId,
          parameter: parameter as AlertParameter,
          minValue: threshold.minValue,
          maxValue: threshold.maxValue,
          enabled: threshold.enabled,
        }),
      ),
      skipDuplicates: true,
    });
  }

  async getConfigs(userId: string) {
    const rows = await this.prisma.alertConfig.findMany({
      where: { userId },
      orderBy: { parameter: "asc" },
    });
    return this.mergeConfigs(rows);
  }

  async updateConfigs(userId: string, configs: AlertConfigItemDto[]) {
    const seen = new Set<string>();
    for (const item of configs) {
      if (seen.has(item.parameter)) {
        throw AppException.badRequest(
          ERROR_CODES.VALIDATION_ERROR,
          `Duplicate configuration for parameter ${item.parameter}.`,
        );
      }
      seen.add(item.parameter);

      if (
        item.minValue !== undefined &&
        item.minValue !== null &&
        item.maxValue !== undefined &&
        item.maxValue !== null &&
        item.minValue > item.maxValue
      ) {
        throw AppException.badRequest(
          ERROR_CODES.VALIDATION_ERROR,
          `minValue cannot be greater than maxValue for ${item.parameter}.`,
        );
      }
    }

    await this.prisma.$transaction(
      configs.map((item) =>
        this.prisma.alertConfig.upsert({
          where: {
            userId_parameter: {
              userId,
              parameter: item.parameter as AlertParameter,
            },
          },
          create: {
            userId,
            parameter: item.parameter as AlertParameter,
            minValue: item.minValue ?? null,
            maxValue: item.maxValue ?? null,
            enabled: item.enabled ?? true,
          },
          update: {
            ...(item.minValue === undefined ? {} : { minValue: item.minValue }),
            ...(item.maxValue === undefined ? {} : { maxValue: item.maxValue }),
            ...(item.enabled === undefined ? {} : { enabled: item.enabled }),
          },
        }),
      ),
    );

    return this.getConfigs(userId);
  }

  async evaluateAndCreate(
    tx: Prisma.TransactionClient,
    userId: string,
    measurement: Measurement,
  ): Promise<Alert[]> {
    const rows = await tx.alertConfig.findMany({ where: { userId } });
    const thresholds = new Map<AlertParameter, AlertThreshold>();
    for (const row of rows) {
      thresholds.set(row.parameter, {
        minValue: row.minValue === null ? null : Number(row.minValue),
        maxValue: row.maxValue === null ? null : Number(row.maxValue),
        enabled: row.enabled,
      });
    }

    const alerts: Alert[] = [];
    for (const parameter of Object.values(AlertParameterKey)) {
      const rawValue = measurement[MEASUREMENT_FIELD[parameter]];
      if (rawValue === null || rawValue === undefined) {
        continue;
      }

      const value = Number(rawValue);
      const threshold =
        thresholds.get(parameter as AlertParameter) ??
        DEFAULT_THRESHOLDS[parameter];
      const evaluation = this.evaluator.evaluate(parameter, value, threshold);

      if (!evaluation) {
        continue;
      }

      const alert = await tx.alert.create({
        data: {
          userId,
          deviceId: measurement.deviceId,
          measurementId: measurement.id,
          parameter: parameter as AlertParameter,
          value,
          minValue: threshold.minValue,
          maxValue: threshold.maxValue,
          direction: evaluation.direction,
          message: evaluation.message,
        },
      });
      alerts.push(alert);
    }

    return alerts;
  }

  async list(userId: string, query: ListAlertsQueryDto) {
    const limit = query.limit ?? 50;
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;

    if (from && to && from > to) {
      throw AppException.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        "from must be earlier than to.",
      );
    }

    const where: Prisma.AlertWhereInput = { userId };
    if (query.status) {
      where.status = query.status as AlertStatus;
    }
    if (query.parameter) {
      where.parameter = query.parameter as AlertParameter;
    }
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const cursor = decodeCursor(query.cursor);
    if (cursor) {
      where.OR = [
        { createdAt: { lt: cursor.date } },
        { createdAt: cursor.date, id: { lt: cursor.id } },
      ];
    }

    const rows = await this.prisma.alert.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];

    return {
      items: items.map(toAlertDto),
      meta: {
        limit,
        hasMore,
        nextCursor:
          hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
      },
    };
  }

  async markRead(userId: string, alertId: string) {
    const alert = await this.prisma.alert.findFirst({
      where: { id: alertId, userId },
    });
    if (!alert) {
      throw AppException.notFound(
        ERROR_CODES.ALERT_NOT_FOUND,
        "Alert not found.",
      );
    }
    if (alert.status === AlertStatus.READ) {
      return toAlertDto(alert);
    }
    const updated = await this.prisma.alert.update({
      where: { id: alertId },
      data: { status: AlertStatus.READ, readAt: new Date() },
    });
    return toAlertDto(updated);
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.alert.updateMany({
      where: { userId, status: AlertStatus.UNREAD },
      data: { status: AlertStatus.READ, readAt: new Date() },
    });
    return { updated: result.count };
  }

  private mergeConfigs(rows: AlertConfig[]) {
    const byParameter = new Map<AlertParameter, AlertConfig>();
    for (const row of rows) {
      byParameter.set(row.parameter, row);
    }

    return Object.values(AlertParameterKey).map((parameter) => {
      const row = byParameter.get(parameter as AlertParameter);
      const fallback = DEFAULT_THRESHOLDS[parameter];
      return {
        parameter,
        minValue:
          row === undefined
            ? fallback.minValue
            : row.minValue === null
              ? null
              : Number(row.minValue),
        maxValue:
          row === undefined
            ? fallback.maxValue
            : row.maxValue === null
              ? null
              : Number(row.maxValue),
        enabled: row?.enabled ?? fallback.enabled,
        updatedAt: row?.updatedAt ?? null,
      };
    });
  }
}

export function toAlertDto(alert: Alert) {
  return {
    id: alert.id,
    deviceId: alert.deviceId,
    measurementId: alert.measurementId,
    parameter: alert.parameter,
    value: Number(alert.value),
    minValue: alert.minValue === null ? null : Number(alert.minValue),
    maxValue: alert.maxValue === null ? null : Number(alert.maxValue),
    direction: alert.direction,
    status: alert.status,
    message: alert.message,
    createdAt: alert.createdAt,
    readAt: alert.readAt,
  };
}
