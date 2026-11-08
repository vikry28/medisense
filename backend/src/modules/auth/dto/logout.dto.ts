import { IsString, MaxLength, MinLength } from "class-validator";

export class LogoutDto {
  @IsString()
  @MinLength(32)
  @MaxLength(512)
  refreshToken!: string;
}
