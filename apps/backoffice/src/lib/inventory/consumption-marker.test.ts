import { describe, it, expect } from "vitest";
import { CONSUMPTION_REASON_PREFIX, isConsumptionEngineReason, NOT_CONSUMPTION_ENGINE_WHERE } from "./consumption-marker";
import { reasonMarker } from "./consumption";

describe("consumption marker exclusion", () => {
  it("prefix matches what the engine writes", () => {
    expect(CONSUMPTION_REASON_PREFIX).toBe("auto-consumption:");
    expect(isConsumptionEngineReason(reasonMarker("2026-09-04"))).toBe(true);
  });
  it("keeps manual reasons and null reasons", () => {
    expect(isConsumptionEngineReason("dropped tray")).toBe(false);
    expect(isConsumptionEngineReason(null)).toBe(false);
    expect(isConsumptionEngineReason(undefined)).toBe(false);
    expect(isConsumptionEngineReason("")).toBe(false);
  });
  it("where-fragment explicitly keeps NULL reasons", () => {
    expect(NOT_CONSUMPTION_ENGINE_WHERE.OR[0]).toEqual({ reason: null });
    expect(NOT_CONSUMPTION_ENGINE_WHERE.OR[1]).toEqual({ NOT: { reason: { startsWith: "auto-consumption:" } } });
  });
});
