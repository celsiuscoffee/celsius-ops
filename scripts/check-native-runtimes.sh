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

  OLD_BUILD=$(git show "$BASE:$APP_JSON" | jq -r '[.expo.ios.buildNumber, (.expo.android.versionCode|tostring)] | join("/")')
  NEW_BUILD=$(jq -r '[.expo.ios.buildNumber, (.expo.android.versionCode|tostring)] | join("/")' "$APP_JSON")
  [ "$OLD_VER" = "$NEW_VER" ] && [ "$OLD_BUILD" = "$NEW_BUILD" ] && continue

  if [ "$OLD_POLICY" = "appVersion" ]; then
    # The runtime IS the marketing version, so we know exactly what the
    # stranded devices report and can require it by name.
    [ "$OLD_VER" = "$NEW_VER" ] && continue
    if ! jq -e --arg v "$OLD_VER" '.extraRuntimes | index($v)' "$MANIFEST" > /dev/null; then
      err "$APP_JSON bumps expo.version $OLD_VER -> $NEW_VER under the appVersion runtime policy."
      err "Devices running the $OLD_VER binary keep runtime \"$OLD_VER\" and will receive NO further OTA."
      err "Add \"$OLD_VER\" to $MANIFEST (extraRuntimes) so the OTA workflow republishes to them."
      FAILED=1
    fi
  else
    # Fingerprint policy. MEASURED 2026-08-21: the version identity IS part of
    # the fingerprint — bumping pickup-native 1.0.3/12/10 -> 1.0.4/13/11 moved
    # ios e4e2beee -> c24dc6b2 and android dbe20143 -> 0c74b3fd. So a version
    # bump DOES mint a new runtime here (the ota-release skill used to claim the
    # opposite). Any fleet already running a build with the OLD fingerprint stops
    # receiving OTAs unless that fingerprint is republished to.
    #
    # We cannot name the old fingerprint cheaply (it needs a full install at the
    # base ref), so require a deliberate decision instead: the manifest must be
    # touched in the same PR — either adding the outgoing fingerprint, or
    # recording that no fleet is on it yet.
    if git diff --quiet "$BASE"...HEAD -- "$MANIFEST"; then
      err "$APP_JSON changes the version identity ($OLD_VER/$OLD_BUILD -> $NEW_VER/$NEW_BUILD) under the fingerprint runtime policy."
      err "The version identity is part of the fingerprint, so this MINTS A NEW RUNTIME."
      err "Any devices already running a build with the outgoing fingerprint will receive NO further OTA."
      err "Update $MANIFEST in this PR: add that fingerprint to extraRuntimes, or note there that no fleet is on it yet."
      FAILED=1
    fi
  fi
done

if [ "$FAILED" -ne 0 ]; then exit 1; fi
echo "Native runtime guard passed."
