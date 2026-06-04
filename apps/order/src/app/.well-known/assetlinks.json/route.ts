/**
 * GET /.well-known/assetlinks.json
 *
 * Android App Links. Lets the Celsius Coffee app
 * (com.celsiuscoffee.pickup.next) auto-open
 * https://order.celsiuscoffee.com/table/* links when installed (the app's
 * intentFilters set autoVerify), else the browser. Pairs with
 * android.intentFilters in apps/pickup-native/app.json.
 *
 * ⚠️ sha256_cert_fingerprints MUST be the Play **app-signing** key SHA-256
 * (Play Console → App integrity → App signing → "App signing key
 * certificate"), NOT the upload key — Google re-signs the APK, so the
 * installed app is signed with the app-signing key. Until the real
 * fingerprint replaces the placeholder, Android won't verify the link and
 * will open the browser (a graceful fallback, not a break). This is a
 * web-only file — once the SHA is in, redeploy; no new app build needed.
 */
export function GET() {
  return Response.json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "com.celsiuscoffee.pickup.next",
        sha256_cert_fingerprints: [
          // TODO: replace with the Play app-signing key SHA-256.
          "REPLACE_WITH_PLAY_APP_SIGNING_SHA256",
        ],
      },
    },
  ]);
}
