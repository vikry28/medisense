import { Module } from "@nestjs/common";
import { AlertsModule } from "../alerts/alerts.module";
import { DevicesModule } from "../devices/devices.module";
import { MeasurementIngestionService } from "./measurement-ingestion.service";
import { MeasurementsController } from "./measurements.controller";
import { MeasurementsService } from "./measurements.service";

@Module({
  imports: [DevicesModule, AlertsModule],
  controllers: [MeasurementsController],
  providers: [MeasurementsService, MeasurementIngestionService],
  exports: [MeasurementsService, MeasurementIngestionService],
})
export class MeasurementsModule {}
