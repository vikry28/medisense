import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { AlertParameterKey } from "../alert-evaluator";

export class AlertConfigItemDto {
  @IsEnum(AlertParameterKey)
  parameter!: AlertParameterKey;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  minValue?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  maxValue?: number | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateAlertConfigsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AlertConfigItemDto)
  configs!: AlertConfigItemDto[];
}
