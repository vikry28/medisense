/**
 * Environment defaults for the e2e suite. Jest runs `setupFiles` before the
 * test module is imported, so these values are in place before
 * `ConfigModule.forRoot()` validates the environment.
 *
 * Values set explicitly by the CI job or the shell win over these defaults.
 */
process.env.MQTT_ENABLED ??= "false";
process.env.PAIRING_ALLOW_DEVICE_CODE ??= "true";
process.env.JWT_ACCESS_SECRET ??=
  "test-access-secret-change-me-at-least-32-chars";
process.env.PAIRING_CODE_PEPPER ??= "test-pairing-pepper-change-me";
process.env.EMAIL_OTP_PEPPER ??= "test-email-otp-pepper-change-me";

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
