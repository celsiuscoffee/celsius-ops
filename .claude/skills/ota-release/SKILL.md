---
name: ota-release
description: Ship or verify a release of the native apps (pos-native, pickup-native, staff-native). Use before merging any change under apps/*-native to main, when asked to release/rollback a native app, or when deciding whether a change can go OTA vs needing a new APK build.
---

# Native app releases (EAS OTA + APK)

A merge to `main` touching `apps/pos-native`, `apps/pickup-native`, or
`apps/staff-native` **is a production deploy**: the matching
`.github/workflows/<app>-ota.yml` publishes an EAS Update to the `production`
channel, and devices (SUNMI tills, KDS tablets, manager phones) pull the new JS
bundle on next app launch. There is no staging channel between merge and till.

## Decision: OTA or new APK?

OTA works only for **JS/asset-only** changes with unchanged `runtimeVersion`
(pinned to appVersion, e.g. 1.0.0). A change needs a **fresh APK build** if it
touches any of:

- native modules (`apps/pos-native/modules/` — customer-display, device-speaker,
  sunmi-printer)
- any dependency with native code (check whether `npx expo install` would alter
  android config); plain JS dep bumps are fine
- `app.json` / `eas.json` runtime or build config, permissions, appVersion

APK builds: `pos-native-build-apk.yml` and `build-kds-apk.yml`
(workflow_dispatch or push). OTA-only changes shipped on top of an outdated
APK silently no-op on devices still running an older runtimeVersion — after a
native change, rebuild and reinstall before relying on OTA again.

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
