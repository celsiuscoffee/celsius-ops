import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  readExtraRuntimes,
  parsePublishedRuntimes,
  verifyPublish,
  // @ts-expect-error — plain .mjs helper, no type declarations.
} from "../scripts/ota-publish-extra-runtimes.mjs";

// ── The stranded-fleet invariant ─────────────────────────────────────
//
// `eas update` publishes to whatever runtimeVersion app.json resolves to.
// An installed app only accepts updates matching the runtimeVersion it was
// BUILT with. When those two diverge, the publish SUCCEEDS into a runtime no
// device has: the workflow goes green and the fleet quietly keeps running an
// old bundle. pickup-native lived in that state from 2026-07-25 (the switch to
// `policy: "fingerprint"`, while every store binary was built under
// `appVersion` and reports "1.0.3") until 2026-08-21 — two merged fixes
// reached zero customers, and reinstalls dropped phones onto the ancient
// embedded bundle, which is what "it reverts back to the old build" was.
//
// apps/<app>/ota-runtimes.json closes it: it names the in-field runtimes the
// normal publish misses, and the OTA workflows republish to each one. These
// tests pin the manifest's shape and the policy rules, so the config can't rot
// back into a silent no-op.

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "..");

const NATIVE_APPS = ["pickup-native", "pos-native", "staff-native"] as const;

function appJson(app: string) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, "apps", app, "app.json"), "utf8")).expo;
}

function manifestPath(app: string) {
  return path.join(repoRoot, "apps", app, "ota-runtimes.json");
}

describe("OTA in-field runtime manifests", () => {
  it.each(NATIVE_APPS)("%s declares a valid extraRuntimes list", (app) => {
    expect(fs.existsSync(manifestPath(app)), `apps/${app}/ota-runtimes.json must exist`).toBe(true);
    const extra: string[] = readExtraRuntimes(path.join(repoRoot, "apps", app));
    expect(Array.isArray(extra)).toBe(true);
    expect(new Set(extra).size, "no duplicate runtimes").toBe(extra.length);
  });

  it.each(NATIVE_APPS)("%s does not list the runtime its normal publish already covers", (app) => {
    const expo = appJson(app);
    const policy = typeof expo.runtimeVersion === "string" ? null : expo.runtimeVersion?.policy;
    const extra: string[] = readExtraRuntimes(path.join(repoRoot, "apps", app));
    if (policy === "appVersion") {
      // The natural publish already targets expo.version — listing it again
      // would publish the same bundle to the same runtime twice.
      expect(extra, `apps/${app}: expo.version is covered by the normal publish`).not.toContain(expo.version);
    }
  });

  it("pickup-native keeps covering the pre-fingerprint 1.0.3 fleet", () => {
    const expo = appJson("pickup-native");
    const policy = typeof expo.runtimeVersion === "string" ? null : expo.runtimeVersion?.policy;
    expect(policy, "pickup-native is on the fingerprint policy").toBe("fingerprint");

    // Under fingerprint, the normal publish reaches ONLY binaries built under
    // that policy. Every store binary in the field predates the switch, so the
    // list must stay non-empty until a fingerprint build has replaced them.
    const extra: string[] = readExtraRuntimes(path.join(repoRoot, "apps", "pickup-native"));
    expect(
      extra.length,
      "emptying this list stops every installed phone from receiving updates",
    ).toBeGreaterThan(0);
    expect(extra).toContain("1.0.3");
  });
});

describe("publish verification (a green eas run is not proof of delivery)", () => {
  it("accepts output whose every update group carries the requested runtime", () => {
    const output = [
      "✔ Published!",
      "Branch             production",
      "Runtime version    1.0.3",
      "Platform           android, ios",
      "Update group ID    2ad415b6-9974-41a1-abae-23477603fe17",
    ].join("\n");
    expect(parsePublishedRuntimes(output)).toEqual(["1.0.3"]);
    expect(verifyPublish({ output, expected: "1.0.3" }).ok).toBe(true);
  });

  it("rejects the real stranded-fleet output: green publish, fingerprint runtime", () => {
    // Verbatim shape of run 32156055677 (2026-08-18) — "success", but both
    // groups landed on fingerprint hashes no installed phone reports.
    const output = [
      "✔ Published!",
      "Branch           production",
      "Runtime version  e4e2beee7ab3004bdb18f146549a88d895e65cf2",
      "Platform         ios",
      "",
      "Branch             production",
      "Runtime version    dbe20143f9bfb4c9c827261a61150a391014bec2",
      "Platform           android",
    ].join("\n");
    const verdict = verifyPublish({ output, expected: "1.0.3" });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("1.0.3");
  });

  it("rejects output with no runtime confirmation at all", () => {
    const verdict = verifyPublish({ output: "✔ Published!\n", expected: "1.0.3" });
    expect(verdict.ok).toBe(false);
  });

  it("rejects a partially-wrong publish (one group on the wrong runtime)", () => {
    const output = [
      "Runtime version  1.0.3",
      "Runtime version  e4e2beee7ab3004bdb18f146549a88d895e65cf2",
    ].join("\n");
    expect(verifyPublish({ output, expected: "1.0.3" }).ok).toBe(false);
  });
});

describe("manifest reader", () => {
  it("refuses an app with no manifest rather than publishing to nobody", () => {
    expect(() => readExtraRuntimes(path.join(repoRoot, "apps", "order"))).toThrow(/is missing/);
  });
});
