import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, User } from "@prisma/client";
import { ERROR_CODES } from "../../common/constants";
import { AppException } from "../../common/errors/app.exception";
import { hashPassword, verifyPassword } from "../../common/utils/password";
import { PrismaService } from "../../prisma/prisma.service";
import { AlertsService } from "../alerts/alerts.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { ResendVerificationDto } from "./dto/resend-verification.dto";
import { VerifyEmailDto } from "./dto/verify-email.dto";
import {
  EmailVerificationService,
  ResendVerificationResult,
} from "./email-verification.service";
import {
  TokenMeta,
  TokenPair,
  TokenService,
  toPublicUser,
} from "./token.service";

export interface AuthResult {
  user: ReturnType<typeof toPublicUser>;
  tokens: TokenPair;
}

export interface RegistrationResult {
  user: ReturnType<typeof toPublicUser>;
  verificationRequired: true;
  resendAfterSeconds: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly alertsService: AlertsService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  async register(dto: RegisterDto): Promise<RegistrationResult> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw AppException.conflict(
        ERROR_CODES.EMAIL_TAKEN,
        "An account with this email already exists.",
      );
    }

    const passwordHash = await hashPassword(dto.password);

    let user: User;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            name: dto.name.trim(),
            email,
            passwordHash,
          },
        });
        await this.alertsService.ensureDefaults(created.id, tx);
        return created;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw AppException.conflict(
          ERROR_CODES.EMAIL_TAKEN,
          "An account with this email already exists.",
        );
      }
      throw error;
    }

    const issued = await this.emailVerification.issueForUser(user);

    return {
      user: toPublicUser(user),
      verificationRequired: true,
      resendAfterSeconds: issued.resendAfterSeconds,
    };
  }

  async login(dto: LoginDto, meta: TokenMeta): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });

    if (!user || !(await verifyPassword(user.passwordHash, dto.password))) {
      throw AppException.unauthorized(
        ERROR_CODES.CREDENTIALS_INVALID,
        "Invalid email or password.",
      );
    }

    if (!user.emailVerifiedAt) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.EMAIL_NOT_VERIFIED,
        "Please verify your email address before logging in.",
        {
          email: user.email,
          resendAfterSeconds: this.emailVerification.getResendCooldownSeconds(),
        },
      );
    }

    return {
      user: toPublicUser(user),
      tokens: await this.tokenService.issueTokenPair(user, meta),
    };
  }

  async verifyEmail(dto: VerifyEmailDto, meta: TokenMeta): Promise<AuthResult> {
    const user = await this.emailVerification.verify(dto.email, dto.otp);
    return {
      user: toPublicUser(user),
      tokens: await this.tokenService.issueTokenPair(user, meta),
    };
  }

  async resendVerification(
    dto: ResendVerificationDto,
  ): Promise<ResendVerificationResult> {
    return this.emailVerification.resend(dto.email);
  }

  async refresh(refreshToken: string, meta: TokenMeta): Promise<TokenPair> {
    return this.tokenService.rotate(refreshToken, meta);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokenService.revoke(refreshToken);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.tokenService.revokeAll(userId);
  }
}
