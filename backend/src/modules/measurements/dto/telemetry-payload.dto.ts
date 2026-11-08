import { Transform, Type } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export enum SignalQualityKey {
  GOOD = "GOOD",
  FAIR = "FAIR",
  POOR = "POOR",
}

export class TelemetryMeasurementsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(20)
  @Max(250)
  heartRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(100)
  spo2?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(30)
  @Max(45)
  temperature?: number;
}

export class TelemetryPayloadDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{3,64}$/)
  deviceCode!: string;

  @IsString()
  @Length(8, 64)
  messageId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sequence?: number;

  @IsISO8601()
  timestamp!: string;

  @ValidateNested()
  @Type(() => TelemetryMeasurementsDto)
  measurements!: TelemetryMeasurementsDto;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toUpperCase() : value,
  )
  @IsEnum(SignalQualityKey)
  signalQuality?: SignalQualityKey;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  firmwareVersion?: string;
}
