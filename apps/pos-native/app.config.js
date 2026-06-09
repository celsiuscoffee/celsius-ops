// Dynamic Expo config layered on top of app.json.
//
// Purpose: bake the EAS Update *channel* into LOCAL / CI gradle builds.
//
// EAS Build injects the channel itself from eas.json (production-apk -> the
// "production" channel), but a plain `expo prebuild` + `gradlew assembleRelease`
// (how this app is actually shipped, and how the GitHub CI builds it) does NOT.
// Without a baked `expo-channel-name` header, a locally-built APK sends no
// channel on its update request, so `eas update --branch production` pushes
// never reach it and OTA silently dies.
//
// We only add it when NOT running under EAS Build, so EAS builds keep using the
// eas.json channel with no conflicting config. Override with EXPO_OTA_CHANNEL.
module.exports = ({ config }) => {
  if (!process.env.EAS_BUILD) {
    const channel = process.env.EXPO_OTA_CHANNEL || "production";
    config.updates = {
      ...(config.updates || {}),
      requestHeaders: {
        ...((config.updates || {}).requestHeaders || {}),
        "expo-channel-name": channel,
      },
    };
  }
  return config;
};
