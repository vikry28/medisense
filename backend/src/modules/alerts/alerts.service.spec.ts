import { Alert, AlertParameter, AlertStatus, Prisma } from "@prisma/client";
import { toAlertDto } from "./alerts.service";

function buildAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "alert-1",
    userId: "user-1",
    deviceId: "device-1",
    measurementId: "measurement-1",
    parameter: AlertParameter.HEART_RATE,
    value: new Prisma.Decimal(120),
    minValue: new Prisma.Decimal(50),
    maxValue: new Prisma.Decimal(100),
    direction: "HIGH",
    status: AlertStatus.UNREAD,
    message: "Heart rate 120 bpm is above the maximum threshold of 100 bpm.",
    createdAt: new Date("2026-11-09T10:00:00.000Z"),
    readAt: null,
    ...overrides,
  };
}

describe("toAlertDto", () => {
  it("serializes threshold alerts with numeric values", () => {
    const dto = toAlertDto(buildAlert());

    expect(dto.value).toBe(120);
    expect(dto.minValue).toBe(50);
    expect(dto.maxValue).toBe(100);
    expect(dto.direction).toBe("HIGH");
  });

  it("serializes device connection alerts with null measurement fields", () => {
    const dto = toAlertDto(
      buildAlert({
        measurementId: null,
        parameter: AlertParameter.DEVICE_CONNECTION,
        value: null,
        minValue: null,
        maxValue: null,
        direction: null,
        message: "Device ESP32-001 disconnected.",
      }),
    );

    expect(dto).toMatchObject({
      parameter: "DEVICE_CONNECTION",
      measurementId: null,
      value: null,
      minValue: null,
      maxValue: null,
      direction: null,
      message: "Device ESP32-001 disconnected.",
    });
  });
});
