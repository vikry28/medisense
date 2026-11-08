# MediSense Backend

Real-time health monitoring backend built with **NestJS 11**, **PostgreSQL**, **Prisma**, **MQTT** and **Socket.IO**.

The backend:

- serves the REST API used by the Flutter app,
- consumes telemetry from ESP32 devices (or the MQTT simulator) over MQTT,
- validates, deduplicates and persists measurements,
- evaluates per-user thresholds and creates alerts,
- pushes measurements, device status and alerts to authenticated Socket.IO clients.

> This is a portfolio / demonstration project. Measurements and alerts are not medical diagnoses and must not be used for clinical decisions.

Related documents:

- [`../infrastructure/doc/architecture.md`](../infrastructure/doc/architecture.md)
- [`../infrastructure/doc/api-specification.md`](../infrastructure/doc/api-specification.md)

## Stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js 22 LTS, TypeScript 5.9 |
| Framework | NestJS 11 (Express) |
| Database | PostgreSQL 18, Prisma 6 |
| Real-time | Socket.IO 4 |
| IoT | MQTT 5 (`mqtt` package), Eclipse Mosquitto 2 |
| Auth | Argon2id, JWT access token + rotating opaque refresh token |
| Validation | class-validator / class-transformer |
| Documentation | Swagger / OpenAPI at `/docs` |
| Logging | pino (`nestjs-pino`) with secret redaction |

## Quick start (Docker)

Docker Compose lives in `../infrastructure`.

```bash
cd infrastructure
cp .env.example .env       # change all secrets for anything other than local dev
docker compose up -d --build
```

The backend container:

1. waits for PostgreSQL,
2. runs `prisma migrate deploy`,
3. starts the API on <http://localhost:3000>.

Seed demo data once the stack is healthy:

```bash
docker compose exec backend npx prisma db seed
```

Then:

- API: <http://localhost:3000/api/v1>
- Swagger: <http://localhost:3000/docs>
- Readiness: <http://localhost:3000/health/ready>

Demo account created by the seed:

```text
email:    demo@medisense.local
password: Demo1234!
```

Seeded devices:

| Device | Purpose | Pairing |
| --- | --- | --- |
| `ESP32-001` | Pre-paired with the demo user, intended for the MQTT simulator | none |
| `ESP32-002` | Pairing demo from the Flutter app | code `123456` (valid 30 days) |

> The host PostgreSQL port defaults to **5433** because port 5432 is commonly already in use. Change `POSTGRES_PORT` in `infrastructure/.env` if needed.

## Local development (without Docker)

Requirements: Node.js 22+, PostgreSQL 14+ (for `date_bin`), Mosquitto 2+.

```bash
cp .env.example .env
npm install
npx prisma migrate deploy
npx prisma db seed
npm run start:dev
```

The default `.env` expects PostgreSQL on `localhost:5433` and MQTT on `localhost:1883`.

If you run only PostgreSQL/Mosquitto from Compose while the API runs on the host, use:

```bash
cd infrastructure
docker compose up -d postgres mosquitto-init mosquitto
```

## Environment variables

See `.env.example`. Important values:

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://...@localhost:5433/medisense` | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | dev secret | Minimum 32 characters; change outside development |
| `JWT_ACCESS_TTL_SECONDS` | `900` | Access token lifetime |
| `JWT_REFRESH_TTL_DAYS` | `30` | Refresh token lifetime |
| `PAIRING_CODE_PEPPER` | dev pepper | Must match the seed when generating pairing codes |
| `PAIRING_ALLOW_DEVICE_CODE` | `true` in `.env.example` | Allow pairing with `deviceCode` alone; **must be `false` in production** |
| `MQTT_ENABLED` | `true` | Set `false` to run REST/WS without a broker |
| `MQTT_URL` | `mqtt://localhost:1883` | Use `mqtts://` plus `MQTT_REJECT_UNAUTHORIZED=true` in production |
| `MQTT_TOPIC_PREFIX` | `medisense` | Topic namespace |
| `DEVICE_OFFLINE_THRESHOLD_SECONDS` | `90` | Presence timeout for the sweeper |
| `CORS_ORIGINS` | `*` | Comma-separated allowlist |

## API

Base path: `/api/v1`. Success responses use `{ "data": ..., "meta": ... }`; errors use RFC 9457-style `application/problem+json` with a stable `code`.

### Auth

| Method | Path | Description |
| --- | --- | --- |
| POST | `/auth/register` | Register and receive tokens |
| POST | `/auth/login` | Email + password login |
| POST | `/auth/refresh` | Rotate refresh token |
| POST | `/auth/logout` | Revoke one refresh token |
| POST | `/auth/logout-all` | Revoke every session for the current user |

Refresh tokens are opaque, hashed at rest, rotated on use, and protected by reuse detection (reuse revokes the whole token family).

### Users

| Method | Path | Description |
| --- | --- | --- |
| GET | `/users/me` | Current profile |
| PATCH | `/users/me` | Update `name` / `timezone` |
| PUT | `/users/me/password` | Change password and revoke all sessions |

### Devices

| Method | Path | Description |
| --- | --- | --- |
| GET | `/devices` | Devices paired to the current user |
| POST | `/devices/pair` | Pair with `{ deviceCode, pairingCode?, name? }` |
| GET | `/devices/:id` | Device details, status and `lastSeenAt` |
| PATCH | `/devices/:id` | Rename |
| DELETE | `/devices/:id` | Unpair (history is preserved) |
| POST | `/devices/:id/pairing-code` | Generate a new 6-digit code after unpairing |

When `PAIRING_ALLOW_DEVICE_CODE=true`, `pairingCode` may be omitted for local
development and simulator demos. Normal pairing still uses the six-digit code
stored as an HMAC hash with an expiry.

### Measurements

| Method | Path | Description |
| --- | --- | --- |
| GET | `/measurements/latest?deviceId=` | Latest measurement |
| GET | `/measurements?deviceId=&parameter=&from=&to=&cursor=&limit=` | Cursor-paginated history |
| GET | `/measurements/:id` | Measurement detail |
| GET | `/measurements/series?from=&to=&bucket=5m` | Bucketed averages for charts |

`parameter` is one of `HEART_RATE`, `SPO2`, `TEMPERATURE`. `bucket` is one of `1m`, `5m`, `15m`, `1h`, `1d`.

### Alerts

| Method | Path | Description |
| --- | --- | --- |
| GET | `/alerts?status=&parameter=&from=&to=&cursor=&limit=` | Alert history |
| GET | `/alerts/config` | Thresholds |
| PUT | `/alerts/config` | Bulk upsert thresholds |
| PATCH | `/alerts/:id/read` | Mark one alert read |
| PATCH | `/alerts/read-all` | Mark all alerts read |

Default demonstration thresholds:

| Parameter | Min | Max |
| --- | --- | --- |
| Heart rate | 50 bpm | 100 bpm |
| SpO2 | 95 % | 100 % |
| Body temperature | 36.1 °C | 37.5 °C |

### Health

- `GET /health/live` — process liveness, no dependencies.
- `GET /health/ready` — database check; reports MQTT connectivity as `degraded` when disconnected.

## MQTT contract

Topics:

```text
medisense/device/{deviceCode}/telemetry   device -> backend
medisense/device/{deviceCode}/status      device -> backend (online/offline/LWT)
medisense/device/{deviceCode}/command     backend -> device (reserved)
```

Telemetry payload:

```json
{
  "deviceCode": "ESP32-001",
  "messageId": "a6a2c7f2-8a6c-4b8f-9d0e-5f1c2b3a4d5e",
  "sequence": 1024,
  "timestamp": "2026-11-04T12:00:00.000Z",
  "measurements": {
    "heartRate": 78,
    "spo2": 98,
    "temperature": 36.7
  },
  "signalQuality": "good",
  "firmwareVersion": "1.0.0"
}
```

Ingestion rules:

- `deviceCode` must match the MQTT topic.
- `messageId` is unique per device; duplicates are ignored.
- Payload fields are strictly validated (`400`-style rejection is logged, not returned over MQTT).
- Sensor ranges: heart rate 20–250, SpO2 50–100, temperature 30–45.
- Timestamps may be at most 24 hours old and 5 minutes in the future.
- The device must be paired with an active user assignment.

Status payload:

```json
{ "status": "online", "firmwareVersion": "1.0.0" }
```

Use a retained `{ "status": "offline" }` MQTT Last Will for disconnect detection. A sweeper also marks devices offline when `lastSeenAt` exceeds `DEVICE_OFFLINE_THRESHOLD_SECONDS`.

### Broker credentials (development defaults)

Generated by `mosquitto-init` from `infrastructure/.env`:

| Username | Password | Access |
| --- | --- | --- |
| `medi-backend` | `backend-secret` | Read all telemetry/status |
| `ESP32-001` | `device-secret-001` | Publish only its own topics |
| `ESP32-002` | `device-secret-002` | Publish only its own topics |

Change these before exposing the broker. The ACL file restricts each device to `medisense/device/%u/telemetry` and `.../status`.

## WebSocket contract

Namespace: `/realtime`. Authenticate during the Socket.IO handshake:

```js
const socket = io('http://localhost:3000/realtime', {
  auth: { token: accessToken },
  transports: ['websocket'],
});
```

Client events:

| Event | Payload | Description |
| --- | --- | --- |
| `device:subscribe` | `{ deviceId }` | Join the device measurement room (ownership checked) |
| `device:unsubscribe` | `{ deviceId }` | Leave the room |

Server events:

| Event | Room | Description |
| --- | --- | --- |
| `measurement:update` | `device:{deviceId}` | New measurement |
| `device:status` | `user:{userId}` | Online/offline change |
| `alert:new` | `user:{userId}` | New threshold alert |
| `exception` | socket | Error from a client event |

Clients automatically join `user:{userId}` on connect; measurements require an explicit `device:subscribe`.

## Data model

`prisma/schema.prisma` contains:

- `users`
- `refresh_tokens`
- `devices`
- `device_assignments` (partial unique index enforces one active assignment per device)
- `measurements`
- `alert_configs`
- `alerts`

`measurements` and `alerts` store `user_id` in addition to `device_id` so history survives unpairing and authorization queries stay efficient.

## Project structure

```text
src/
├── common/          # guards, filters, errors, pagination, crypto/password utils
├── config/          # environment validation (Joi)
├── prisma/          # PrismaService
└── modules/
    ├── auth/        # register/login/refresh/logout
    ├── users/       # profile + password
    ├── devices/     # pairing, presence sweeper
    ├── measurements/# history, series, telemetry ingestion
    ├── alerts/      # thresholds, evaluator, alert history
    ├── mqtt/        # broker consumer and routing
    ├── realtime/    # Socket.IO gateway
    └── health/      # liveness/readiness
prisma/
├── schema.prisma
├── migrations/
└── seed.ts
test/                # e2e specs (database required)
```

## Testing

```bash
npm test          # unit tests (no database needed)
npm run build     # type-check + production build
```

Integration/e2e tests require a **separate** PostgreSQL database:

```bash
createdb -U medisense medisense_test   # or use Docker
DATABASE_URL=postgresql://medisense:medisense@localhost:5433/medisense_test npx prisma migrate deploy
TEST_DATABASE_URL=postgresql://medisense:medisense@localhost:5433/medisense_test npm run test:e2e
```

Current unit coverage includes the alert evaluator, telemetry validation and pagination cursors.

## Security notes

- Argon2id password hashing.
- Short-lived JWT access tokens; rotating refresh token families with reuse detection.
- Every device, measurement and alert query is scoped by `user_id`; cross-account access returns `404`.
- MQTT ACL limits each device to its own topic; TLS is expected in production.
- Global rate limiting plus stricter limits on auth endpoints.
- Helmet, CORS allowlist, 64 KB body limit.
- Secrets and sensitive request fields are redacted from logs.
- Pairing codes are stored as HMAC-SHA256 hashes and expire. Development pairing
  by `deviceCode` is opt-in through `PAIRING_ALLOW_DEVICE_CODE` and must be
  disabled in production.

Before production: change all development secrets, enable MQTT TLS, run multiple instances behind a shared rate limiter (Redis), add a Redis adapter for Socket.IO, add backup/retention policies, and review healthcare data compliance requirements.

## Out of scope for this backend milestone

- PDF report export (PRD FR-023, low priority)
- Push notifications (in-app WebSocket alerts only)
- Caregiver and administrator workflows
- MQTT simulator application (next milestone)
