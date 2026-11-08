import { Module } from "@nestjs/common";
import { MqttModule } from "../mqtt/mqtt.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [MqttModule],
  controllers: [HealthController],
})
export class HealthModule {}
