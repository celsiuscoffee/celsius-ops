#!/usr/bin/env node
// Publish the SAME JS bundle to runtimeVersions that the natural `eas update`
// publish does NOT reach — i.e. the runtimes real devices in the field report.
//
// WHY THIS EXISTS
// ---------------
// `eas update` derives the runtimeVersion from the app's app.json. Installed
// binaries report the runtimeVersion they were BUILT with. When those two
// diverge, `eas update` still succeeds — it publishes to a runtime no device
// has, and the fleet silently stops receiving updates. That is exactly what
// happened to pickup-native: app.json moved to `runtimeVersion.policy:
// "fingerprint"` on 2026-07-25, while every phone in the field runs a store
// binary built under `appVersion` (runtime literally "1.0.3"). Every OTA from
// then on published to a fingerprint hash (e.g. run 32156055677 published
// e4e2beee… / dbe20143…) and reached ZERO customers, while the workflow went
// green. Customers stayed on the last bundle that did match their runtime and
// saw the app "revert to an old build".
//
// Each app declares the in-field runtimes its normal publish misses in
// `apps/<app>/ota-runtimes.json` (`extraRuntimes`). This script republishes the
// same bundle once per entry, by pinning a LITERAL `expo.runtimeVersion` into
// app.json for that publish only (eas-cli has no --runtime-version flag), then
// VERIFIES that the runtime eas actually published matches. A mismatch or a
// missing confirmation fails the job, so a stranded fleet can never again look
// like a successful deploy.
//
// app.json is restored byte-for-byte afterwards; the edit is never committed.
//
// Usage:
//   node scripts/ota-publish-extra-runtimes.mjs \
//     --app-dir apps/pickup-native \
//     --message "commit subject" \
//     --channel production [--channel preview] \
//     --platform all [--environment production]

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const out = { channels: [], platform: "all", environment: null, appDir: null, message: "" };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    switch (flag) {
      case "--app-dir": out.appDir = value; break;
      case "--message": out.message = value; break;
      case "--channel": out.channels.push(value); break;
      case "--platform": out.platform = value; break;
      case "--environment": out.environment = value; break;
      default: throw new Error(`Unknown flag ${flag}`);
    }
  }
  if (!out.appDir) throw new Error("--app-dir is required");
  if (out.channels.length === 0) throw new Error("at least one --channel is required");
  return out;
}

// The manifest is deliberately tiny and hand-maintained: only a human knows
// which store binaries are still out there. tests/ota-runtime-coverage.test.ts
// enforces its shape and the policy invariants.
export function readExtraRuntimes(appDir) {
  const file = path.join(appDir, "ota-runtimes.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      `${file} is missing. Every native app must declare the in-field runtimes ` +
        `its normal OTA publish does not reach (use an empty extraRuntimes list ` +
        `once the whole fleet matches app.json).`,
    );
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const extra = parsed.extraRuntimes;
  if (!Array.isArray(extra) || extra.some((r) => typeof r !== "string" || r.trim() === "")) {
    throw new Error(`${file}: "extraRuntimes" must be an array of non-empty strings.`);
  }
  return extra;
}

// eas prints one "Runtime version   <value>" block per published update group.
// We assert every group carries the runtime we asked for — the whole point of
// this script is that "published successfully" is not the same as "published
// where devices can see it".
export function parsePublishedRuntimes(output) {
  const found = [];
  for (const line of output.split("\n")) {
    const m = /^\s*Runtime version\s+(\S+)\s*$/.exec(line);
    if (m) found.push(m[1]);
  }
  return found;
}

export function verifyPublish({ output, expected }) {
  const published = parsePublishedRuntimes(output);
  if (published.length === 0) {
    return { ok: false, reason: `eas printed no "Runtime version" line — cannot confirm the update reached runtime ${expected}.` };
  }
  const wrong = published.filter((r) => r !== expected);
  if (wrong.length > 0) {
    return { ok: false, reason: `expected every update group on runtime ${expected}, got ${published.join(", ")}.` };
  }
  return { ok: true, published };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const appDir = path.resolve(args.appDir);
  const appJsonPath = path.join(appDir, "app.json");

  const extraRuntimes = readExtraRuntimes(appDir);
  if (extraRuntimes.length === 0) {
    console.log(
      `[ota] ${args.appDir}: no extra in-field runtimes declared — the normal publish covers the whole fleet.`,
    );
    return;
  }

  const originalAppJson = fs.readFileSync(appJsonPath, "utf8");
  const failures = [];

  try {
    for (const runtime of extraRuntimes) {
      const pinned = JSON.parse(originalAppJson);
      pinned.expo.runtimeVersion = runtime;
      fs.writeFileSync(appJsonPath, `${JSON.stringify(pinned, null, 2)}\n`);

      for (const channel of args.channels) {
        const easArgs = [
          "eas-cli@latest", "update",
          "--channel", channel,
          "--platform", args.platform,
          "--message", args.message,
          "--non-interactive",
        ];
        if (args.environment) easArgs.push("--environment", args.environment);

        console.log(`\n[ota] publishing to in-field runtime ${runtime} (channel ${channel})…`);
        const run = spawnSync("npx", easArgs, { cwd: appDir, encoding: "utf8", env: process.env });
        const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
        process.stdout.write(output);

        if (run.status !== 0) {
          failures.push(`runtime ${runtime} / channel ${channel}: eas update exited ${run.status}`);
          continue;
        }
        const verdict = verifyPublish({ output, expected: runtime });
        if (!verdict.ok) {
          failures.push(`runtime ${runtime} / channel ${channel}: ${verdict.reason}`);
        } else {
          console.log(`[ota] ✔ runtime ${runtime} (channel ${channel}) confirmed.`);
        }
      }
    }
  } finally {
    fs.writeFileSync(appJsonPath, originalAppJson);
    console.log(`\n[ota] restored ${path.relative(process.cwd(), appJsonPath)}.`);
  }

  if (failures.length > 0) {
    console.error(`\n[ota] FAILED — the in-field fleet did NOT receive this update:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\n[ota] all ${extraRuntimes.length} in-field runtime(s) confirmed.`);
}

// Only run when invoked directly, so the parsing helpers stay unit-testable.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
