import { Type } from "class-transformer";
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { AlertParameterKey } from "../alert-evaluator";

export enum AlertStatusFilter {
  UNREAD = "UNREAD",
  READ = "READ",
}

export class ListAlertsQueryDto {
  @IsOptional()
  @IsEnum(AlertStatusFilter)
  status?: AlertStatusFilter;

  @IsOptional()
  @IsEnum(AlertParameterKey)
  parameter?: AlertParameterKey;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
