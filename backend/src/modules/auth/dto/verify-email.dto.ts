import { Transform } from "class-transformer";
import { IsEmail, IsString, Matches, MaxLength } from "class-validator";

export class VerifyEmailDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: "otp must be a 6-digit code" })
  otp!: string;
}
