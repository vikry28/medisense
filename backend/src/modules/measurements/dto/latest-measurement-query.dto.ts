import { IsOptional, IsUUID } from "class-validator";

export class LatestMeasurementQueryDto {
  @IsOptional()
  @IsUUID()
  deviceId?: string;
}
