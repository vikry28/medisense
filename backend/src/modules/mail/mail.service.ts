import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createTransport, Transporter } from "nodemailer";

export interface VerificationEmailInput {
  to: string;
  otp: string;
  expiresAt: Date;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: "console" | "smtp";
  private readonly from: string;
  private readonly transporter: Transporter | null;

  constructor(private readonly config: ConfigService) {
    this.transport = this.config.get<"console" | "smtp">(
      "MAIL_TRANSPORT",
      "console",
    );
    this.from = this.config.get<string>(
      "SMTP_FROM",
      "MediSense <no-reply@medisense.local>",
    );

    if (this.transport === "smtp") {
      const user = this.config.get<string>("SMTP_USER");
      const password = this.config.get<string>("SMTP_PASSWORD");
      this.transporter = createTransport({
        host: this.config.get<string>("SMTP_HOST", "localhost"),
        port: this.config.get<number>("SMTP_PORT", 1025),
        secure: this.config.get<boolean>("SMTP_SECURE", false),
        ...(user && password ? { auth: { user, pass: password } } : {}),
      });
    } else {
      this.transporter = null;
    }
  }

  async sendEmailVerificationOtp(input: VerificationEmailInput): Promise<void> {
    if (this.transport === "console" || !this.transporter) {
      this.logger.log(
        `Email verification OTP for ${input.to}: ${input.otp} (expires at ${input.expiresAt.toISOString()})`,
      );
      return;
    }

    const expiresInMinutes = Math.max(
      1,
      Math.round((input.expiresAt.getTime() - Date.now()) / 60_000),
    );

    await this.transporter.sendMail({
      from: this.from,
      to: input.to,
      subject: "Your MediSense verification code",
      text: [
        "Hello,",
        "",
        `Your MediSense email verification code is: ${input.otp}`,
        "",
        `The code expires in ${expiresInMinutes} minutes.`,
        "If you did not create a MediSense account, you can ignore this email.",
        "",
        "MediSense — Real-Time Health Monitoring System",
      ].join("\n"),
      html: verificationEmailHtml(input.otp, expiresInMinutes),
    });
  }
}

function verificationEmailHtml(otp: string, expiresInMinutes: number): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px;">
            <tr>
              <td>
                <h1 style="margin:0 0 8px;font-size:22px;">Verify your email</h1>
                <p style="margin:0 0 24px;line-height:1.6;color:#52606d;">
                  Enter this code in the MediSense app to finish creating your account.
                </p>
                <div style="margin:0 0 24px;padding:16px;text-align:center;background:#eef4ff;border-radius:8px;">
                  <span style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#1d4ed8;">${otp}</span>
                </div>
                <p style="margin:0 0 8px;line-height:1.6;color:#52606d;">
                  The code expires in ${expiresInMinutes} minutes.
                </p>
                <p style="margin:0;line-height:1.6;color:#52606d;">
                  If you did not create a MediSense account, you can ignore this email.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:12px;color:#7b8794;">
            MediSense — Real-Time Health Monitoring System
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
