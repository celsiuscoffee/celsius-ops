/**
 * TEMPORARY read-only WhatsApp setup diagnostic. Key-gated, returns NO secrets
 * (only presence/length for the token + app secret). Used to confirm which app
 * and callback URL the WABA is actually subscribed to, since inbound webhooks
 * are not reaching /api/whatsapp/webhook.
 *
 * DELETE this route once the webhook routing is confirmed working.
 *
 *   GET /api/whatsapp/diag?key=celsius-wa-diag-7Kq2x9
 */
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GRAPH = "https://graph.facebook.com/v23.0";
const DIAG_KEY = "celsius-wa-diag-7Kq2x9";

async function g(path: string, token: string) {
  try {
    const url = `${GRAPH}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, json };
  } catch (e) {
    return { status: 0, ok: false, error: String(e) };
  }
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("key") !== DIAG_KEY) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const waba = process.env.WHATSAPP_WABA_ID;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  const out: Record<string, unknown> = {
    env: {
      WHATSAPP_PHONE_NUMBER_ID: { set: !!phoneId, value: phoneId ?? null },
      WHATSAPP_WABA_ID: { set: !!waba, value: waba ?? null },
      WHATSAPP_ACCESS_TOKEN: { set: !!token, len: token?.length ?? 0 },
      WHATSAPP_APP_SECRET: { set: !!process.env.WHATSAPP_APP_SECRET, len: process.env.WHATSAPP_APP_SECRET?.length ?? 0 },
      WHATSAPP_VERIFY_TOKEN: { set: !!process.env.WHATSAPP_VERIFY_TOKEN, len: process.env.WHATSAPP_VERIFY_TOKEN?.length ?? 0 },
    },
  };

  if (token && waba) {
    // The decisive call: which app(s) + override callback URL is this WABA wired to.
    out.subscribed_apps = await g(`/${waba}/subscribed_apps`, token);
    out.waba = await g(`/${waba}?fields=id,name,timezone_id,account_review_status,business_verification_status`, token);
    out.phone_numbers = await g(
      `/${waba}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,platform_type,code_verification_status,name_status`,
      token,
    );
  }
  if (token && phoneId) {
    out.phone = await g(
      `/${phoneId}?fields=id,display_phone_number,verified_name,quality_rating,platform_type,webhook_configuration`,
      token,
    );
  }

  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}
