import { Module } from "@nestjs/common";
import { AlertsModule } from "../alerts/alerts.module";
import { DevicePresenceService } from "./device-presence.service";
import { DevicesController } from "./devices.controller";
import { DevicesService } from "./devices.service";

@Module({
  imports: [AlertsModule],
  controllers: [DevicesController],
  providers: [DevicesService, DevicePresenceService],
  exports: [DevicesService],
})
export class DevicesModule {}
