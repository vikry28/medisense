import { AlertEvaluator, AlertParameterKey } from "./alert-evaluator";

describe("AlertEvaluator", () => {
  const evaluator = new AlertEvaluator();

  it("returns null when the value is within the threshold", () => {
    expect(
      evaluator.evaluate(AlertParameterKey.HEART_RATE, 78, {
        minValue: 50,
        maxValue: 100,
        enabled: true,
      }),
    ).toBeNull();
  });

  it("flags a value below the minimum threshold", () => {
    const result = evaluator.evaluate(AlertParameterKey.SPO2, 92, {
      minValue: 95,
      maxValue: 100,
      enabled: true,
    });
    expect(result?.direction).toBe("LOW");
    expect(result?.message).toContain("SpO2 92%");
    expect(result?.message).toContain("below the minimum threshold of 95%");
  });

  it("flags a value above the maximum threshold", () => {
    const result = evaluator.evaluate(AlertParameterKey.TEMPERATURE, 38.2, {
      minValue: 36.1,
      maxValue: 37.5,
      enabled: true,
    });
    expect(result?.direction).toBe("HIGH");
    expect(result?.message).toContain("38.2");
    expect(result?.message).toContain("maximum threshold of 37.5");
  });

  it("does not evaluate disabled parameters", () => {
    expect(
      evaluator.evaluate(AlertParameterKey.HEART_RATE, 200, {
        minValue: 50,
        maxValue: 100,
        enabled: false,
      }),
    ).toBeNull();
  });

  it("supports open-ended thresholds", () => {
    expect(
      evaluator.evaluate(AlertParameterKey.HEART_RATE, 40, {
        minValue: null,
        maxValue: null,
        enabled: true,
      }),
    ).toBeNull();
  });
});
