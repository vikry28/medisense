import { HttpException, HttpStatus } from "@nestjs/common";
import { ErrorCode } from "../constants";

interface AppExceptionBody {
  statusCode: number;
  code: ErrorCode;
  message: string;
  title: string;
  details?: unknown;
}

export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    public readonly code: ErrorCode,
    message: string,
    details?: unknown,
    title?: string,
  ) {
    const body: AppExceptionBody = {
      statusCode: status,
      code,
      message,
      title: title ?? defaultTitle(status),
      ...(details === undefined ? {} : { details }),
    };
    super(body, status);
  }

  static notFound(code: ErrorCode, message: string): AppException {
    return new AppException(HttpStatus.NOT_FOUND, code, message);
  }

  static badRequest(
    code: ErrorCode,
    message: string,
    details?: unknown,
  ): AppException {
    return new AppException(HttpStatus.BAD_REQUEST, code, message, details);
  }

  static unauthorized(code: ErrorCode, message: string): AppException {
    return new AppException(HttpStatus.UNAUTHORIZED, code, message);
  }

  static forbidden(
    message = "You do not have access to this resource.",
  ): AppException {
    return new AppException(HttpStatus.FORBIDDEN, "FORBIDDEN", message);
  }

  static conflict(code: ErrorCode, message: string): AppException {
    return new AppException(HttpStatus.CONFLICT, code, message);
  }
}

function defaultTitle(status: number): string {
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
