import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import {
  EmailVerificationService,
  ResendVerificationResult,
} from "./email-verification.service";
import { hashOtp } from "./otp";

const PEPPER = "test-email-otp-pepper-value";
const USER = {
  id: "user-1",
  email: "user@example.com",
  emailVerifiedAt: null as Date | null,
};

function createConfig(): ConfigService {
  const values: Record<string, unknown> = {
    EMAIL_OTP_TTL_MINUTES: 10,
    EMAIL_OTP_MAX_ATTEMPTS: 5,
    EMAIL_OTP_RESEND_COOLDOWN_SECONDS: 60,
  };
  return {
    getOrThrow: jest.fn().mockReturnValue(PEPPER),
    get: jest.fn((key: string, fallback: unknown) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

function createService() {
  const tx = {
    emailVerificationCode: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      update: jest.fn(
        async ({ data }: { data: { emailVerifiedAt: Date } }) => ({
          ...USER,
          ...data,
        }),
      ),
    },
  };

  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    emailVerificationCode: {
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(async (arg: unknown) => {
      if (Array.isArray(arg)) {
        return Promise.all(arg as Promise<unknown>[]);
      }
      return (arg as (client: typeof tx) => Promise<unknown>)(tx);
    }),
  };

  const mail = {
    sendEmailVerificationOtp: jest.fn().mockResolvedValue(undefined),
  };

  const service = new EmailVerificationService(
    prisma as unknown as PrismaService,
    createConfig(),
    mail as unknown as MailService,
  );

  return { service, prisma, mail, tx };
}

describe("EmailVerificationService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("issueForUser", () => {
    it("stores only a hashed OTP and hides the raw code from the database", async () => {
      const { service, prisma, mail } = createService();

      const result = await service.issueForUser(USER);

      expect(result.resendAfterSeconds).toBe(60);
      expect(prisma.emailVerificationCode.create).toHaveBeenCalledTimes(1);
      const createArgs = prisma.emailVerificationCode.create.mock.calls[0][0];
      expect(createArgs.data.codeHash).toHaveLength(64);
      expect(mail.sendEmailVerificationOtp).toHaveBeenCalledTimes(1);

      const sent = mail.sendEmailVerificationOtp.mock.calls[0][0];
      expect(sent.to).toBe(USER.email);
      expect(sent.otp).toMatch(/^\d{6}$/);
      expect(createArgs.data.codeHash).toBe(hashOtp(USER.id, sent.otp, PEPPER));
    });

    it("still succeeds when mail delivery fails", async () => {
      const { service, mail } = createService();
      mail.sendEmailVerificationOtp.mockRejectedValueOnce(
        new Error("smtp unavailable"),
      );

      await expect(service.issueForUser(USER)).resolves.toEqual({
        resendAfterSeconds: 60,
      });
    });
  });

  describe("resend", () => {
    it("returns a generic result for unknown emails", async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.resend("missing@example.com")).resolves.toEqual({
        sent: true,
        resendAfterSeconds: 60,
      } satisfies ResendVerificationResult);
      expect(prisma.emailVerificationCode.create).not.toHaveBeenCalled();
    });

    it("returns a generic result for already verified emails", async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue({
        ...USER,
        emailVerifiedAt: new Date(),
      });

      await expect(service.resend(USER.email)).resolves.toEqual({
        sent: true,
        resendAfterSeconds: 60,
      });
      expect(prisma.emailVerificationCode.create).not.toHaveBeenCalled();
    });

    it("rejects a resend inside the cooldown window", async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue(USER);
      prisma.emailVerificationCode.findFirst.mockResolvedValue({
        id: "code-1",
        createdAt: new Date(),
      });

      await expect(service.resend(USER.email)).rejects.toMatchObject({
        code: "AUTH_OTP_RESEND_TOO_SOON",
      });
    });
  });

  describe("verify", () => {
    it("rejects unknown emails without revealing the account state", async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.verify("missing@example.com", "123456"),
      ).rejects.toMatchObject({ code: "AUTH_OTP_INVALID" });
    });

    it("rejects already verified emails", async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue({
        ...USER,
        emailVerifiedAt: new Date(),
      });

      await expect(service.verify(USER.email, "123456")).rejects.toMatchObject({
        code: "AUTH_EMAIL_ALREADY_VERIFIED",
      });
    });

    it("rejects missing codes as invalid", async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue(USER);
      prisma.emailVerificationCode.findFirst.mockResolvedValue(null);

      await expect(service.verify(USER.email, "123456")).rejects.toMatchObject({
        code: "AUTH_OTP_INVALID",
      });
    });

    it("rejects expired codes", async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue(USER);
      prisma.emailVerificationCode.findFirst.mockResolvedValue({
        id: "code-1",
        userId: USER.id,
        codeHash: hashOtp(USER.id, "123456", PEPPER),
        expiresAt: new Date(Date.now() - 1_000),
        attempts: 0,
      });

      await expect(service.verify(USER.email, "123456")).rejects.toMatchObject({
        code: "AUTH_OTP_EXPIRED",
      });
    });

    it("increments attempts and rejects a wrong code", async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue(USER);
      prisma.emailVerificationCode.findFirst.mockResolvedValue({
        id: "code-1",
        userId: USER.id,
        codeHash: hashOtp(USER.id, "123456", PEPPER),
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
      });
      prisma.emailVerificationCode.update.mockResolvedValue({ attempts: 1 });

      await expect(service.verify(USER.email, "000000")).rejects.toMatchObject({
        code: "AUTH_OTP_INVALID",
      });
      expect(prisma.emailVerificationCode.update).toHaveBeenCalledWith({
        where: { id: "code-1" },
        data: { attempts: { increment: 1 } },
      });
    });

    it("locks the code after too many invalid attempts", async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue(USER);
      prisma.emailVerificationCode.findFirst.mockResolvedValue({
        id: "code-1",
        userId: USER.id,
        codeHash: hashOtp(USER.id, "123456", PEPPER),
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 5,
      });

      await expect(service.verify(USER.email, "123456")).rejects.toMatchObject({
        code: "AUTH_OTP_TOO_MANY_ATTEMPTS",
      });
    });

    it("marks the email verified and consumes the code on success", async () => {
      const { service, prisma, tx } = createService();
      prisma.user.findUnique.mockResolvedValue(USER);
      prisma.emailVerificationCode.findFirst.mockResolvedValue({
        id: "code-1",
        userId: USER.id,
        codeHash: hashOtp(USER.id, "123456", PEPPER),
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
      });

      const result = await service.verify(USER.email, "123456");

      expect(result.emailVerifiedAt).toBeInstanceOf(Date);
      expect(tx.emailVerificationCode.updateMany).toHaveBeenCalledWith({
        where: { userId: USER.id, consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      });
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: USER.id },
        data: { emailVerifiedAt: expect.any(Date) },
      });
    });
  });
});
