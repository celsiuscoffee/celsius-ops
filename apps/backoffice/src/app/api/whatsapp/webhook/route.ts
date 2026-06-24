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
  console.warn(`[whatsapp:webhook] verify failed mode=${mode} token_match=${token === verifyToken}`);
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
        // TODO: route inbound messages — open/append a customer-service thread,
        // fire an auto-reply via sendWhatsAppText, or notify staff. The 24-hour
        // free-form reply window opens the moment this message arrives.
      }
      for (const status of value.statuses ?? []) {
        console.log(
          `[whatsapp:webhook] status id=${status.id} status=${status.status} recipient=${status.recipient_id ?? "?"}`,
        );
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
