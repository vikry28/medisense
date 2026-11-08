import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.useBodyParser("json", { limit: "64kb" });
  app.useBodyParser("urlencoded", { limit: "64kb", extended: true });

  const config = app.get(ConfigService);
  const port = config.get<number>("PORT", 3000);
  const prefix = config.get<string>("API_PREFIX", "api/v1");

  app.setGlobalPrefix(prefix, {
    exclude: ["health/live", "health/ready"],
  });
  app.set("trust proxy", 1);

  const corsOrigins = config.get<string>("CORS_ORIGINS", "*");
  app.enableCors({
    origin:
      corsOrigins === "*"
        ? true
        : corsOrigins.split(",").map((origin) => origin.trim()),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
    }),
  );

  if (config.get<boolean>("SWAGGER_ENABLED", true)) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle("MediSense API")
        .setDescription(
          "REST API, MQTT ingestion and WebSocket gateway for the MediSense IoT health monitoring system. Demonstration data only; not for clinical use.",
        )
        .setVersion("1.0.0")
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup("docs", app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  app.enableShutdownHooks();
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
