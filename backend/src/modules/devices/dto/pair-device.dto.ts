import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class PairDeviceDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{3,64}$/, {
    message:
      "deviceCode may contain letters, numbers, underscores and dashes only",
  })
  deviceCode!: string;

  /**
   * Required outside development. In development/test, omitting it enables
   * pairing by deviceCode only (useful for simulators and Flutter demos).
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: "pairingCode must be a 6-digit code" })
  pairingCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;
}
