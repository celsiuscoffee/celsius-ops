import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateEnv, formatEnvReport, checkEnvAtBoot } from "../env";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
});

beforeEach(() => {
  delete process.env.TEST_REQUIRED_A;
  delete process.env.TEST_REQUIRED_B;
  delete process.env.TEST_RECOMMENDED;
});

describe("validateEnv", () => {
  it("reports missing and empty-string vars; present ones pass", () => {
    process.env.TEST_REQUIRED_A = "set";
    process.env.TEST_REQUIRED_B = ""; // empty counts as missing
    const p = validateEnv({
      required: ["TEST_REQUIRED_A", "TEST_REQUIRED_B"],
      recommended: ["TEST_RECOMMENDED"],
    });
    expect(p.missingRequired).toEqual(["TEST_REQUIRED_B"]);
    expect(p.missingRecommended).toEqual(["TEST_RECOMMENDED"]);
  });
});

describe("formatEnvReport", () => {
  it("is empty when everything is present", () => {
    process.env.TEST_REQUIRED_A = "set";
    const p = validateEnv({ required: ["TEST_REQUIRED_A"] });
    expect(formatEnvReport("order", p)).toBe("");
  });

  it("names the app and distinguishes required from recommended", () => {
    const r = formatEnvReport("order", {
      missingRequired: ["TEST_REQUIRED_A"],
      missingRecommended: ["TEST_RECOMMENDED"],
    });
    expect(r).toContain("[env] order");
    expect(r).toContain("MISSING (required): TEST_REQUIRED_A");
    expect(r).toContain("missing (recommended): TEST_RECOMMENDED");
  });
});

describe("checkEnvAtBoot", () => {
  it("throws outside production when a required var is missing", () => {
    process.env.NODE_ENV = "test";
    expect(() => checkEnvAtBoot("order", { required: ["TEST_REQUIRED_A"] })).toThrow(
      /MISSING \(required\): TEST_REQUIRED_A/,
    );
  });

  it("logs but never throws in production", () => {
    process.env.NODE_ENV = "production";
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const report = checkEnvAtBoot("order", { required: ["TEST_REQUIRED_A"] });
    expect(report).toContain("TEST_REQUIRED_A");
    expect(err).toHaveBeenCalledOnce();
  });

  it("recommended-only gaps warn without throwing, even in dev", () => {
    process.env.NODE_ENV = "test";
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const report = checkEnvAtBoot("order", { required: [], recommended: ["TEST_RECOMMENDED"] });
    expect(report).toContain("TEST_RECOMMENDED");
    expect(err).toHaveBeenCalledOnce();
  });

  it("returns empty string and stays silent when clean", () => {
    process.env.TEST_REQUIRED_A = "set";
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(checkEnvAtBoot("order", { required: ["TEST_REQUIRED_A"] })).toBe("");
    expect(err).not.toHaveBeenCalled();
  });
});
