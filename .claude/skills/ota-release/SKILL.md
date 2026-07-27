---
name: ota-release
description: Ship or verify a release of the native apps (pos-native, pickup-native, staff-native). Use before merging any change under apps/*-native to main, when asked to release/rollback a native app, or when deciding whether a change can go OTA vs needing a new APK build.
---

# Native app releases (EAS OTA + APK)

A merge to `main` touching `apps/pos-native`, `apps/pickup-native`, or
`apps/staff-native` **is a production deploy**: the matching
`.github/workflows/<app>-ota.yml` publishes an EAS Update to the `production`
channel, and devices (SUNMI tills for `pos-native`, CUSTOMER PHONES for
`pickup-native`, manager phones for `staff-native`) pull the new JS bundle on
next app launch. There is no staging channel between merge and till.

## Decision: OTA or new APK?

OTA works only for **JS/asset-only** changes with unchanged `runtimeVersion`.
`pickup-native` uses `runtimeVersion.policy: "fingerprint"` (switched from
`appVersion` on 2026-07-25 — see below); `pos-native` and `staff-native` are
still on `appVersion` (same footgun still latent there — migrate them when their
next store build is cut). The fingerprint is derived from the native layer, so it
changes **iff** the native runtime changes. A change needs a **fresh APK/store
build** if it touches any of:

- native modules (`apps/pos-native/modules/` — customer-display, device-speaker,
  sunmi-printer)
- any dependency with native code (check whether `npx expo install` would alter
  android config); plain JS dep bumps are fine
- `app.json` / `eas.json` runtime or build config, permissions, plugins

Note: bumping the marketing `version` string is now **JS-safe** — it no longer
changes the runtimeVersion (that was the old `appVersion`-policy footgun), so a
version bump alone can ride OTA.

APK builds: `pos-native-build-apk.yml` and `build-kds-apk.yml`
(workflow_dispatch or push). OTA-only changes shipped on top of an outdated
APK silently no-op on devices still running an older runtimeVersion — after a
native change, rebuild and reinstall before relying on OTA again.

### The "old bundle suddenly reappears" regression (fixed 2026-07-25)

Symptom: an old app version resurfaces on customer/staff devices on its own;
deleting + reinstalling fixes it. Cause: `runtimeVersion.policy: "appVersion"`
glued the OTA runtime to the marketing `version`, so every bump (pickup-native
climbed 1.0.0→1.0.3) minted a NEW runtimeVersion and **severed the OTA update
lineage** — post-bump OTAs only reached the new runtime, and a device landing on
a fresh store binary booted its embedded (older) bundle with no matching OTA to
pull it forward. Fix: `policy: "fingerprint"` on all three apps. **Migration
cost:** the fix lands on the NEXT native build, so currently-stranded devices
recover only via reinstall or a new store release; the first fingerprint build
orphans existing installs one final time (unavoidable for any runtimeVersion
scheme change), then the lineage stays continuous.

**Catching the current fleet up (do this alongside the fingerprint merge):** the
switch means the normal `pickup-native-ota.yml` now publishes against a
fingerprint runtime no installed app matches, so today's fleet (appVersion
runtime `1.0.3`) would stop getting OTAs until reinstall / a new store build. Run
the `pickup-native OTA catch-up (legacy runtimes)` workflow
(`pickup-native-ota-catchup.yml`, manual dispatch, default runtime `1.0.3`) to
republish the current JS against the in-field appVersion runtime(s) — installed
apps then pull the latest bundle on next launch and land on the same JS as
everyone else. Only target runtimes whose native binary is compatible with the
current JS (1.0.3 is safe; older runtimes only if no native change since). Keep
running the catch-up per legacy runtime until the next fingerprint store build is
the only version in the field, then retire it.

## Pre-merge checklist (pos-native especially — this is the till)

1. `cd apps/<app> && npm ci && npx tsc --noEmit` — for pos-native/pickup-native
   this typecheck is **the only gate** between a TS error and a broken till;
   the OTA workflows do no pre-build validation.
2. Confirm the change is JS-only (see decision above) or plan an APK build.
3. Human approval before merging pos-native changes (CLAUDE.md hard rule 6).

## Post-merge verification

1. Watch the `<app> OTA` workflow run to completion in GitHub Actions.
2. Confirm the update landed: `npx eas-cli update:list --branch production`
   (needs `EXPO_TOKEN`), or relaunch a test device and check behaviour.
3. Rollback = revert the commit on main; the OTA workflow republishes the old
   bundle. `workflow_dispatch` on the OTA workflow re-pushes on demand.

## Gotchas (verified)

- `eas update` shells out to `expo export`; its interactive prompts ignore
  `--non-interactive` — the workflows set `CI=1` to suppress them.
- pos-native is Android-only; publishing without `--platform android` makes
  expo export try to bundle web and fail (no react-native-web).
- Commit messages are passed to `eas update` via env var, not inline — inline
  multi-line messages get shell-expanded into garbage args.

## Lessons

_Append dated entries when this skill misses something. Promote stable ones into
the sections above._

- 2026-07-27 — `pickup-native` is NOT a KDS: it is the customer app "Celsius
  Coffee" (`com.celsiuscoffee.pickup.next`, App Store id6766792077 + Play) —
  a pickup-native merge OTAs to CUSTOMER phones, the highest-blast-radius
  surface after the till. The old "KDS" label here and in CLAUDE.md caused an
  agent to nearly ship a customer-facing UI change believing it targeted
  kitchen tablets. Related: `build-kds-apk.yml` + `apps/order/android` are a
  vestigial "Celsius Orders" webview pointing at the retired `/staff/kds`
  URL — pending owner decision to delete; `apps/pickup` is the legacy
  webview wrapper (`com.celsiuscoffee.pickup`, no `.next`) that loads
  order.celsiuscoffee.com live, so WEB deploys instantly change whatever
  those legacy installs show.
