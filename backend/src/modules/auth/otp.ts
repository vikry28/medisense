import { randomInt } from "node:crypto";
import { hmacSha256, safeEqualHex } from "../../common/utils/hash";

export const OTP_LENGTH = 6;

export function generateOtp(): string {
  return randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, "0");
}

export function hashOtp(userId: string, otp: string, pepper: string): string {
  return hmacSha256(`${userId}:${otp}`, pepper);
}

export function matchesOtp(
  userId: string,
  otp: string,
  codeHash: string,
  pepper: string,
): boolean {
  return safeEqualHex(hashOtp(userId, otp, pepper), codeHash);
}

export function isOtpExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function attemptsExhausted(
  attempts: number,
  maxAttempts: number,
): boolean {
  return attempts >= maxAttempts;
}
