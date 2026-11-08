# MediSense — Real-Time Health Monitoring System

MediSense is an IoT healthcare monitoring portfolio project: an ESP32-based
sensor device streams heart rate, SpO2 and body temperature through MQTT, a
NestJS backend validates and stores the data, and a Flutter app displays live
readings, charts and threshold alerts over REST and WebSocket.

> **Demonstration project only.** Measurements and alerts are not medical
> diagnoses and must not be used for clinical decisions.

## Repository layout

```text
MediSense/
├── backend/                 NestJS REST API, MQTT ingestion, Socket.IO gateway
│   ├── prisma/              schema, migration, seed
│   ├── src/                 application source
│   └── test/                opt-in database e2e spec
├── infrastructure/          Docker Compose, Mosquitto config, project docs
│   ├── docker-compose.yml
│   ├── mosquitto/
│   └── doc/
│       ├── architecture.md
│       └── api-specification.md
├── simulator/               MQTT device simulator (next milestone)
└── firmware/                ESP32 firmware (next milestone)
```

## Documentation

| Document | Contents |
| --- | --- |
| [`infrastructure/doc/architecture.md`](infrastructure/doc/architecture.md) | System design, data flows, security, deployment |
| [`infrastructure/doc/api-specification.md`](infrastructure/doc/api-specification.md) | REST, WebSocket and MQTT contracts |
| [`backend/README.md`](backend/README.md) | Backend setup, API summary, operations |
| Swagger UI | <http://localhost:3000/docs> once the stack is running |

## Quick start

Requirements: Docker Desktop (or Docker Engine + Compose v2).

```bash
cd infrastructure
cp .env.example .env
docker compose up -d --build
docker compose exec backend npx prisma db seed
```

Then:

- REST API: <http://localhost:3000/api/v1>
- Swagger: <http://localhost:3000/docs>
- Readiness: <http://localhost:3000/health/ready>
- MQTT broker: `mqtt://localhost:1883`
- Mailpit (verification emails): <http://localhost:8025>

New accounts must verify their email with a 6-digit code before they can log in.
In the Compose stack the code is delivered to Mailpit.

Demo credentials created by the seed:

```text
email:    demo@medisense.local
password: Demo1234!
```

The demo account is already email-verified. `ESP32-001` is pre-paired with the
demo user. `ESP32-002` is unpaired with pairing code `123456`.

## Implemented scope

- Email/password auth with Argon2id, JWT access tokens and rotating refresh
  token families
- Email verification with expiring 6-digit OTP codes (Mailpit/SMTP in development)
- User profile and password management
- Device pairing, pairing-code regeneration, rename and unpair
- MQTT telemetry ingestion with validation, idempotency and presence tracking
- Measurement history, latest value and bucketed chart series
- Per-user alert thresholds, alert history and read state
- Socket.IO real-time measurement, device-status and alert events
- PostgreSQL schema, migrations, seed and Docker Compose stack
- Health probes, structured logging, rate limiting and Swagger

Not implemented in this milestone: PDF export, push notifications,
caregiver/admin workflows, MQTT simulator and ESP32 firmware.
