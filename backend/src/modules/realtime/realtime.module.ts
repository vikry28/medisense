import { Module } from "@nestjs/common";
import { DevicesModule } from "../devices/devices.module";
import { RealtimeGateway } from "./realtime.gateway";

@Module({
  imports: [DevicesModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
