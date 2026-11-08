import { Module } from "@nestjs/common";
import { DevicePresenceService } from "./device-presence.service";
import { DevicesController } from "./devices.controller";
import { DevicesService } from "./devices.service";

@Module({
  controllers: [DevicesController],
  providers: [DevicesService, DevicePresenceService],
  exports: [DevicesService],
})
export class DevicesModule {}
