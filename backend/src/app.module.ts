import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { randomUUID } from "node:crypto";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { HttpThrottlerGuard } from "./common/guards/http-throttler.guard";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { envValidationSchema } from "./config/validation";
import { AlertsModule } from "./modules/alerts/alerts.module";
import { AuthModule } from "./modules/auth/auth.module";
import { DevicesModule } from "./modules/devices/devices.module";
import { HealthModule } from "./modules/health/health.module";
import { MeasurementsModule } from "./modules/measurements/measurements.module";
import { MqttModule } from "./modules/mqtt/mqtt.module";
import { RealtimeModule } from "./modules/realtime/realtime.module";
import { UsersModule } from "./modules/users/users.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env"],
      validate: (config: Record<string, unknown>) => {
        const { error, value } = envValidationSchema.validate(config, {
          abortEarly: false,
          allowUnknown: true,
        });
        if (error) {
          throw new Error(`Environment validation failed: ${error.message}`);
        }
        return value;
      },
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>("LOG_LEVEL", "info"),
          genReqId: (request, response) => {
            const existing = request.headers["x-request-id"];
            const id =
              typeof existing === "string" && existing.length > 0
                ? existing
                : randomUUID();
            response.setHeader("x-request-id", id);
            return id;
          },
          redact: {
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              'res.headers["set-cookie"]',
              "req.body.password",
              "req.body.currentPassword",
              "req.body.newPassword",
              "req.body.refreshToken",
              "req.body.tokens.refreshToken",
            ],
            censor: "[REDACTED]",
          },
          autoLogging: {
            ignore: (request) =>
              request.url === "/health/live" || request.url === "/health/ready",
          },
        },
      }),
    }),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: "default",
        ttl: 60_000,
        limit: 100,
      },
    ]),
    PrismaModule,
    AuthModule,
    UsersModule,
    AlertsModule,
    DevicesModule,
    MeasurementsModule,
    RealtimeModule,
    MqttModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: HttpThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
