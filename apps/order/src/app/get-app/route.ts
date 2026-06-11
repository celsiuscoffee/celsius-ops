/**
 * GET /get-app — smart app-download redirect.
 *
 * This is the URL behind the "Scan to download our app" QR printed on POS
 * receipts (pos_branch_settings.receipt_app_url). A single QR can't carry
 * two store links, so we sniff the platform and 302 to the right listing:
 *   iPhone/iPad  → App Store  (Celsius Coffee, id6766792077)
 *   Android      → Play Store (com.celsiuscoffee.pickup.next)
 *   anything else→ the web ordering app
 *
 * iPadOS Safari masquerades as macOS ("Macintosh") by default, so those
 * scans fall through to the web app — acceptable; receipt scans are
 * overwhelmingly phones. Kept uncached so store URLs can change freely.
 */

const APP_STORE_URL =
  "https://apps.apple.com/my/app/celsius-coffee/id6766792077";
const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.celsiuscoffee.pickup.next";
const WEB_FALLBACK_URL = "https://order.celsiuscoffee.com";

export function GET(request: Request) {
  const ua = request.headers.get("user-agent") ?? "";

  let target = WEB_FALLBACK_URL;
  if (/iPhone|iPad|iPod/i.test(ua)) {
    target = APP_STORE_URL;
  } else if (/Android/i.test(ua)) {
    target = PLAY_STORE_URL;
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      "Cache-Control": "no-store",
      Vary: "User-Agent",
    },
  });
}
