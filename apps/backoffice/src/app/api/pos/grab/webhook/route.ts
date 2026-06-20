/**
 * Grab Webhook Receiver — handles Submit Order + Push Order State.
 *
 * Grab posts/PUTs here with x-grab-signature (HMAC-SHA256 over the raw body,
 * keyed on GRAB_HMAC_SECRET — falls back to GRAB_CLIENT_SECRET for staging
 * test stores that share secrets).
 *
 * The actual order ingestion lives in lib/grab-ingest (ingestGrabOrder) — the
 * SAME code the reconciliation job replays with — so a backfilled order is
 * created identically to a webhook-delivered one. Every authenticated hit is
 * also logged to grab_webhook_events (raw payload + outcome) so a dropped order
 * is recoverable and the drop rate is measurable instead of invisible.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { verifyWebhookSignature } from "@/lib/grab";
import { verifyGrabPartnerToken } from "@/lib/grab-partner";
import { ingestGrabOrder, type GrabWebhookPayload, type IngestResult } from "@/lib/grab-ingest";
import { createClient } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";

// Durable raw-payload log. Best-effort: a logging failure must never change the
// webhook's response to Grab (or it would retry a successfully-ingested order).
async function captureEvent(
  supabase: SupabaseClient,
  payload: GrabWebhookPayload,
  method: string,
  result: IngestResult,
) {
  try {
    await supabase.from("grab_webhook_events").insert({
      id: randomUUID(),
      method,
      order_id: payload.orderID ?? null,
      short_order_number: payload.shortOrderNumber ?? null,
      merchant_id: payload.merchantID ?? null,
      order_state: payload.orderState ?? null,
      item_count: Array.isArray(payload.items) ? payload.items.length : 0,
      action: result.action,
      pos_order_id: result.orderId ?? null,
      error: result.error ?? null,
      raw: payload as unknown as Record<string, unknown>,
    });
  } catch (e) {
    console.warn("[grab:webhook] event capture skipped:", e instanceof Error ? e.message : e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-grab-signature") || "";

    // Accept EITHER a valid partner Bearer token OR a matching HMAC signature.
    const bearerOk = await verifyGrabPartnerToken(request);
    const hmacOk = !!signature && verifyWebhookSignature(rawBody, signature);
    if (!bearerOk && !hmacOk) {
      // Reject silently — never echo computed HMAC candidates.
      console.warn(`[grab:webhook] unauthorized bearer=${bearerOk} hmac=${hmacOk} sig_present=${!!signature}`);
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload: GrabWebhookPayload = JSON.parse(rawBody);
    const supabase = await createClient();
    const itemCount = Array.isArray(payload.items) ? payload.items.length : 0;
    console.log(
      `[grab:webhook] hit method=${request.method} orderID=${payload.orderID} state=${payload.orderState ?? "<none>"} items=${itemCount} merchant=${payload.merchantID}`,
    );

    const result = await ingestGrabOrder(supabase, payload, { autoAccept: true });
    await captureEvent(supabase, payload, request.method, result);

    console.log(
      `[grab:webhook] orderID=${payload.orderID} action=${result.action}${result.orderId ? ` order=${result.orderId}` : ""}${result.error ? ` err=${result.error}` : ""}`,
    );

    if (result.action === "no_outlet") {
      console.error(`[grab:webhook] no outlet linked for merchantID=${payload.merchantID}`);
      return NextResponse.json(
        { error: "No outlet linked. Set outlets.grab_merchant_id in BackOffice → Integrations → GrabFood." },
        { status: 400 },
      );
    }
    if (result.action === "error") {
      console.error("[grab:webhook] ingest error:", result.error);
      return NextResponse.json({ error: `Failed to create order: ${result.error}` }, { status: 500 });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack.split("\n").slice(0, 4).join(" | ") : "";
    console.error(`[grab:webhook] EXCEPTION msg=${msg} stack=${stack}`);
    return NextResponse.json({ error: "Internal server error", debug: { msg, stack } }, { status: 500 });
  }
}

// Grab simulator sometimes uses PUT for Push Order State. Same handler.
export const PUT = POST;

// Grab may GET to verify reachability.
export async function GET() {
  return NextResponse.json({ status: "ok", service: "celsius-pos-grab-webhook" });
}
