/**
 * WhatsApp Cloud API webhook receiver.
 *
 * GET  — Meta's verification handshake. Echoes hub.challenge when hub.mode is
 *        "subscribe" and hub.verify_token matches WHATSAPP_VERIFY_TOKEN. Run
 *        once when you set the callback URL in the Meta app's WhatsApp config.
 * POST — inbound messages + delivery/read/failed statuses. Validated against
 *        X-Hub-Signature-256 (HMAC-SHA256 of the RAW body, keyed on the app
 *        secret). For now we log; routing inbound messages into a customer
 *        -service flow / auto-reply is the next extension point (see TODO).
 *
 * CSRF: /api/whatsapp/webhook is added to middleware.ts exemptPrefixes — Meta
 * calls carry no browser Origin header, only the HMAC signature.
 *
 * Callback URL to register in Meta:
 *   https://backoffice.celsiuscoffee.com/api/whatsapp/webhook
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyWhatsAppSignature } from "@/lib/whatsapp";
import { handleInboundAck } from "@/lib/ops-pulse/inbound";
import { recordInbound, updateOutboundStatus } from "@/lib/wa-messages";

// GET — webhook verification handshake.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && !!verifyToken && token === verifyToken) {
    // Meta expects the raw challenge string echoed back with 200.
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  // Observability for webhook-setup debugging. Logs LENGTHS only, never the
  // token values: env_set/env_len reveal whether WHATSAPP_VERIFY_TOKEN reached
  // this deployment (env_len=0 ⇒ unset or wrong env-scope in Vercel), got_len is
  // what the caller sent. Distinguishes "env missing" from "value mismatch".
  console.warn(
    `[whatsapp:webhook] verify failed mode=${mode} token_match=${token === verifyToken} env_set=${!!verifyToken} env_len=${verifyToken?.length ?? 0} got_len=${token?.length ?? 0}`,
  );
  return new NextResponse("Forbidden", { status: 403 });
}

// POST — inbound events (messages + statuses).
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyWhatsAppSignature(rawBody, signature)) {
    // Reject silently. NEVER echo the expected signature — doing so would leak
    // it and let an attacker forge webhooks once WHATSAPP_APP_SECRET is set.
    console.warn(`[whatsapp:webhook] unauthorized sig_present=${!!signature}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  // Meta delivers a batched envelope: entry[].changes[].value.{messages,statuses}
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      for (const msg of value.messages ?? []) {
        const text = msg.text?.body ?? `<${msg.type}>`;
        console.log(
          `[whatsapp:webhook] inbound from=${msg.from} type=${msg.type} text=${JSON.stringify(text)}`,
        );
        // Persist EVERY inbound message (not just acks) so the Ops chat inbox
        // shows the full thread. Best-effort — never block the webhook 200.
        try {
          await recordInbound({
            from: msg.from,
            waMessageId: msg.id,
            type: msg.type,
            body: text,
            at: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : undefined,
          });
        } catch (err) {
          console.error("[whatsapp:webhook] persist inbound failed:", err);
        }
        // Ops pulse ack: a manager/owner replying "DONE" (etc.) resolves their
        // open OpsAlerts. No-op when the sender isn't staff or it's not an ack.
        // Never let this break the webhook — Meta must still get a fast 200.
        try {
          const ack = await handleInboundAck(msg.from, msg.text?.body ?? "");
          if (ack && ack.resolved > 0) {
            console.log(`[ops-pulse] ack from=${msg.from} resolved=${ack.resolved} alert(s)`);
          }
        } catch (err) {
          console.error("[ops-pulse] inbound ack failed:", err);
        }
        // TODO: route non-ack inbound messages — customer-service thread /
        // auto-reply. The 24-hour free-form window opens when this arrives.
      }
      for (const status of value.statuses ?? []) {
        console.log(
          `[whatsapp:webhook] status id=${status.id} status=${status.status} recipient=${status.recipient_id ?? "?"}`,
        );
        // Advance the matching outbound row's delivery status (sent → delivered
        // → read, or failed) for the inbox. Best-effort.
        try {
          await updateOutboundStatus(status.id, status.status);
        } catch (err) {
          console.error("[whatsapp:webhook] persist status failed:", err);
        }
      }
    }
  }

  // Always 200 fast so Meta doesn't retry. Heavy work should be fire-and-forget.
  return NextResponse.json({ received: true });
}

// Minimal shapes for the fields we read. Full schema: Cloud API webhook docs.
interface WhatsAppWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        messages?: Array<{
          from: string;
          id: string;
          timestamp?: string;
          type: string;
          text?: { body?: string };
        }>;
        statuses?: Array<{
          id: string;
          status: string;
          recipient_id?: string;
        }>;
      };
    }>;
  }>;
}
