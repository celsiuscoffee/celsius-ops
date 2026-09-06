import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_CAPABILITIES, CAPABILITIES, isCapability } from "./capabilities";

// Capabilities live in three hand-maintained places: this module (the source of
// truth), the access API's validator, and the checkbox list on the employee
// page. A key that exists in the UI but not here is silently rejected by the
// API as "Unknown capability"; a key that exists here but not in the UI can
// only be granted by hand-editing the database. Pin them together.

describe("capability registry", () => {
  it("keys are namespaced and described", () => {
    expect(ALL_CAPABILITIES.length).toBeGreaterThan(0);
    for (const cap of ALL_CAPABILITIES) {
      expect(cap, `${cap} should be "domain:action"`).toMatch(/^[a-z]+:[a-z_]+$/);
      expect(CAPABILITIES[cap].length, `${cap} needs a description`).toBeGreaterThan(10);
    }
  });

  it("isCapability accepts known keys and rejects anything else", () => {
    for (const cap of ALL_CAPABILITIES) expect(isCapability(cap)).toBe(true);
    expect(isCapability("roster:delete")).toBe(false);
    expect(isCapability("payroll:confirm")).toBe(false);
    expect(isCapability("")).toBe(false);
    // A near-miss typo must not pass — the API stores only validated strings.
    expect(isCapability("roster:unpublish ")).toBe(false);
  });

  it("no capability grants payroll, finance or bank access", () => {
    // These elevations are deliberately ops-only: the whole point of the
    // capability layer is that it is NOT an ADMIN promotion. If a future
    // capability needs to touch money, it gets its own review, not a quiet
    // addition here.
    const forbidden = ["payroll", "finance", "bank", "salary", "pin", "access"];
    for (const cap of ALL_CAPABILITIES) {
      const domain = cap.split(":")[0];
      expect(forbidden, `${cap} is a money/access-control domain`).not.toContain(domain);
    }
  });

  it("the employee page's checkboxes match this registry exactly", () => {
    const page = readFileSync(
      join(__dirname, "../app/(admin)/hr/employees/[id]/page.tsx"),
      "utf8",
    );
    const block = page.split("const CAPABILITY_OPTIONS")[1] ?? "";
    const uiKeys = [...block.matchAll(/key: "([a-z]+:[a-z_]+)"/g)].map((m) => m[1]);

    expect(uiKeys.length, "CAPABILITY_OPTIONS not found in the employee page").toBeGreaterThan(0);
    expect([...uiKeys].sort()).toEqual([...ALL_CAPABILITIES].sort());
  });
});
