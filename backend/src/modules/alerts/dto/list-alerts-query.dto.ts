import { AlertParameter } from "@prisma/client";
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

export enum AlertStatusFilter {
  UNREAD = "UNREAD",
  READ = "READ",
}

export class ListAlertsQueryDto {
  @IsOptional()
  @IsEnum(AlertStatusFilter)
  status?: AlertStatusFilter;

  @IsOptional()
  @IsEnum(AlertParameter)
  parameter?: AlertParameter;

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
