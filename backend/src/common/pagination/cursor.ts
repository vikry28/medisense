import { AppException } from "../errors/app.exception";
import { ERROR_CODES } from "../constants";

export interface DecodedCursor {
  date: Date;
  id: string;
}

export function encodeCursor(date: Date, id: string): string {
  return Buffer.from(`${date.toISOString()}|${id}`, "utf8").toString(
    "base64url",
  );
}

export function decodeCursor(
  cursor?: string | null,
): DecodedCursor | undefined {
  if (!cursor) {
    return undefined;
  }

  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = raw.lastIndexOf("|");
    if (separator <= 0) {
      throw new Error("Malformed cursor");
    }
    const date = new Date(raw.slice(0, separator));
    const id = raw.slice(separator + 1);
    if (Number.isNaN(date.getTime()) || !isUuid(id)) {
      throw new Error("Malformed cursor");
    }
    return { date, id };
  } catch {
    throw AppException.badRequest(
      ERROR_CODES.INVALID_CURSOR,
      "The pagination cursor is invalid.",
    );
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
