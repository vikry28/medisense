import * as Joi from "joi";

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "test", "production")
    .default("development"),
  PORT: Joi.number().port().default(3000),
  API_PREFIX: Joi.string().default("api/v1"),
  CORS_ORIGINS: Joi.string().default("*"),
  LOG_LEVEL: Joi.string()
    .valid("fatal", "error", "warn", "info", "debug", "trace", "silent")
    .default("info"),
  SWAGGER_ENABLED: Joi.boolean().default(true),

  DATABASE_URL: Joi.string().required(),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL_SECONDS: Joi.number().integer().positive().default(900),
  JWT_REFRESH_TTL_DAYS: Joi.number().integer().positive().default(30),
  JWT_ISSUER: Joi.string().default("medisense"),
  JWT_AUDIENCE: Joi.string().default("medisense-app"),

  PAIRING_CODE_PEPPER: Joi.string().min(16).required(),
  PAIRING_CODE_TTL_MINUTES: Joi.number().integer().positive().default(15),
  PAIRING_ALLOW_DEVICE_CODE: Joi.boolean().default(false),

  EMAIL_OTP_PEPPER: Joi.string().min(16).required(),
  EMAIL_OTP_TTL_MINUTES: Joi.number().integer().positive().default(10),
  EMAIL_OTP_MAX_ATTEMPTS: Joi.number().integer().min(1).default(5),
  EMAIL_OTP_RESEND_COOLDOWN_SECONDS: Joi.number().integer().min(1).default(60),

  MAIL_TRANSPORT: Joi.string().valid("console", "smtp").default("console"),
  SMTP_HOST: Joi.string().default("localhost"),
  SMTP_PORT: Joi.number().port().default(1025),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().allow("").optional(),
  SMTP_PASSWORD: Joi.string().allow("").optional(),
  SMTP_FROM: Joi.string().default("MediSense <no-reply@medisense.local>"),

  MQTT_ENABLED: Joi.boolean().default(true),
  MQTT_URL: Joi.string().default("mqtt://localhost:1883"),
  MQTT_USERNAME: Joi.string().allow("").optional(),
  MQTT_PASSWORD: Joi.string().allow("").optional(),
  MQTT_CLIENT_ID: Joi.string().default("medisense-backend"),
  MQTT_TOPIC_PREFIX: Joi.string().default("medisense"),
  MQTT_REJECT_UNAUTHORIZED: Joi.boolean().default(true),
  MQTT_CA_PATH: Joi.string().allow("").optional(),
  MQTT_CERT_PATH: Joi.string().allow("").optional(),
  MQTT_KEY_PATH: Joi.string().allow("").optional(),

  DEVICE_OFFLINE_THRESHOLD_SECONDS: Joi.number()
    .integer()
    .positive()
    .default(90),
  DEVICE_SWEEPER_INTERVAL_MS: Joi.number().integer().min(5000).default(30000),

  SEED_DEMO_EMAIL: Joi.string().default("demo@medisense.local"),
  SEED_DEMO_PASSWORD: Joi.string().default("Demo1234!"),
  SEED_DEVICE_PAIRING_CODE: Joi.string().default("123456"),
}).unknown(true);
