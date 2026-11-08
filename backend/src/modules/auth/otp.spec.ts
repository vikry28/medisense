import {
  attemptsExhausted,
  generateOtp,
  hashOtp,
  isOtpExpired,
  matchesOtp,
} from "./otp";

const PEPPER = "test-email-otp-pepper-value";

describe("email verification OTP helpers", () => {
  it("generates six digit codes, including leading zeros", () => {
    for (let index = 0; index < 200; index += 1) {
      expect(generateOtp()).toMatch(/^\d{6}$/);
    }
  });

  it("hashes the OTP with the user id and pepper", () => {
    const hash = hashOtp("user-1", "123456", PEPPER);

    expect(hash).toHaveLength(64);
    expect(hash).toBe(hashOtp("user-1", "123456", PEPPER));
    expect(hash).not.toBe(hashOtp("user-2", "123456", PEPPER));
    expect(hash).not.toBe(hashOtp("user-1", "654321", PEPPER));
    expect(hash).not.toBe(hashOtp("user-1", "123456", `${PEPPER}-other`));
  });

  it("compares OTPs in constant time and rejects mismatches", () => {
    const hash = hashOtp("user-1", "123456", PEPPER);

    expect(matchesOtp("user-1", "123456", hash, PEPPER)).toBe(true);
    expect(matchesOtp("user-1", "123457", hash, PEPPER)).toBe(false);
    expect(matchesOtp("user-2", "123456", hash, PEPPER)).toBe(false);
  });

  it("treats expired and boundary timestamps as expired", () => {
    const now = new Date("2026-11-07T10:00:00.000Z");

    expect(isOtpExpired(new Date("2026-11-07T10:00:01.000Z"), now)).toBe(false);
    expect(isOtpExpired(new Date("2026-11-07T10:00:00.000Z"), now)).toBe(true);
    expect(isOtpExpired(new Date("2026-11-07T09:59:59.000Z"), now)).toBe(true);
  });

  it("detects exhausted attempt counters", () => {
    expect(attemptsExhausted(4, 5)).toBe(false);
    expect(attemptsExhausted(5, 5)).toBe(true);
    expect(attemptsExhausted(6, 5)).toBe(true);
  });
});
