# MediSense — API Specification

> Portfolio / demonstration system. Measurements and alerts are **not** medical
> diagnoses and must not be used for clinical decisions.

This document describes the HTTP REST API, the Socket.IO real-time protocol and
the MQTT device protocol implemented by the backend.

- Architecture: [`architecture.md`](./architecture.md)
- Interactive OpenAPI: `http://localhost:3000/docs` (Swagger UI)
- Backend source: `../../backend`

---

## 1. Conventions

### 1.1 Base URLs

| Interface | URL |
| --- | --- |
| REST API | `http://localhost:3000/api/v1` |
| Liveness | `http://localhost:3000/health/live` |
| Readiness | `http://localhost:3000/health/ready` |
| Swagger UI | `http://localhost:3000/docs` |
| Socket.IO | `http://localhost:3000/realtime` (namespace) |
| MQTT broker | `mqtt://localhost:1883` |

The health endpoints are intentionally excluded from the `/api/v1` prefix so
orchestrators can probe them without knowing the API version.

### 1.2 Authentication

All endpoints except the following require a Bearer access token:

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `GET /health/live`
- `GET /health/ready`

Header:

```http
Authorization: Bearer <accessToken>
```

Access tokens are JWTs signed with HS256. Claims:

```json
{
  "sub": "0f1b8a6e-4b1a-4b1a-9b1a-1a2b3c4d5e6f",
  "email": "demo@medisense.local",
  "role": "USER",
  "iss": "medisense",
  "aud": "medisense-app",
  "iat": 1793952000,
  "exp": 1793952900
}
```

### 1.3 Content types

- Requests: `application/json`
- Successful responses: `application/json`
- Error responses: `application/problem+json`
- Maximum body size: 64 KB

### 1.4 Success envelope

Single resources and command results:

```json
{ "data": { } }
```

Collections add pagination metadata:

```json
{
  "data": [],
  "meta": {
    "limit": 50,
    "hasMore": false,
    "nextCursor": null
  }
}
```

`204 No Content` responses have no body.

### 1.5 Error envelope

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "Request validation failed.",
  "code": "VALIDATION_ERROR",
  "details": {
    "errors": ["email must be an email"]
  },
  "instance": "/api/v1/auth/register",
  "requestId": "0b6c2d4e-5f6a-4b3c-8d9e-0f1a2b3c4d5e",
  "timestamp": "2026-11-07T10:15:30.000Z"
}
```

| Field | Description |
| --- | --- |
| `type` | Always `about:blank` in this milestone |
| `title` | HTTP status phrase |
| `status` | HTTP status code |
| `detail` | Human-readable English message |
| `code` | Stable machine-readable code (see 1.6) |
| `details` | Optional structured context |
| `instance` | Request path |
| `requestId` | Request ID, also returned as `x-request-id` |
| `timestamp` | Server time in ISO 8601 UTC |

### 1.6 Error codes

| Code | Typical status | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Invalid body, query, path parameter or cursor |
| `INVALID_CURSOR` | 400 | Malformed pagination cursor |
| `AUTH_UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `AUTH_TOKEN_INVALID` | 401 | Access token invalid or expired |
| `AUTH_INVALID_CREDENTIALS` | 401 | Wrong email/password or wrong current password |
| `AUTH_REFRESH_INVALID` | 401 | Refresh token not found |
| `AUTH_REFRESH_EXPIRED` | 401 | Refresh token expired |
| `AUTH_REFRESH_REUSED` | 401 | Revoked refresh token reused; family revoked |
| `AUTH_EMAIL_TAKEN` | 409 | Email already registered |
| `FORBIDDEN` | 403 | Authenticated but not allowed |
| `NOT_FOUND` | 404 | Generic resource not found |
| `CONFLICT` | 409 | Generic unique-constraint conflict |
| `DEVICE_NOT_FOUND` | 404 | Device unknown or not owned by the caller |
| `DEVICE_ALREADY_PAIRED` | 409 | Device already has an active assignment |
| `DEVICE_PAIRING_CODE_INVALID` | 400 | Missing, wrong or absent pairing code |
| `DEVICE_PAIRING_CODE_EXPIRED` | 400 | Pairing code expired |
| `MEASUREMENT_NOT_FOUND` | 404 | Measurement not found for the caller |
| `ALERT_NOT_FOUND` | 404 | Alert not found for the caller |
| `RATE_LIMITED` | 429 | Too many requests |
| `SERVICE_UNAVAILABLE` | 503 | Required dependency unavailable |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

### 1.7 Validation rules

- Request bodies use a strict whitelist. **Unknown fields are rejected with 400.**
- Query strings are validated too. **Unknown query parameters are rejected with
  400.**
- Enums are case-sensitive and uppercase (`HEART_RATE`, `UNREAD`, ...).
- UUID path parameters must be valid UUIDs.
- Dates and timestamps use ISO 8601 (`2026-11-04T12:00:00.000Z`).
- Numeric query parameters (`limit`) are converted explicitly.

### 1.8 Pagination

List endpoints use opaque cursor pagination.

- Default `limit`: `50`; maximum `200`.
- Cursor format: base64url of `<ISO timestamp>|<uuid>`. Treat it as opaque.
- Ordering: newest first.
- Pass `meta.nextCursor` as `cursor` to fetch the next page.
- A malformed cursor returns `400 INVALID_CURSOR`.

### 1.9 Rate limiting

Rate limits are per client IP per minute.

| Scope | Limit |
| --- | --- |
| Global default | 100 requests/min |
| `POST /auth/register` | 5 requests/min |
| `POST /auth/login` | 10 requests/min |
| `POST /auth/refresh` | 30 requests/min |

Exceeding a limit returns `429` with `code: "RATE_LIMITED"`.

---

## 2. Authentication

### 2.1 Register

```http
POST /api/v1/auth/register
Content-Type: application/json
```

Request:

```json
{
  "name": "Demo User",
  "email": "demo@medisense.local",
  "password": "Demo1234!"
}
```

| Field | Type | Rules |
| --- | --- | --- |
| `name` | string | 2–100 characters |
| `email` | string | Valid email, max 255; normalized to lowercase |
| `password` | string | 8–128 characters, at least one letter and one digit |

Response `201 Created`:

```json
{
  "data": {
    "user": {
      "id": "0f1b8a6e-4b1a-4b1a-9b1a-1a2b3c4d5e6f",
      "name": "Demo User",
      "email": "demo@medisense.local",
      "role": "USER",
      "timezone": "Asia/Jakarta",
      "createdAt": "2026-11-07T10:00:00.000Z",
      "updatedAt": "2026-11-07T10:00:00.000Z"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "P7bq...opaque...",
      "tokenType": "Bearer",
      "expiresIn": 900
    }
  }
}
```

Errors:

- `409 AUTH_EMAIL_TAKEN`
- `400 VALIDATION_ERROR`

Registration also creates the three default alert configurations.

### 2.2 Login

```http
POST /api/v1/auth/login
Content-Type: application/json
```

Request:

```json
{
  "email": "demo@medisense.local",
  "password": "Demo1234!"
}
```

Response `200 OK`: same `{ data: { user, tokens } }` shape as register.

Errors:

- `401 AUTH_INVALID_CREDENTIALS` (same message for unknown email and wrong
  password)
- `429 RATE_LIMITED`

### 2.3 Refresh

```http
POST /api/v1/auth/refresh
Content-Type: application/json
```

Request:

```json
{
  "refreshToken": "P7bq...opaque..."
}
```

Response `200 OK`:

```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "new-opaque-token...",
    "tokenType": "Bearer",
    "expiresIn": 900
  }
}
```

The supplied refresh token is revoked and replaced. Reusing an already rotated
token returns `401 AUTH_REFRESH_REUSED` and revokes every active token in that
family.

Errors:

- `401 AUTH_REFRESH_INVALID`
- `401 AUTH_REFRESH_EXPIRED`
- `401 AUTH_REFRESH_REUSED`

### 2.4 Logout

```http
POST /api/v1/auth/logout
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Request:

```json
{
  "refreshToken": "P7bq...opaque..."
}
```

Response `204 No Content`.

### 2.5 Logout all sessions

```http
POST /api/v1/auth/logout-all
Authorization: Bearer <accessToken>
```

Response `204 No Content`. Revokes every active refresh token for the user.
Already-issued access tokens remain valid until their `exp` time.

---

## 3. Users

### 3.1 Get profile

```http
GET /api/v1/users/me
Authorization: Bearer <accessToken>
```

Response `200 OK`:

```json
{
  "data": {
    "id": "0f1b8a6e-4b1a-4b1a-9b1a-1a2b3c4d5e6f",
    "name": "Demo User",
    "email": "demo@medisense.local",
    "role": "USER",
    "timezone": "Asia/Jakarta",
    "createdAt": "2026-11-07T10:00:00.000Z",
    "updatedAt": "2026-11-07T10:00:00.000Z"
  }
}
```

### 3.2 Update profile

```http
PATCH /api/v1/users/me
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Request (at least one field expected in practice):

```json
{
  "name": "Vikry",
  "timezone": "Asia/Jakarta"
}
```

| Field | Type | Rules |
| --- | --- | --- |
| `name` | string? | 2–100 characters |
| `timezone` | string? | 1–64 characters; stored as provided |

Response `200 OK` with the updated user object.

### 3.3 Change password

```http
PUT /api/v1/users/me/password
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Request:

```json
{
  "currentPassword": "Demo1234!",
  "newPassword": "NewPassw0rd!"
}
```

| Field | Type | Rules |
| --- | --- | --- |
| `currentPassword` | string | max 128, must match |
| `newPassword` | string | 8–128, at least one letter and one digit |

Response `204 No Content`. All refresh tokens are revoked; the client must log in
again.

Errors:

- `401 AUTH_INVALID_CREDENTIALS` when `currentPassword` is wrong.

---

## 4. Devices

Device object:

```json
{
  "id": "6a2f1c7e-2b4d-4f8a-9c1e-7d3b5a9f0e21",
  "deviceCode": "ESP32-002",
  "name": "Demo Sensor 002",
  "type": "ESP32",
  "status": "OFFLINE",
  "firmwareVersion": null,
  "lastSeenAt": null,
  "assignedAt": "2026-11-07T10:05:00.000Z",
  "createdAt": "2026-11-07T09:00:00.000Z",
  "updatedAt": "2026-11-07T10:05:00.000Z"
}
```

| Field | Description |
| --- | --- |
| `id` | Internal UUID used by the API |
| `deviceCode` | Stable device identifier, also used in MQTT topics |
| `name` | User-visible display name |
| `type` | Device type, default `ESP32` |
| `status` | `ONLINE` or `OFFLINE` |
| `firmwareVersion` | Last reported version, or `null` |
| `lastSeenAt` | Last telemetry/status timestamp, or `null` |
| `assignedAt` | Present on list/get/pair responses; absent on rename |
| `createdAt`, `updatedAt` | ISO timestamps |

### 4.1 List paired devices

```http
GET /api/v1/devices
Authorization: Bearer <accessToken>
```

Response `200 OK`:

```json
{
  "data": [
    {
      "id": "6a2f1c7e-2b4d-4f8a-9c1e-7d3b5a9f0e21",
      "deviceCode": "ESP32-002",
      "name": "Demo Sensor 002",
      "type": "ESP32",
      "status": "ONLINE",
      "firmwareVersion": "1.0.0",
      "lastSeenAt": "2026-11-07T10:15:00.000Z",
      "assignedAt": "2026-11-07T10:05:00.000Z",
      "createdAt": "2026-11-07T09:00:00.000Z",
      "updatedAt": "2026-11-07T10:15:00.000Z"
    }
  ]
}
```

Only devices with an active assignment are returned.

### 4.2 Pair a device

```http
POST /api/v1/devices/pair
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Request:

```json
{
  "deviceCode": "ESP32-002",
  "pairingCode": "123456",
  "name": "My Sensor"
}
```

| Field | Type | Rules |
| --- | --- | --- |
| `deviceCode` | string | `^[A-Za-z0-9_-]{3,64}$` |
| `pairingCode` | string? | Exactly 6 digits; required unless development pairing is enabled |
| `name` | string? | 2–100 characters; overrides the seeded name |

Development pairing: when `PAIRING_ALLOW_DEVICE_CODE=true` (set in the provided
`infrastructure/.env.example` for local development), `pairingCode` may be
omitted. The device must still be unpaired. **Never enable this in production.**

Response `201 Created`:

```json
{
  "data": {
    "id": "6a2f1c7e-2b4d-4f8a-9c1e-7d3b5a9f0e21",
    "deviceCode": "ESP32-002",
    "name": "My Sensor",
    "type": "ESP32",
    "status": "OFFLINE",
    "firmwareVersion": null,
    "lastSeenAt": null,
    "assignedAt": "2026-11-07T10:05:00.000Z",
    "createdAt": "2026-11-07T09:00:00.000Z",
    "updatedAt": "2026-11-07T10:05:00.000Z"
  }
}
```

Errors:

- `404 DEVICE_NOT_FOUND`
- `409 DEVICE_ALREADY_PAIRED`
- `400 DEVICE_PAIRING_CODE_INVALID`
- `400 DEVICE_PAIRING_CODE_EXPIRED`

Pairing consumes the code: it is cleared from the device row.

### 4.3 Get device

```http
GET /api/v1/devices/{id}
Authorization: Bearer <accessToken>
```

Response `200 OK` with the device object. Returns `404 DEVICE_NOT_FOUND` for a
device that is not actively assigned to the caller.

### 4.4 Rename device

```http
PATCH /api/v1/devices/{id}
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Request:

```json
{ "name": "Living Room Sensor" }
```

Response `200 OK` with the device object (no `assignedAt` field).

### 4.5 Unpair device

```http
DELETE /api/v1/devices/{id}
Authorization: Bearer <accessToken>
```

Response `204 No Content`.

Effects:

- closes the active assignment (`unassigned_at` set),
- marks the device `OFFLINE`,
- emits `device:status` to the user's WebSocket room,
- preserves all measurements and alerts for history.

### 4.6 Generate a new pairing code

```http
POST /api/v1/devices/{id}/pairing-code
Authorization: Bearer <accessToken>
```

The caller must have previously paired this device, and the device must currently
be **unpaired**. This lets a user re-pair a device after unpairing it.

Response `201 Created`:

```json
{
  "data": {
    "pairingCode": "482913",
    "expiresAt": "2026-11-07T10:30:00.000Z"
  }
}
```

Errors:

- `404 DEVICE_NOT_FOUND` when the caller never paired this device
- `409 DEVICE_ALREADY_PAIRED` when the device is currently assigned

The code lifetime is `PAIRING_CODE_TTL_MINUTES` (default 15 minutes).

---

## 5. Measurements

Measurement object:

```json
{
  "id": "b1c2d3e4-f5a6-4b7c-8d9e-0a1b2c3d4e5f",
  "deviceId": "6a2f1c7e-2b4d-4f8a-9c1e-7d3b5a9f0e21",
  "userId": "0f1b8a6e-4b1a-4b1a-9b1a-1a2b3c4d5e6f",
  "messageId": "a6a2c7f2-8a6c-4b8f-9d0e-5f1c2b3a4d5e",
  "sequence": 1024,
  "heartRate": 78,
  "spo2": 98,
  "temperature": 36.7,
  "signalQuality": "GOOD",
  "measuredAt": "2026-11-04T12:00:00.000Z",
  "receivedAt": "2026-11-04T12:00:01.250Z"
}
```

| Field | Description |
| --- | --- |
| `messageId` | Device-generated idempotency key, unique per device |
| `sequence` | Optional device sequence number, or `null` |
| `heartRate` | bpm, or `null` when not measured |
| `spo2` | percent, or `null` |
| `temperature` | °C with up to 2 decimals, or `null` |
| `signalQuality` | `GOOD`, `FAIR`, `POOR` |
| `measuredAt` | Device timestamp |
| `receivedAt` | Server ingestion timestamp |

### 5.1 Latest measurement

```http
GET /api/v1/measurements/latest
GET /api/v1/measurements/latest?deviceId={uuid}
Authorization: Bearer <accessToken>
```

Response `200 OK`:

```json
{ "data": { "id": "b1c2d3e4-...", "heartRate": 78, "...": "..." } }
```

Returns `{ "data": null }` when the user has no measurements.

If `deviceId` is supplied, ownership is checked and only that device is
considered.

### 5.2 List measurement history

```http
GET /api/v1/measurements?deviceId={uuid}&parameter=HEART_RATE&from={iso}&to={iso}&cursor={cursor}&limit=50
Authorization: Bearer <accessToken>
```

| Query | Type | Rules |
| --- | --- | --- |
| `deviceId` | UUID? | Must be actively assigned to the caller |
| `parameter` | enum? | `HEART_RATE`, `SPO2`, `TEMPERATURE`; keeps rows where that value is not null |
| `from` | ISO date? | Inclusive lower bound on `measuredAt` |
| `to` | ISO date? | Inclusive upper bound on `measuredAt` |
| `cursor` | string? | Opaque cursor from `meta.nextCursor` |
| `limit` | integer? | 1–200, default 50 |

Response `200 OK`:

```json
{
  "data": [
    {
      "id": "b1c2d3e4-f5a6-4b7c-8d9e-0a1b2c3d4e5f",
      "deviceId": "6a2f1c7e-2b4d-4f8a-9c1e-7d3b5a9f0e21",
      "userId": "0f1b8a6e-4b1a-4b1a-9b1a-1a2b3c4d5e6f",
      "messageId": "a6a2c7f2-8a6c-4b8f-9d0e-5f1c2b3a4d5e",
      "sequence": 1024,
      "heartRate": 78,
      "spo2": 98,
      "temperature": 36.7,
      "signalQuality": "GOOD",
      "measuredAt": "2026-11-04T12:00:00.000Z",
      "receivedAt": "2026-11-04T12:00:01.250Z"
    }
  ],
  "meta": {
    "limit": 50,
    "hasMore": true,
    "nextCursor": "MjAyNi0xMS0wNFQxMjowMDowMC4wMDBafGIxYzJkM2U0..."
  }
}
```

Errors:

- `400 VALIDATION_ERROR` when `from > to`
- `400 INVALID_CURSOR`
- `404 DEVICE_NOT_FOUND` when `deviceId` is not owned

### 5.3 Get measurement detail

```http
GET /api/v1/measurements/{id}
Authorization: Bearer <accessToken>
```

Response `200 OK` with a measurement object.

Errors:

- `404 MEASUREMENT_NOT_FOUND`

### 5.4 Bucketed series (charts)

```http
GET /api/v1/measurements/series?from={iso}&to={iso}&bucket=5m&parameter=HEART_RATE&deviceId={uuid}
Authorization: Bearer <accessToken>
```

| Query | Type | Rules |
| --- | --- | --- |
| `from` | ISO date | **Required** |
| `to` | ISO date | **Required** |
| `bucket` | enum? | `1m`, `5m`, `15m`, `1h`, `1d`; default `5m` |
| `parameter` | enum? | `HEART_RATE`, `SPO2`, `TEMPERATURE` |
| `deviceId` | UUID? | Must be actively assigned to the caller |

Response `200 OK`:

```json
{
  "data": [
    {
      "bucket": "2026-11-04T12:00:00.000Z",
      "heartRate": 77.4,
      "spo2": 97.8,
      "temperature": 36.72,
      "sampleCount": 12
    }
  ]
}
```

- `bucket` is the start of the time bucket (PostgreSQL `date_bin`).
- Averages are `null` when no sample in the bucket has that parameter.
- `sampleCount` is the number of measurements in the bucket.

Errors:

- `400 VALIDATION_ERROR` when `from > to` or the range exceeds 5,000 buckets.

---

## 6. Alerts

Alert object:

```json
{
  "id": "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f",
  "deviceId": "6a2f1c7e-2b4d-4f8a-9c1e-7d3b5a9f0e21",
  "measurementId": "b1c2d3e4-f5a6-4b7c-8d9e-0a1b2c3d4e5f",
  "parameter": "SPO2",
  "value": 92,
  "minValue": 95,
  "maxValue": 100,
  "direction": "LOW",
  "status": "UNREAD",
  "message": "SpO2 92% is below the minimum threshold of 95%.",
  "createdAt": "2026-11-04T12:00:01.400Z",
  "readAt": null
}
```

| Field | Description |
| --- | --- |
| `parameter` | `HEART_RATE`, `SPO2`, `TEMPERATURE` |
| `value` | Measured value at alert time |
| `minValue` / `maxValue` | Thresholds active at alert time; may be `null` |
| `direction` | `LOW` or `HIGH` |
| `status` | `UNREAD` or `READ` |
| `message` | English user-facing description |
| `readAt` | ISO timestamp or `null` |

### 6.1 List alerts

```http
GET /api/v1/alerts?status=UNREAD&parameter=SPO2&from={iso}&to={iso}&cursor={cursor}&limit=50
Authorization: Bearer <accessToken>
```

| Query | Type | Rules |
| --- | --- | --- |
| `status` | enum? | `UNREAD`, `READ` |
| `parameter` | enum? | `HEART_RATE`, `SPO2`, `TEMPERATURE` |
| `from` | ISO date? | Inclusive lower bound on `createdAt` |
| `to` | ISO date? | Inclusive upper bound on `createdAt` |
| `cursor` | string? | Opaque cursor |
| `limit` | integer? | 1–200, default 50 |

Response `200 OK`:

```json
{
  "data": [
    {
      "id": "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f",
      "deviceId": "6a2f1c7e-2b4d-4f8a-9c1e-7d3b5a9f0e21",
      "measurementId": "b1c2d3e4-f5a6-4b7c-8d9e-0a1b2c3d4e5f",
      "parameter": "SPO2",
      "value": 92,
      "minValue": 95,
      "maxValue": 100,
      "direction": "LOW",
      "status": "UNREAD",
      "message": "SpO2 92% is below the minimum threshold of 95%.",
      "createdAt": "2026-11-04T12:00:01.400Z",
      "readAt": null
    }
  ],
  "meta": {
    "limit": 50,
    "hasMore": false,
    "nextCursor": null
  }
}
```

Errors:

- `400 VALIDATION_ERROR` when `from > to`
- `400 INVALID_CURSOR`

### 6.2 Get alert configuration

```http
GET /api/v1/alerts/config
Authorization: Bearer <accessToken>
```

Response `200 OK`:

```json
{
  "data": [
    {
      "parameter": "HEART_RATE",
      "minValue": 50,
      "maxValue": 100,
      "enabled": true,
      "updatedAt": "2026-11-07T10:00:00.000Z"
    },
    {
      "parameter": "SPO2",
      "minValue": 95,
      "maxValue": 100,
      "enabled": true,
      "updatedAt": "2026-11-07T10:00:00.000Z"
    },
    {
      "parameter": "TEMPERATURE",
      "minValue": 36.1,
      "maxValue": 37.5,
      "enabled": true,
      "updatedAt": "2026-11-07T10:00:00.000Z"
    }
  ]
}
```

The endpoint always returns all three parameters. Missing database rows fall back
to the documented defaults. A row with `minValue` or `maxValue` explicitly set to
`null` keeps `null` (open-ended threshold). `updatedAt` is `null` for defaults
that have never been saved.

### 6.3 Update alert configuration

```http
PUT /api/v1/alerts/config
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Request:

```json
{
  "configs": [
    {
      "parameter": "SPO2",
      "minValue": 94,
      "maxValue": 100,
      "enabled": true
    },
    {
      "parameter": "HEART_RATE",
      "minValue": 50,
      "maxValue": 110
    }
  ]
}
```

| Field | Type | Rules |
| --- | --- | --- |
| `configs` | array | At least 1 item |
| `configs[].parameter` | enum | `HEART_RATE`, `SPO2`, `TEMPERATURE` |
| `configs[].minValue` | number? | 0–1000, max 2 decimals, may be `null` |
| `configs[].maxValue` | number? | 0–1000, max 2 decimals, may be `null` |
| `configs[].enabled` | boolean? | Default `true` on create |

Rules:

- Duplicate `parameter` values in one request return `400 VALIDATION_ERROR`.
- `minValue > maxValue` returns `400 VALIDATION_ERROR`.
- Omitted fields are left unchanged on update.
- Response is the full configuration array, same shape as 6.2.

### 6.4 Mark one alert as read

```http
PATCH /api/v1/alerts/{id}/read
Authorization: Bearer <accessToken>
```

Response `200 OK` with the updated alert object. Marking an already-read alert is
idempotent.

Errors:

- `404 ALERT_NOT_FOUND`

### 6.5 Mark all alerts as read

```http
PATCH /api/v1/alerts/read-all
Authorization: Bearer <accessToken>
```

Response `200 OK`:

```json
{ "data": { "updated": 4 } }
```

`updated` is the number of alerts transitioned from `UNREAD` to `READ`.

---

## 7. Health

### 7.1 Liveness

```http
GET /health/live
```

No authentication and no dependencies.

Response `200 OK`:

```json
{
  "status": "ok",
  "timestamp": "2026-11-07T10:15:30.000Z"
}
```

### 7.2 Readiness

```http
GET /health/ready
```

Checks PostgreSQL with `SELECT 1` and reports the MQTT connection state.

Response `200 OK`:

```json
{
  "status": "ok",
  "checks": {
    "database": "up",
    "mqtt": {
      "enabled": true,
      "connected": true
    }
  },
  "timestamp": "2026-11-07T10:15:30.000Z"
}
```

`status` is `"degraded"` when the database is up but MQTT is enabled and
disconnected. The API still serves REST and WebSocket traffic in that state.

Response `503 Service Unavailable` when the database is unreachable:

```json
{
  "type": "about:blank",
  "title": "Service Unavailable",
  "status": 503,
  "detail": "The database is not reachable.",
  "code": "SERVICE_UNAVAILABLE",
  "details": {
    "database": false,
    "mqtt": { "enabled": true, "connected": true }
  },
  "instance": "/health/ready",
  "requestId": "...",
  "timestamp": "2026-11-07T10:15:30.000Z"
}
```

---

## 8. MQTT device protocol

### 8.1 Topics

| Topic | Direction | QoS | Purpose |
| --- | --- | --- | --- |
| `medisense/device/{deviceCode}/telemetry` | device → backend | 1 | Measurement batch |
| `medisense/device/{deviceCode}/status` | device → backend | 1 | Online/offline/LWT |
| `medisense/device/{deviceCode}/command` | backend → device | 1 | Reserved for future commands |

`{deviceCode}` must match `^[A-Za-z0-9_-]{3,64}$`.

The backend subscribes to `medisense/device/+/telemetry` and
`medisense/device/+/status` with QoS 1. The prefix is configurable via
`MQTT_TOPIC_PREFIX` (default `medisense`).

### 8.2 Telemetry payload

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

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `deviceCode` | string | yes | 3–64 chars, must equal the topic segment |
| `messageId` | string | yes | 8–64 chars, unique per device; UUID recommended |
| `sequence` | integer | no | ≥ 0 |
| `timestamp` | string | yes | ISO 8601; at most 24 h old and 5 min in the future |
| `measurements` | object | yes | At least one value below |
| `measurements.heartRate` | integer | no | 20–250 bpm |
| `measurements.spo2` | integer | no | 50–100 % |
| `measurements.temperature` | number | no | 30–45 °C, max 2 decimals |
| `signalQuality` | string | no | `good`, `fair`, `poor` (case-insensitive), default `GOOD` |
| `firmwareVersion` | string | no | max 32 chars |

Validation behaviour:

- Unknown fields (top-level or inside `measurements`) are rejected.
- `deviceCode` must match the MQTT topic, otherwise `DEVICE_MISMATCH`.
- The device must exist and have an active assignment, otherwise the message is
  dropped (`DEVICE_NOT_FOUND` / `DEVICE_NOT_PAIRED`).
- Duplicate `(deviceId, messageId)` messages are ignored.
- Invalid messages are logged and dropped. The backend does **not** publish an
  error response.
- Valid telemetry updates the device to `ONLINE`, refreshes `lastSeenAt` and
  stores `firmwareVersion` if supplied.

Minimum valid example (heart rate only):

```json
{
  "deviceCode": "ESP32-001",
  "messageId": "msg-00000001",
  "timestamp": "2026-11-04T12:00:00.000Z",
  "measurements": { "heartRate": 78 }
}
```

### 8.3 Status payload

```json
{
  "status": "online",
  "firmwareVersion": "1.0.0"
}
```

- `status` is case-insensitive `online` or `offline`.
- `firmwareVersion` is optional, max 32 chars.
- Unknown fields are ignored for status messages.
- Status for unpaired devices is ignored.

**Last Will:** configure a retained message on
`medisense/device/{deviceCode}/status`:

```json
{ "status": "offline" }
```

The broker publishes it when the device disconnects unexpectedly. The backend
also sweeps stale devices after `DEVICE_OFFLINE_THRESHOLD_SECONDS`.

### 8.4 Broker credentials and ACL (development defaults)

Generated by the `mosquitto-init` Compose service:

| Username | Password | Permissions |
| --- | --- | --- |
| `medi-backend` | `backend-secret` | read all `telemetry`/`status`, write `command` |
| `ESP32-001` | `device-secret-001` | publish only `device/ESP32-001/telemetry|status` |
| `ESP32-002` | `device-secret-002` | publish only `device/ESP32-002/telemetry|status` |

The ACL uses `%u` substitution:

```text
pattern write medisense/device/%u/telemetry
pattern write medisense/device/%u/status
pattern read  medisense/device/%u/command
```

Change all credentials and enable TLS before exposing the broker.

### 8.5 Example publisher (Node.js)

```js
import mqtt from "mqtt";

const deviceCode = "ESP32-001";
const client = mqtt.connect("mqtt://localhost:1883", {
  clientId: deviceCode,
  username: deviceCode,
  password: "device-secret-001",
  will: {
    topic: `medisense/device/${deviceCode}/status`,
    payload: JSON.stringify({ status: "offline" }),
    qos: 1,
    retain: true,
  },
});

client.on("connect", () => {
  client.publish(
    `medisense/device/${deviceCode}/status`,
    JSON.stringify({ status: "online", firmwareVersion: "1.0.0" }),
    { qos: 1, retain: true },
  );

  setInterval(() => {
    client.publish(
      `medisense/device/${deviceCode}/telemetry`,
      JSON.stringify({
        deviceCode,
        messageId: crypto.randomUUID(),
        sequence: Date.now(),
        timestamp: new Date().toISOString(),
        measurements: {
          heartRate: 72 + Math.round(Math.random() * 10),
          spo2: 97 + Math.round(Math.random() * 2),
          temperature: Number((36.5 + Math.random() * 0.6).toFixed(1)),
        },
        signalQuality: "good",
        firmwareVersion: "1.0.0",
      }),
      { qos: 1 },
    );
  }, 2000);
});
```

---

## 9. WebSocket protocol

### 9.1 Connection

- Namespace: `/realtime`
- Transport: WebSocket (or polling fallback)
- Authentication: access token in the Socket.IO handshake `auth.token`, or an
  `Authorization: Bearer <token>` header.

```js
import { io } from "socket.io-client";

const socket = io("http://localhost:3000/realtime", {
  auth: { token: accessToken },
  transports: ["websocket"],
  reconnection: true,
  reconnectionDelayMax: 10000,
});

socket.on("connect", () => {
  socket.emit("device:subscribe", { deviceId }, (ack) => {
    console.log(ack); // { ok: true, deviceId }
  });
});
```

Invalid or missing tokens are disconnected immediately. The access token is
verified only at handshake time; reconnect with a fresh token after refreshing.

### 9.2 Rooms

| Room | Joined when | Receives |
| --- | --- | --- |
| `user:{userId}` | automatically on connect | `device:status`, `alert:new` |
| `device:{deviceId}` | after `device:subscribe` | `measurement:update` |

### 9.3 Client → server events

#### `device:subscribe`

Payload:

```json
{ "deviceId": "6a2f1c7e-2b4d-4f8a-9c1e-7d3b5a9f0e21" }
```

The backend checks that the device has an active assignment for the caller. On
success the socket joins `device:{deviceId}`.

Acknowledgement (when a callback is supplied):

```json
{ "ok": true, "deviceId": "6a2f1c7e-2b4d-4f8a-9c1e-7d3b5a9f0e21" }
```

#### `device:unsubscribe`

Payload:

```json
{ "deviceId": "6a2f1c7e-2b4d-4f8a-9c1e-7d3b5a9f0e21" }
```

Leaves the device room. Acknowledgement:

```json
{ "ok": true, "deviceId": "6a2f1c7e-2b4d-4f8a-9c1e-7d3b5a9f0e21" }
```

### 9.4 Server → client events

#### `measurement:update`

Sent to `device:{deviceId}`. The payload is the measurement object plus
`deviceCode`:

```json
{
  "id": "b1c2d3e4-f5a6-4b7c-8d9e-0a1b2c3d4e5f",
  "deviceId": "6a2f1c7e-2b4d-4f8a-9c1e-7d3b5a9f0e21",
  "userId": "0f1b8a6e-4b1a-4b1a-9b1a-1a2b3c4d5e6f",
  "messageId": "a6a2c7f2-8a6c-4b8f-9d0e-5f1c2b3a4d5e",
  "sequence": 1024,
  "heartRate": 78,
  "spo2": 98,
  "temperature": 36.7,
  "signalQuality": "GOOD",
  "measuredAt": "2026-11-04T12:00:00.000Z",
  "receivedAt": "2026-11-04T12:00:01.250Z",
  "deviceCode": "ESP32-001"
}
```

#### `device:status`

Sent to `user:{userId}`:

```json
{
  "deviceId": "6a2f1c7e-2b4d-4f8a-9c1e-7d3b5a9f0e21",
  "deviceCode": "ESP32-001",
  "status": "ONLINE",
  "lastSeenAt": "2026-11-04T12:00:01.250Z"
}
```

#### `alert:new`

Sent to `user:{userId}` with an alert object:

```json
{
  "id": "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f",
  "deviceId": "6a2f1c7e-2b4d-4f8a-9c1e-7d3b5a9f0e21",
  "measurementId": "b1c2d3e4-f5a6-4b7c-8d9e-0a1b2c3d4e5f",
  "parameter": "SPO2",
  "value": 92,
  "minValue": 95,
  "maxValue": 100,
  "direction": "LOW",
  "status": "UNREAD",
  "message": "SpO2 92% is below the minimum threshold of 95%.",
  "createdAt": "2026-11-04T12:00:01.400Z",
  "readAt": null
}
```

#### `exception`

Sent to the socket when a client event fails authorization or validation:

```json
{
  "status": "error",
  "message": "DEVICE_NOT_FOUND"
}
```

### 9.5 Reconnection behaviour

The server keeps no per-client history. After a reconnect:

1. authenticate with a fresh access token,
2. re-subscribe to the desired devices,
3. fetch `/measurements/latest` and `/measurements/series` to fill any gap,
4. fetch `/alerts?status=UNREAD` for missed alerts.

---

## 10. End-to-end examples

### 10.1 cURL: login and fetch the latest measurement

```bash
BASE=http://localhost:3000/api/v1

ACCESS=$(curl -s -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@medisense.local","password":"Demo1234!"}' \
  | jq -r '.data.tokens.accessToken')

curl -s "$BASE/measurements/latest" \
  -H "Authorization: Bearer $ACCESS" | jq
```

### 10.2 cURL: pair the seeded demo device

```bash
BASE=http://localhost:3000/api/v1

ACCESS=$(curl -s -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@medisense.local","password":"Demo1234!"}' \
  | jq -r '.data.tokens.accessToken')

curl -s -X POST "$BASE/devices/pair" \
  -H "Authorization: Bearer $ACCESS" \
  -H 'Content-Type: application/json' \
  -d '{"deviceCode":"ESP32-002","pairingCode":"123456","name":"My Sensor"}' | jq
```

### 10.3 Seed data

After `npx prisma db seed`:

| Item | Value |
| --- | --- |
| User email | `demo@medisense.local` |
| User password | `Demo1234!` |
| Device `ESP32-001` | Already paired with the demo user, intended for the simulator |
| Device `ESP32-002` | Unpaired, pairing code `123456`, valid 30 days |
| Alert thresholds | Heart rate 50–100, SpO2 95–100, temperature 36.1–37.5 |

### 10.4 Typical Flutter flow

1. `POST /auth/login` → store access + refresh tokens securely.
2. `GET /devices` → choose a device.
3. Connect Socket.IO with `auth.token`, then `device:subscribe`.
4. `GET /measurements/latest` and `GET /measurements/series` → bootstrap charts.
5. Apply `measurement:update` events to the live chart.
6. Listen for `alert:new` and `device:status`.
7. Refresh the token before `expiresIn`; reconnect the socket with the new token.
8. On app resume, re-fetch snapshots and unread alerts.

---

## 11. Contract change policy

- Error `code` values are stable identifiers; clients may branch on them.
- Additive fields may be introduced without a version bump.
- Breaking changes require a new API prefix (for example `/api/v2`).
- The Swagger document at `/docs` is generated from the running code and is the
  authoritative schema for request/response DTOs.
