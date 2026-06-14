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

  it("logs but never throws in production, and flags required problems", () => {
    process.env.NODE_ENV = "production";
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = checkEnvAtBoot("order", { required: ["TEST_REQUIRED_A"] });
    expect(res.report).toContain("TEST_REQUIRED_A");
    expect(res.hasRequiredProblems).toBe(true);
    expect(err).toHaveBeenCalledOnce();
  });

  it("recommended-only gaps warn without throwing and are NOT flagged as required", () => {
    process.env.NODE_ENV = "test";
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = checkEnvAtBoot("order", { required: [], recommended: ["TEST_RECOMMENDED"] });
    expect(res.report).toContain("TEST_RECOMMENDED");
    // The whole point of the fix: a recommended-only gap must not be
    // flagged as a required problem (so it never pages Sentry at error).
    expect(res.hasRequiredProblems).toBe(false);
    expect(err).toHaveBeenCalledOnce();
  });

  it("returns empty report and stays silent when clean", () => {
    process.env.TEST_REQUIRED_A = "set";
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = checkEnvAtBoot("order", { required: ["TEST_REQUIRED_A"] });
    expect(res.report).toBe("");
    expect(res.hasRequiredProblems).toBe(false);
    expect(err).not.toHaveBeenCalled();
  });
});
