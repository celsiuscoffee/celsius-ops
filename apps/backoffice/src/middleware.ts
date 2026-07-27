import { NextRequest, NextResponse } from "next/server";
import { checkCsrf, applySecurityHeaders } from "@celsius/shared";

const COOKIE_NAME = "celsius-session";

// Origins allowed to make state-changing requests. Includes the
// canonical prod host plus the Vercel preview domain so PR previews
// keep working. Extend if a partner integration legitimately POSTs
// from a different origin.
const ALLOWED_ORIGINS = [
  "backoffice.celsiuscoffee.com",
  // Customer-facing QR review domain — its feedback form POSTs same-app.
  "review.celsiuscoffee.com",
];

// Host serving ONLY the public review page (review.celsiuscoffee.com/<outletId>).
const REVIEW_HOST = "review.celsiuscoffee.com";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // review.celsiuscoffee.com → the public review page, nothing else.
  // /<outletId> rewrites to /review/<outletId>; API + static pass through so
  // the page's own fetches work; anything else lands on the brand site.
  const host = (request.headers.get("host") ?? "").toLowerCase();

  // Legacy review links (old printed QRs, backoffice…/review/<id>) hop to the
  // customer domain so every scan lands on review.celsiuscoffee.com. Scoped to
  // the prod backoffice host so Vercel previews still serve /review directly.
  if (host === "backoffice.celsiuscoffee.com" && pathname.startsWith("/review/")) {
    const outletPath = pathname.slice("/review".length); // "/<outletId>"
    return NextResponse.redirect(`https://${REVIEW_HOST}${outletPath}`, 308);
  }
  if (host === REVIEW_HOST && !isApi && !pathname.startsWith("/_next") && !pathname.startsWith("/review/")) {
    const isAsset = /\.[a-z0-9]+$/i.test(pathname) || pathname === "/sw.js" || pathname === "/manifest.json";
    if (pathname === "/") {
      return NextResponse.redirect("https://celsiuscoffee.com");
    }
    if (!isAsset) {
      const url = request.nextUrl.clone();
      url.pathname = `/review${pathname}`;
      const rewritten = NextResponse.rewrite(url);
      applySecurityHeaders(rewritten, { isApi: false });
      return rewritten;
    }
  }

  // CSRF protection — runs FIRST so state-changing API requests are
  // checked even when we'd otherwise bypass middleware for /api/*.
  // GET/HEAD/OPTIONS, /api/webhooks/*, and /api/cron/* are exempt.
  //
  // Grab inbound partner-to-server endpoints don't carry browser Origin
  // headers — they're called by Grab's backend with OAuth client creds
  // (/oauth/token), partner Bearer JWT (menus / status / menu-sync), or
  // HMAC signature (webhook). The /webhook regex in checkCsrf already
  // exempts /api/pos/grab/webhook, but /oauth/token must be listed
  // explicitly. Listing all six prefixes keeps the surface obvious.
  const csrfFail = checkCsrf(request, {
    allowedOrigins: ALLOWED_ORIGINS,
    exemptPrefixes: [
      "/api/pos/grab/oauth/token",
      "/api/pos/grab/webhook",
      "/api/pos/grab/menus",
      "/api/pos/grab/status",
      "/api/pos/grab/menu-sync",
      "/api/pos/grab/merchant/menu",
      // Compat alias: Grab's portal has this store's webhook at the non-/pos
      // path. Same handler (api/grab/webhook/route re-exports the /pos one).
      "/api/grab/webhook",
      // WhatsApp Cloud API webhook — Meta posts inbound messages/statuses with
      // no browser Origin, authenticated by X-Hub-Signature-256 (verified in
      // the route against WHATSAPP_APP_SECRET).
      "/api/whatsapp/webhook",
      // Telegram pulse-bot webhook — Telegram POSTs owner replies + button taps
      // with no browser Origin, authenticated by the x-telegram-bot-api-secret-
      // token header (verified in the route against CELSIUS_PULSE_WEBHOOK_SECRET).
      // Without this exemption every reply/tap 403s at the CSRF gate before the
      // handler runs, so pay-and-claim approvals never land.
      "/api/agents/pulse-webhook",
    ],
  });
  if (csrfFail) {
    return NextResponse.json(
      { error: `CSRF check failed: ${csrfFail.reason}` },
      { status: 403 },
    );
  }

  // Build the response we'll return. We attach security headers ONCE
  // at the end, regardless of which short-circuit path we take, so
  // CSP/Cache-Control are guaranteed to ship on every response —
  // including /api/* responses that previously skipped headers.
  const buildResponse = (
    inner: () => NextResponse,
  ): NextResponse => {
    const r = inner();
    applySecurityHeaders(r, { isApi });
    return r;
  };

  // Skip static assets, auth, and internal routes — but still apply
  // headers via buildResponse() so API responses get CSP + no-store.
  if (
    pathname === "/login" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname.startsWith("/r/") ||
    pathname.startsWith("/review/") ||
    pathname.startsWith("/recover/") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.png" ||
    pathname === "/apple-touch-icon.png" ||
    pathname === "/sw.js" ||
    pathname === "/manifest.json" ||
    pathname.startsWith("/images/") ||
    pathname.startsWith("/fonts/") ||
    pathname.startsWith("/brand/")
  ) {
    return buildResponse(() => NextResponse.next());
  }

  // Authenticated pages: just check cookie exists, don't verify JWT
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return buildResponse(() => NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-touch-icon.png|images/|fonts/|sw.js|manifest.json).*)"],
};
