import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/modules/mail/mail.service';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const describeWithDatabase = TEST_DATABASE_URL ? describe : describe.skip;

interface CapturedMail {
  to: string;
  otp: string;
  expiresAt: Date;
}

describeWithDatabase('MediSense HTTP API (e2e)', () => {
  let app: INestApplication;
  const capturedMail: CapturedMail[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.MQTT_ENABLED = 'false';
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ??
      'test-access-secret-change-me-at-least-32-chars';
    process.env.PAIRING_CODE_PEPPER =
      process.env.PAIRING_CODE_PEPPER ?? 'test-pairing-pepper-change-me';
    process.env.EMAIL_OTP_PEPPER =
      process.env.EMAIL_OTP_PEPPER ?? 'test-email-otp-pepper-change-me';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailService)
      .useValue({
        sendEmailVerificationOtp: async (input: CapturedMail) => {
          capturedMail.push(input);
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', {
      exclude: ['health/live', 'health/ready'],
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('exposes liveness without authentication', async () => {
    const response = await request(app.getHttpServer()).get('/health/live');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('requires email verification before issuing tokens', async () => {
    const email = `e2e-${Date.now()}@medisense.local`;
    const password = 'Passw0rd123';

    const register = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'E2E User', email, password })
      .expect(201);

    expect(register.body.data.verificationRequired).toBe(true);
    expect(register.body.data.tokens).toBeUndefined();
    expect(register.body.data.user.emailVerified).toBe(false);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(403);

    expect(login.body.code).toBe('AUTH_EMAIL_NOT_VERIFIED');

    const captured = capturedMail.filter((mail) => mail.to === email).at(-1);
    expect(captured?.otp).toMatch(/^\d{6}$/);

    const wrongCode = captured!.otp === '000000' ? '111111' : '000000';
    const invalid = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ email, otp: wrongCode })
      .expect(400);

    expect(invalid.body.code).toBe('AUTH_OTP_INVALID');

    const verify = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ email, otp: captured!.otp })
      .expect(200);

    expect(verify.body.data.tokens.accessToken).toEqual(expect.any(String));
    expect(verify.body.data.tokens.refreshToken).toEqual(expect.any(String));
    expect(verify.body.data.user.emailVerified).toBe(true);

    const profile = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${verify.body.data.tokens.accessToken}`)
      .expect(200);

    expect(profile.body.data.email).toBe(email);
    expect(profile.body.data.emailVerified).toBe(true);

    const secondLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    const refresh = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: secondLogin.body.data.tokens.refreshToken })
      .expect(200);

    expect(refresh.body.data.refreshToken).not.toBe(
      secondLogin.body.data.tokens.refreshToken,
    );
  });

  it('does not reveal whether an email exists when resending', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send({ email: `missing-${Date.now()}@medisense.local` })
      .expect(200);

    expect(response.body.data.sent).toBe(true);
  });

  it('rejects unauthenticated profile access', async () => {
    await request(app.getHttpServer()).get('/api/v1/users/me').expect(401);
  });
});
