#!/usr/bin/env bash
# In-field runtime guard (run by CI's native-runtime-guard job).
#
# `eas update` publishes to the runtimeVersion app.json resolves to; an INSTALLED
# app only accepts updates matching the runtimeVersion it was BUILT with. When
# those diverge the publish still succeeds — into a runtime no device has — the
# OTA workflow goes green, and customers sit on an old bundle. That stranded the
# entire pickup-native fleet from 2026-07-25 to 2026-08-21: two merged fixes
# reached zero phones.
#
# Under the `appVersion` policy, bumping expo.version mints a NEW runtime, so
# every device still on the old binary is cut off unless the OLD version is
# listed in apps/<app>/ota-runtimes.json (which the OTA workflows republish to).
# This fails the PR that forgets.
#
# Usage: scripts/check-native-runtimes.sh <base-ref>
set -uo pipefail

BASE="${1:?usage: check-native-runtimes.sh <base-ref>}"
APPS=(pickup-native pos-native staff-native)
FAILED=0

# GitHub Actions annotations locally degrade to plain text, which is fine.
err() { echo "::error::$*"; }

for APP in "${APPS[@]}"; do
  APP_JSON="apps/$APP/app.json"
  MANIFEST="apps/$APP/ota-runtimes.json"

  if [ ! -f "$MANIFEST" ]; then
    err "$MANIFEST is missing. Every native app must declare the in-field runtimes its OTA publish does not reach (an empty extraRuntimes list is fine once the whole fleet matches app.json)."
    FAILED=1
    continue
  fi
  if ! jq -e '.extraRuntimes | type == "array"' "$MANIFEST" > /dev/null 2>&1; then
    err "$MANIFEST: \"extraRuntimes\" must be an array of runtime strings."
    FAILED=1
    continue
  fi

  # Only a change to the app's version identity can strand devices.
  if git diff --quiet "$BASE"...HEAD -- "$APP_JSON"; then continue; fi

  OLD_VER=$(git show "$BASE:$APP_JSON" | jq -r '.expo.version')
  NEW_VER=$(jq -r '.expo.version' "$APP_JSON")
  OLD_POLICY=$(git show "$BASE:$APP_JSON" | jq -r '.expo.runtimeVersion.policy // .expo.runtimeVersion // ""')

  [ "$OLD_VER" = "$NEW_VER" ] && continue
  # Under fingerprint the runtime is the native fingerprint — a marketing
  # version bump does not move it, so nothing is stranded.
  [ "$OLD_POLICY" != "appVersion" ] && continue

  if ! jq -e --arg v "$OLD_VER" '.extraRuntimes | index($v)' "$MANIFEST" > /dev/null; then
    err "$APP_JSON bumps expo.version $OLD_VER -> $NEW_VER under the appVersion runtime policy."
    err "Devices running the $OLD_VER binary keep runtime \"$OLD_VER\" and will receive NO further OTA."
    err "Add \"$OLD_VER\" to $MANIFEST (extraRuntimes) so the OTA workflow republishes to them."
    FAILED=1
  fi
done

if [ "$FAILED" -ne 0 ]; then exit 1; fi
echo "Native runtime guard passed."
