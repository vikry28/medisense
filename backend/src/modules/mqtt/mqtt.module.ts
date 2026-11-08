import { Module } from "@nestjs/common";
import { DevicesModule } from "../devices/devices.module";
import { MeasurementsModule } from "../measurements/measurements.module";
import { MqttService } from "./mqtt.service";

@Module({
  imports: [MeasurementsModule, DevicesModule],
  providers: [MqttService],
  exports: [MqttService],
})
export class MqttModule {}
