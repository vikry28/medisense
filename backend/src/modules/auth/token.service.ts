import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Injectable } from "@nestjs/common";
import { Prisma, User, UserRole } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import { ERROR_CODES } from "../../common/constants";
import { AppException } from "../../common/errors/app.exception";
import { sha256 } from "../../common/utils/hash";
import { PrismaService } from "../../prisma/prisma.service";

export interface TokenUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface TokenMeta {
  ip?: string;
  userAgent?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}

interface RotateResult {
  status: "rotated" | "reused" | "expired";
  familyId?: string;
  tokens?: TokenPair;
}

@Injectable()
export class TokenService {
  private readonly refreshTtlDays: number;
  private readonly accessTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {
    this.refreshTtlDays = this.config.get<number>("JWT_REFRESH_TTL_DAYS", 30);
    this.accessTtlSeconds = this.config.get<number>(
      "JWT_ACCESS_TTL_SECONDS",
      900,
    );
  }

  async issueTokenPair(
    user: TokenUser,
    meta: TokenMeta,
    familyId = randomUUID(),
    tx?: Prisma.TransactionClient,
  ): Promise<TokenPair> {
    const db = tx ?? this.prisma;
    const refreshToken = randomBytes(48).toString("base64url");
    const expiresAt = this.refreshExpiry();

    await db.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        familyId,
        expiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });

    return {
      accessToken: await this.signAccessToken(user),
      refreshToken,
      tokenType: "Bearer",
      expiresIn: this.accessTtlSeconds,
    };
  }

  async rotate(rawRefreshToken: string, meta: TokenMeta): Promise<TokenPair> {
    const tokenHash = sha256(rawRefreshToken);

    const result = await this.prisma.$transaction<RotateResult>(
      async (tx) => {
        const current = await tx.refreshToken.findUnique({
          where: { tokenHash },
          include: { user: true },
        });

        if (!current) {
          throw AppException.unauthorized(
            ERROR_CODES.REFRESH_INVALID,
            "The refresh token is invalid.",
          );
        }

        if (current.revokedAt) {
          return { status: "reused", familyId: current.familyId };
        }

        if (current.expiresAt.getTime() <= Date.now()) {
          return { status: "expired", familyId: current.familyId };
        }

        const nextId = randomUUID();
        const refreshToken = randomBytes(48).toString("base64url");

        await tx.refreshToken.update({
          where: { id: current.id },
          data: { revokedAt: new Date(), replacedByTokenId: nextId },
        });

        await tx.refreshToken.create({
          data: {
            id: nextId,
            userId: current.userId,
            tokenHash: sha256(refreshToken),
            familyId: current.familyId,
            expiresAt: this.refreshExpiry(),
            ip: meta.ip,
            userAgent: meta.userAgent,
          },
        });

        return {
          status: "rotated",
          tokens: {
            accessToken: await this.signAccessToken(current.user),
            refreshToken,
            tokenType: "Bearer",
            expiresIn: this.accessTtlSeconds,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (result.status === "reused" && result.familyId) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: result.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw AppException.unauthorized(
        ERROR_CODES.REFRESH_REUSED,
        "This refresh token has already been used. All sessions in this family were revoked.",
      );
    }

    if (result.status === "expired") {
      throw AppException.unauthorized(
        ERROR_CODES.REFRESH_EXPIRED,
        "The refresh token has expired. Please log in again.",
      );
    }

    if (!result.tokens) {
      throw AppException.unauthorized(
        ERROR_CODES.REFRESH_INVALID,
        "The refresh token is invalid.",
      );
    }

    return result.tokens;
  }

  async revoke(rawRefreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(rawRefreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAll(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    await db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async signAccessToken(user: TokenUser): Promise<string> {
    return this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000);
  }
}

export function toPublicUser(user: User): {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  timezone: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    timezone: user.timezone,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
