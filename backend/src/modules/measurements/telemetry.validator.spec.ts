import {
  parseTelemetryPayload,
  TelemetryValidationError,
} from "./telemetry.validator";

const NOW = new Date("2026-11-04T12:00:00.000Z");

function payload(overrides: Record<string, unknown> = {}) {
  return {
    deviceCode: "ESP32-001",
    messageId: "2b0e1d9c-8f2a-4a7e-9f3f-1234567890ab",
    sequence: 42,
    timestamp: "2026-11-04T11:59:55.000Z",
    measurements: {
      heartRate: 78,
      spo2: 98,
      temperature: 36.7,
    },
    signalQuality: "good",
    ...overrides,
  };
}

describe("parseTelemetryPayload", () => {
  it("normalizes a valid payload", async () => {
    const result = await parseTelemetryPayload(
      JSON.stringify(payload()),
      "ESP32-001",
      NOW,
    );
    expect(result.deviceCode).toBe("ESP32-001");
    expect(result.measuredAt.toISOString()).toBe("2026-11-04T11:59:55.000Z");
    expect(result.signalQuality).toBe("GOOD");
    expect(result.temperature).toBe(36.7);
  });

  it("rejects payloads whose device code does not match the topic", async () => {
    await expect(
      parseTelemetryPayload(payload(), "ESP32-002", NOW),
    ).rejects.toMatchObject({ code: "DEVICE_MISMATCH" });
  });

  it("rejects timestamps outside the accepted window", async () => {
    await expect(
      parseTelemetryPayload(
        payload({ timestamp: "2026-11-01T12:00:00.000Z" }),
        "ESP32-001",
        NOW,
      ),
    ).rejects.toMatchObject({ code: "TIMESTAMP_OUT_OF_RANGE" });
  });

  it("rejects payloads without any measurement value", async () => {
    await expect(
      parseTelemetryPayload(payload({ measurements: {} }), "ESP32-001", NOW),
    ).rejects.toMatchObject({ code: "NO_MEASUREMENTS" });
  });

  it("rejects out-of-range sensor values", async () => {
    await expect(
      parseTelemetryPayload(
        payload({
          measurements: { heartRate: 500, spo2: 98, temperature: 36.7 },
        }),
        "ESP32-001",
        NOW,
      ),
    ).rejects.toBeInstanceOf(TelemetryValidationError);
  });

  it("rejects unknown fields", async () => {
    await expect(
      parseTelemetryPayload(payload({ unexpected: true }), "ESP32-001", NOW),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("rejects invalid JSON", async () => {
    await expect(
      parseTelemetryPayload("{not-json", "ESP32-001", NOW),
    ).rejects.toMatchObject({ code: "INVALID_JSON" });
  });
});
