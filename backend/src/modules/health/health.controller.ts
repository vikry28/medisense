import { Controller, Get, HttpStatus } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator";
import { ERROR_CODES } from "../../common/constants";
import { AppException } from "../../common/errors/app.exception";
import { PrismaService } from "../../prisma/prisma.service";
import { MqttService } from "../mqtt/mqtt.service";

@ApiTags("Health")
@Public()
@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mqttService: MqttService,
  ) {}

  @Get("live")
  @ApiOperation({ summary: "Liveness probe" })
  live() {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("ready")
  @ApiOperation({ summary: "Readiness probe (database required)" })
  async ready() {
    let database = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = true;
    } catch {
      database = false;
    }

    const mqtt = {
      enabled: this.mqttService.isEnabled(),
      connected: this.mqttService.isConnected(),
    };

    if (!database) {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ERROR_CODES.SERVICE_UNAVAILABLE,
        "The database is not reachable.",
        { database, mqtt },
        "Service Unavailable",
      );
    }

    return {
      status: mqtt.enabled && !mqtt.connected ? "degraded" : "ok",
      checks: { database: "up", mqtt },
      timestamp: new Date().toISOString(),
    };
  }
}
