import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { AppException } from "../errors/app.exception";
import { ERROR_CODES } from "../constants";
import {
  AccessTokenPayload,
  AuthenticatedUser,
} from "../types/authenticated-user";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);

    if (!token) {
      throw AppException.unauthorized(
        ERROR_CODES.UNAUTHORIZED,
        "Authentication is required.",
      );
    }

    try {
      const payload =
        await this.jwtService.verifyAsync<AccessTokenPayload>(token);
      if (!payload.sub || !payload.email) {
        throw new Error("Malformed access token payload");
      }
      const user: AuthenticatedUser = {
        id: payload.sub,
        email: payload.email,
        role: payload.role ?? "USER",
      };
      (request as Request & { user: AuthenticatedUser }).user = user;
      return true;
    } catch {
      throw AppException.unauthorized(
        ERROR_CODES.TOKEN_INVALID,
        "The access token is invalid or expired.",
      );
    }
  }
}

export function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header) {
    return undefined;
  }
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : undefined;
}
