import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { AlertsModule } from "../alerts/alerts.module";
import { MailModule } from "../mail/mail.module";
import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { EmailVerificationService } from "./email-verification.service";
import { TokenService } from "./token.service";

@Module({
  imports: [
    UsersModule,
    AlertsModule,
    MailModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>("JWT_ACCESS_SECRET"),
        signOptions: {
          expiresIn: config.get<number>("JWT_ACCESS_TTL_SECONDS", 900),
          issuer: config.get<string>("JWT_ISSUER", "medisense"),
          audience: config.get<string>("JWT_AUDIENCE", "medisense-app"),
        },
        verifyOptions: {
          issuer: config.get<string>("JWT_ISSUER", "medisense"),
          audience: config.get<string>("JWT_AUDIENCE", "medisense-app"),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService, EmailVerificationService],
  exports: [AuthService, TokenService, EmailVerificationService, JwtModule],
})
export class AuthModule {}
