import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import { ERROR_CODES, ErrorCode } from "../constants";

interface ErrorResponseBody {
  statusCode?: number;
  code?: string;
  message?: string | string[];
  title?: string;
  details?: unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== "http") {
      const client = host.switchToWs().getClient<{
        emit?: (event: string, payload: unknown) => void;
      }>();
      const message =
        exception instanceof Error ? exception.message : "WebSocket error";
      this.logger.warn({ err: exception }, "WebSocket request rejected");
      client?.emit?.("exception", { status: "error", message });
      return;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = ERROR_CODES.INTERNAL_ERROR;
    let title = "Internal Server Error";
    let message = "An unexpected error occurred.";
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "string") {
        message = body;
      } else if (body && typeof body === "object") {
        const parsed = body as ErrorResponseBody;
        title = parsed.title ?? titleForStatus(status);
        code = isErrorCode(parsed.code)
          ? parsed.code
          : status === HttpStatus.BAD_REQUEST
            ? ERROR_CODES.VALIDATION_ERROR
            : codeForStatus(status);
        if (Array.isArray(parsed.message)) {
          message = "Request validation failed.";
          details = { errors: parsed.message };
        } else if (parsed.message) {
          message = parsed.message;
        }
        if (parsed.details !== undefined) {
          details = parsed.details;
        }
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === "P2002") {
        status = HttpStatus.CONFLICT;
        code = ERROR_CODES.CONFLICT;
        title = "Conflict";
        message = "A resource with the same unique value already exists.";
        details = { fields: exception.meta?.target };
      } else if (exception.code === "P2025") {
        status = HttpStatus.NOT_FOUND;
        code = ERROR_CODES.NOT_FOUND;
        title = "Not Found";
        message = "The requested resource was not found.";
      } else {
        status = HttpStatus.INTERNAL_SERVER_ERROR;
      }
    } else if (
      exception instanceof Prisma.PrismaClientValidationError ||
      exception instanceof Prisma.PrismaClientInitializationError
    ) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
    }

    if (status >= 500) {
      this.logger.error(
        {
          err: exception,
          requestId: request.id,
          method: request.method,
          path: request.url,
        },
        "Unhandled request failure",
      );
    } else {
      this.logger.warn(
        {
          code,
          status,
          requestId: request.id,
          method: request.method,
          path: request.url,
        },
        "Request rejected",
      );
    }

    response
      .status(status)
      .type("application/problem+json")
      .json({
        type: "about:blank",
        title,
        status,
        detail: message,
        code,
        ...(details === undefined ? {} : { details }),
        instance: request.originalUrl ?? request.url,
        requestId: request.id,
        timestamp: new Date().toISOString(),
      });
  }
}

function isErrorCode(value: string | undefined): value is ErrorCode {
  return !!value && Object.values(ERROR_CODES).includes(value as ErrorCode);
}

function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return ERROR_CODES.VALIDATION_ERROR;
    case HttpStatus.UNAUTHORIZED:
      return ERROR_CODES.UNAUTHORIZED;
    case HttpStatus.FORBIDDEN:
      return ERROR_CODES.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ERROR_CODES.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ERROR_CODES.CONFLICT;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ERROR_CODES.RATE_LIMITED;
    default:
      return ERROR_CODES.INTERNAL_ERROR;
  }
}

function titleForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return "Bad Request";
    case HttpStatus.UNAUTHORIZED:
      return "Unauthorized";
    case HttpStatus.FORBIDDEN:
      return "Forbidden";
    case HttpStatus.NOT_FOUND:
      return "Not Found";
    case HttpStatus.CONFLICT:
      return "Conflict";
    case HttpStatus.TOO_MANY_REQUESTS:
      return "Too Many Requests";
    case HttpStatus.SERVICE_UNAVAILABLE:
      return "Service Unavailable";
    default:
      return "Internal Server Error";
  }
}
