# Deploying pos-native to the SUNMI registers

A practical guide so day-to-day changes ship in **~2 minutes over OTA**, and the
rare native change is **fast and hands-off** — no 30-minute cloud waits, no
copy-pasting commands.

## The one rule that decides everything: OTA or APK?

Ask: *does the change touch native code or dependencies?*

| Change | Path | Time | Needs the device? |
|---|---|---|---|
| JS / TS, screens, logic, text, pricing, **sounds (chime/alarm)**, in-app config | **OTA** (`eas update`) | ~2 min | No |
| New npm package, new native module, Android permission / plugin change | **APK build** | ~5–30 min | Yes (install) |

**~95% of changes are OTA.** You only rebuild an APK for a true native change.

## Why run Claude Code **locally** on the register Mac

The cloud session (claude.ai/code) runs in a remote container with **no path to
the SUNMI** — so it can do everything *except* talk to the device, which is why
installs get copy-pasted. **Claude Code running on the Mac that's wired to the
registers** uses that Mac's own terminal, so it can run `adb` / `eas` directly —
installs, printer reconnects, local builds, all hands-off.

- **Cloud session** → code, OTA deploys, DB/backoffice, GitHub. (Most work.)
- **Local Claude Code on the register Mac** → `adb install`, local APK builds,
  anything that touches the device.

## One-time setup on the register Mac (Mac Mini)

```bash
# 1. Node 20 + adb
brew install node@20
brew install --cask android-platform-tools      # gives `adb`

# 2. The repo
git clone <celsius-ops repo> && cd celsius-ops/apps/pos-native && npm install

# 3. EAS CLI + login (for OTA + builds)
npm i -g eas-cli
eas login                                        # or: export EXPO_TOKEN=<token>

# 4. Claude Code, run from the repo
npm i -g @anthropic-ai/claude-code
claude                                           # launch in the repo dir
```

**Optional — only if you want APKs built *on the Mac* (skips the cloud queue):**
```bash
brew install openjdk@17                          # JDK 17
# + Android SDK via Android Studio, then set ANDROID_HOME in your shell profile
```

## Daily: ship a JS/asset change over OTA (fast, reversible)

```bash
cd apps/pos-native
eas update --channel production --platform android --message "what changed"
```
The register pulls it on the next app launch (close + reopen twice on Wi-Fi).
**Reversible:** `eas update:rollback` (or just re-publish the previous version).

> In the cloud session this is the marker workflow: bump
> `apps/pos-native/.ota-deploy-trigger`, commit, push — it runs `eas update` for you.

## Rare: a native change → APK

**Local build (≈5–10 min, installs itself — needs the Android toolchain above):**
```bash
cd apps/pos-native
eas build --local --platform android --profile production-apk --output ./celsius-pos.apk
```
**Or cloud build (no local toolchain):** bump `apps/pos-native/.apk-build-trigger`,
commit, push → download the APK from expo.dev when it finishes.

Then **verify before installing** (catches a bad build before it touches a till):
```bash
unzip -p celsius-pos.apk 'classes*.dex' | grep -a -i -o -m3 -E 'sunmiprinter|customerdisplay'
# must print sunmiprinter + customerdisplay → modules are in. Empty → DO NOT install.
adb install -r ./celsius-pos.apk
# signature mismatch? -> adb uninstall com.celsiuscoffee.pos ; adb install ./celsius-pos.apk
```

## Connecting a SUNMI to the Mac

- **USB:** plug in, tap **Allow USB debugging** on the SUNMI → `adb devices`.
- **Wireless:** SUNMI → Developer options → Wireless debugging → *Pair device with
  pairing code*. Then on the Mac (use the popup's IP:port + code):
  ```bash
  adb pair 10.1.7.x:PORT      # enter the 6-digit code
  adb connect 10.1.7.x:PORT   # the port on the main Wireless-debugging screen
  adb devices
  ```

## Safety drill for native/APK changes (so it never breaks a live till)

1. **Never debut a native change on the only/live register.** Test on a **spare
   SUNMI** first, **off-peak**.
2. **Verify the APK** has the native modules (the `grep` above) **before** install.
3. **Keep the last known-good APK** on hand for instant rollback.
4. **One register first**, watch it, then the rest — never the whole fleet at once.

## Architecture note (why today happened)

`pos-native` is intentionally **not** an npm workspace, so EAS's monorepo install
skips its local `file:` modules. The `eas-build-post-install` hook in
`package.json` runs `npm install` in the app dir before prebuild so the local
native modules (`sunmi-printer`, `customer-display`) autolink. Keep that hook.
The native modules' `android/` folders are **force-added** past the repo-wide
`android/` gitignore — any *new* local module must also be `git add -f`'d and
added to the lockfile, or it ships as a phantom and breaks autolinking.
