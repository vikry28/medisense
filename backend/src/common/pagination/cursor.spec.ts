import { AppException } from "../errors/app.exception";
import { decodeCursor, encodeCursor } from "./cursor";

describe("pagination cursor", () => {
  const date = new Date("2026-11-04T12:00:00.000Z");
  const id = "0f1b8a6e-4b1a-4b1a-9b1a-1a2b3c4d5e6f";

  it("round-trips a date and id", () => {
    const decoded = decodeCursor(encodeCursor(date, id));
    expect(decoded?.date.toISOString()).toBe(date.toISOString());
    expect(decoded?.id).toBe(id);
  });

  it("returns undefined when no cursor is supplied", () => {
    expect(decodeCursor(undefined)).toBeUndefined();
    expect(decodeCursor("")).toBeUndefined();
  });

  it("rejects malformed cursors", () => {
    try {
      decodeCursor("not-a-real-cursor");
      fail("Expected decodeCursor to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).code).toBe("INVALID_CURSOR");
    }
  });
});
