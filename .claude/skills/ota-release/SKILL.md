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

**A version bump is NOT runtime-safe, on either policy.** An earlier version of
this skill claimed the fingerprint policy made `version` bumps harmless. That is
false, and it was measured on 2026-08-21: bumping pickup-native
`1.0.3`/build 12/versionCode 10 → `1.0.4`/13/11 moved the fingerprint from
`e4e2beee…` → `c24dc6b2…` (ios) and `dbe20143…` → `0c74b3fd…` (android). The
version identity is one of the fingerprint's inputs. Reproduce with:

```bash
cd apps/<app> && npx expo-updates fingerprint:generate --platform ios
```

So on BOTH policies, changing the version identity mints a new runtime and cuts
off every device still running the old binary — unless that old runtime is
listed in the app's `ota-runtimes.json`. CI's `native-runtime-guard`
(`scripts/check-native-runtimes.sh`) enforces this: it names the stranded
runtime outright under `appVersion`, and under `fingerprint` requires the
manifest to be touched in the same PR (the old fingerprint can't be derived
without a full install at the base ref).

APK builds: `pos-native-build-apk.yml` and `build-kds-apk.yml`
(workflow_dispatch or push). OTA-only changes shipped on top of an outdated
APK silently no-op on devices still running an older runtimeVersion — after a
native change, rebuild and reinstall before relying on OTA again.

### The "old bundle reappears" regression — and why it came back (2026-08-21)

Symptom: an old app version resurfaces on customer devices on its own;
reinstalling seems to fix it, then it comes back.

**The rule underneath both rounds of this bug:** `eas update` publishes to the
runtimeVersion **app.json resolves to**; an installed app only accepts updates
matching the runtimeVersion **it was built with**. When those diverge, the
publish still *succeeds* — into a runtime no device has. The workflow goes
green, and the fleet quietly keeps running whatever bundle it last matched. A
green OTA run is NOT evidence that a single phone received anything.

Round 1 (2026-07-25): `policy: "appVersion"` glued the runtime to the marketing
`version`, so each bump (pickup-native climbed 1.0.0→1.0.3) minted a new runtime
and severed the update lineage. Fix: `policy: "fingerprint"` on **pickup-native
only** (owner narrowed the scope; pos-native and staff-native are still on
`appVersion`).

Round 2 (found 2026-08-21): the fingerprint switch *itself* re-created the
divergence in the other direction. Every store binary in the field was built
before the switch, so those phones report runtime `1.0.3`, while
`pickup-native-ota.yml` began publishing to fingerprint hashes. Both merges that
followed (#1112, #1155) published successfully to `e4e2beee…` / `dbe20143…` and
reached **zero customers** for four weeks. The one-off
`pickup-native-ota-catchup.yml` existed to paper over this, but it was manual
and nobody re-ran it. A reinstall then dropped phones onto the store binary's
**embedded** bundle, older still — that is the "reverts to the old build" the
owner kept seeing.

**The permanent mechanism (do not replace this with a manual step):** each app
declares the in-field runtimes its normal publish misses in
`apps/<app>/ota-runtimes.json` (`extraRuntimes`). Every OTA workflow runs
`scripts/ota-publish-extra-runtimes.mjs` after the normal publish, which pins a
literal `expo.runtimeVersion` into app.json per entry (eas-cli has no
`--runtime-version` flag), republishes the same bundle, and **fails the job**
unless eas confirms that exact runtime. So a stranded fleet can no longer look
like a successful deploy. `scripts/check-native-runtimes.sh` (CI job
`native-runtime-guard`) fails any PR that bumps `expo.version` under the
`appVersion` policy without adding the previous version to that app's manifest.

Retire `1.0.3` from pickup-native's manifest only once a fingerprint store build
has fully replaced the 1.0.3 fleet — dropping it early re-creates the bug.

### Cutting a store build (the step that closes the fresh-install half)

A fresh install boots the bundle COMPILED INTO the binary, before any OTA can
arrive. So an old store build means new customers see old UI on first launch no
matter how current the update channel is. Only a new binary fixes that.

1. Bump `version` / `ios.buildNumber` / `android.versionCode` in the app's
   `app.json` (`eas.json` uses `appVersionSource: "local"`, so these are the
   source of truth).
2. Build from `main` so the embedded bundle is current:
   `cd apps/<app> && npm ci && npx eas build --platform all --profile production`
3. Submit: `npx eas submit --platform android|ios --profile production`.
4. **Read the new build's runtimeVersion off the EAS build page and add it to
   that app's `ota-runtimes.json`.** Do not guess it from a local
   `fingerprint:generate` — the build's own value is authoritative. Skipping
   this is how the next fingerprint move strands the fleet you just shipped.
5. Retire older runtimes from the manifest only once the new build has actually
   replaced them in the field (weeks, not days).

## Pre-merge checklist (pos-native especially — this is the till)

1. `cd apps/<app> && npm ci && npx tsc --noEmit` — for pos-native/pickup-native
   this typecheck is **the only gate** between a TS error and a broken till;
   the OTA workflows do no pre-build validation.
2. Confirm the change is JS-only (see decision above) or plan an APK build.
3. Human approval before merging pos-native changes (CLAUDE.md hard rule 6).

## Post-merge verification

1. Watch the `<app> OTA` workflow run to completion in GitHub Actions.
2. **Check the "Publish to in-field legacy runtimes (and verify)" step, not just
   the green tick.** It prints one confirmed runtime per entry in the app's
   `ota-runtimes.json`. A green run whose only published runtimes are fingerprint
   hashes reached nobody — that is the 2026-08-21 failure mode.
3. Cross-check the runtime against a real device: `npx eas-cli update:list
   --branch production` (needs `EXPO_TOKEN`) and compare with the runtimeVersion
   the installed build reports, or relaunch a test device and check behaviour.
4. Rollback = revert the commit on main; the OTA workflow republishes the old
   bundle to every in-field runtime. `workflow_dispatch` on the OTA workflow
   re-pushes on demand (this replaced the marker-file catch-up/deploy
   workflows, which were removed 2026-08-21 — one was pinned to a stale
   `claude/*` branch and published that branch's JS straight to customers).

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

- 2026-08-21 — **"OTA workflow succeeded" proves nothing about delivery.** Treat
  a runtimeVersion change (policy OR value) as a fleet-severing event in both
  directions: moving *to* fingerprint stranded every appVersion binary just as
  surely as the appVersion bumps had. Before believing any native fix shipped,
  read the runtime in the publish log and compare it to what installed binaries
  report — `app.json` still sitting at version 1.0.3 / buildNumber 12 /
  versionCode 10 was the tell that no fingerprint build existed, so nothing in
  the field could match a fingerprint publish. Also: a fresh install always
  boots the store binary's **embedded** bundle first, so an app whose store
  build is months old shows old UI on first launch no matter how current the OTA
  channel is — only a new store build fixes that half.

- 2026-08-21 (b) — **The fingerprint includes the version identity — measured,
  not assumed.** This skill previously asserted the opposite and that assertion
  was load-bearing: it would have let a post-1.0.4 version bump strand the
  fingerprint fleet exactly the way the appVersion bumps stranded the 1.0.x one.
  Verify runtime claims with `npx expo-updates fingerprint:generate` before
  writing them down. Corollary: the `pickup-native` OTA that stranded the fleet
  published to `e4e2beee…`/`dbe20143…`, which is precisely the fingerprint of the
  1.0.3 tree — confirming the publish targeted the CURRENT source rather than
  anything installed.
