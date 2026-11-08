import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { User } from "@prisma/client";
import { ERROR_CODES } from "../../common/constants";
import { AppException } from "../../common/errors/app.exception";
import { PrismaService } from "../../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import {
  attemptsExhausted,
  generateOtp,
  hashOtp,
  isOtpExpired,
  matchesOtp,
} from "./otp";

type VerifiableUser = Pick<User, "id" | "email" | "emailVerifiedAt">;

export interface IssuedVerificationCode {
  resendAfterSeconds: number;
}

export interface ResendVerificationResult {
  sent: true;
  resendAfterSeconds: number;
}

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);
  private readonly pepper: string;
  private readonly ttlMinutes: number;
  private readonly maxAttempts: number;
  private readonly resendCooldownSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {
    this.pepper = this.config.getOrThrow<string>("EMAIL_OTP_PEPPER");
    this.ttlMinutes = this.config.get<number>("EMAIL_OTP_TTL_MINUTES", 10);
    this.maxAttempts = this.config.get<number>("EMAIL_OTP_MAX_ATTEMPTS", 5);
    this.resendCooldownSeconds = this.config.get<number>(
      "EMAIL_OTP_RESEND_COOLDOWN_SECONDS",
      60,
    );
  }

  getResendCooldownSeconds(): number {
    return this.resendCooldownSeconds;
  }

  async issueForUser(user: VerifiableUser): Promise<IssuedVerificationCode> {
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + this.ttlMinutes * 60 * 1000);
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.emailVerificationCode.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: now },
      }),
      this.prisma.emailVerificationCode.create({
        data: {
          userId: user.id,
          codeHash: hashOtp(user.id, otp, this.pepper),
          expiresAt,
        },
      }),
    ]);

    await this.deliver(user.email, otp, expiresAt);

    return { resendAfterSeconds: this.resendCooldownSeconds };
  }

  async resend(email: string): Promise<ResendVerificationResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Always return the same shape to avoid account enumeration.
    if (!user || user.emailVerifiedAt) {
      return { sent: true, resendAfterSeconds: this.resendCooldownSeconds };
    }

    const latest = await this.prisma.emailVerificationCode.findFirst({
      where: { userId: user.id, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });

    if (latest) {
      const retryAt =
        latest.createdAt.getTime() + this.resendCooldownSeconds * 1000;
      const retryAfterSeconds = Math.ceil((retryAt - Date.now()) / 1000);
      if (retryAfterSeconds > 0) {
        throw new AppException(
          HttpStatus.TOO_MANY_REQUESTS,
          ERROR_CODES.OTP_RESEND_TOO_SOON,
          "A verification code was sent recently. Please wait before requesting another one.",
          { retryAfterSeconds },
        );
      }
    }

    const issued = await this.issueForUser(user);
    return { sent: true, ...issued };
  }

  async verify(email: string, otp: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      throw AppException.badRequest(
        ERROR_CODES.OTP_INVALID,
        "The verification code is invalid.",
      );
    }

    if (user.emailVerifiedAt) {
      throw AppException.conflict(
        ERROR_CODES.EMAIL_ALREADY_VERIFIED,
        "This email address is already verified.",
      );
    }

    const code = await this.prisma.emailVerificationCode.findFirst({
      where: { userId: user.id, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });

    if (!code || isOtpExpired(code.expiresAt)) {
      throw AppException.badRequest(
        ERROR_CODES.OTP_EXPIRED,
        "The verification code has expired. Request a new code.",
      );
    }

    if (attemptsExhausted(code.attempts, this.maxAttempts)) {
      throw this.tooManyAttempts();
    }

    if (!matchesOtp(user.id, otp, code.codeHash, this.pepper)) {
      const updated = await this.prisma.emailVerificationCode.update({
        where: { id: code.id },
        data: { attempts: { increment: 1 } },
      });

      if (attemptsExhausted(updated.attempts, this.maxAttempts)) {
        throw this.tooManyAttempts();
      }

      throw AppException.badRequest(
        ERROR_CODES.OTP_INVALID,
        "The verification code is invalid.",
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.emailVerificationCode.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: now },
      });
      return tx.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: now },
      });
    });
  }

  private async deliver(
    email: string,
    otp: string,
    expiresAt: Date,
  ): Promise<void> {
    try {
      await this.mail.sendEmailVerificationOtp({ to: email, otp, expiresAt });
    } catch (error) {
      // The account already exists and a resend is possible, so a mail outage
      // must not fail the registration request.
      this.logger.error(
        { err: error, email },
        "Failed to deliver email verification code",
      );
    }
  }

  private tooManyAttempts(): AppException {
    return new AppException(
      HttpStatus.TOO_MANY_REQUESTS,
      ERROR_CODES.OTP_TOO_MANY_ATTEMPTS,
      "Too many invalid verification attempts. Request a new code.",
      { maxAttempts: this.maxAttempts },
    );
  }
}
