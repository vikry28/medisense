export enum AlertParameterKey {
  HEART_RATE = "HEART_RATE",
  SPO2 = "SPO2",
  TEMPERATURE = "TEMPERATURE",
}

export type AlertDirectionKey = "LOW" | "HIGH";

export interface AlertThreshold {
  minValue: number | null;
  maxValue: number | null;
  enabled: boolean;
}

export interface AlertEvaluation {
  direction: AlertDirectionKey;
  message: string;
}

export const DEFAULT_THRESHOLDS: Record<AlertParameterKey, AlertThreshold> = {
  [AlertParameterKey.HEART_RATE]: {
    minValue: 50,
    maxValue: 100,
    enabled: true,
  },
  [AlertParameterKey.SPO2]: {
    minValue: 95,
    maxValue: 100,
    enabled: true,
  },
  [AlertParameterKey.TEMPERATURE]: {
    minValue: 36.1,
    maxValue: 37.5,
    enabled: true,
  },
};

const PARAMETER_META: Record<
  AlertParameterKey,
  { label: string; unit: string }
> = {
  [AlertParameterKey.HEART_RATE]: { label: "Heart rate", unit: " bpm" },
  [AlertParameterKey.SPO2]: { label: "SpO2", unit: "%" },
  [AlertParameterKey.TEMPERATURE]: { label: "Body temperature", unit: "°C" },
};

export class AlertEvaluator {
  evaluate(
    parameter: AlertParameterKey,
    value: number,
    threshold: AlertThreshold,
  ): AlertEvaluation | null {
    if (!threshold.enabled) {
      return null;
    }

    const meta = PARAMETER_META[parameter];
    const formattedValue = formatNumber(value);

    if (threshold.minValue !== null && value < threshold.minValue) {
      return {
        direction: "LOW",
        message: `${meta.label} ${formattedValue}${meta.unit} is below the minimum threshold of ${formatNumber(threshold.minValue)}${meta.unit}.`,
      };
    }

    if (threshold.maxValue !== null && value > threshold.maxValue) {
      return {
        direction: "HIGH",
        message: `${meta.label} ${formattedValue}${meta.unit} is above the maximum threshold of ${formatNumber(threshold.maxValue)}${meta.unit}.`,
      };
    }

    return null;
  }
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
