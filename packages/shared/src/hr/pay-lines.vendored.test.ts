import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The manager app cannot import @celsius/shared: its Metro config has no
// monorepo resolution, and changing that ships through OTA to live manager
// phones. So it carries a copy — and copies drift. Before this guard existed
// the copy had already diverged: "Basic salary" vs "Basic Salary", and raw
// `${h}h` ("1h") vs fmtHours ("1.0h").
//
// Byte equality rather than behavioural equality on purpose: it catches drift
// in a comment or a not-yet-used export, and the fix is one cp.
const ROOT = join(__dirname, "..", "..", "..", "..");

describe("pay-lines vendored copy", () => {
  it("apps/staff-native/lib/hr/pay-lines.ts is identical to the shared source", () => {
    const shared = readFileSync(join(ROOT, "packages/shared/src/hr/pay-lines.ts"), "utf8");
    const vendored = readFileSync(join(ROOT, "apps/staff-native/lib/hr/pay-lines.ts"), "utf8");
    expect(vendored).toBe(shared);
  });
});
