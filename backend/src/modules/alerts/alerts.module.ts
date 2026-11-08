import { Module } from "@nestjs/common";
import { AlertEvaluator } from "./alert-evaluator";
import { AlertsController } from "./alerts.controller";
import { AlertsService } from "./alerts.service";

@Module({
  controllers: [AlertsController],
  providers: [AlertsService, AlertEvaluator],
  exports: [AlertsService, AlertEvaluator],
})
export class AlertsModule {}
