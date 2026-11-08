import { IsDateString, IsIn, IsOptional, IsUUID } from "class-validator";
import { MeasurementParameterFilter } from "./list-measurements-query.dto";

export const SERIES_BUCKETS = ["1m", "5m", "15m", "1h", "1d"] as const;
export type SeriesBucket = (typeof SERIES_BUCKETS)[number];

export class SeriesQueryDto {
  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @IsOptional()
  @IsIn([
    MeasurementParameterFilter.HEART_RATE,
    MeasurementParameterFilter.SPO2,
    MeasurementParameterFilter.TEMPERATURE,
  ])
  parameter?: MeasurementParameterFilter;

  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsIn(SERIES_BUCKETS)
  bucket?: SeriesBucket;
}
