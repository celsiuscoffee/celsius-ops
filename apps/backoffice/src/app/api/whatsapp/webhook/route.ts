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

// The internal assistant can run several tool rounds (DB reads + model calls)
// before the reply — don't let the platform default cut the function mid-loop.
// Meta re-deliveries are already tolerated via the atomic wamid dedupe.
export const maxDuration = 60;
import { storeWhatsAppMedia } from "@/lib/whatsapp-media";
import { recordInboundMessage } from "@/lib/whatsapp-store";
import { handleInboundAck } from "@/lib/ops-pulse/inbound";
import { handleReminderAck } from "@/lib/ops-reminders";
import { handleInstructionAck } from "@/lib/ops-instructions";
import { handleOutletDeliveryReply } from "@/lib/inventory/exec/outlet-delivery-check";
import { handleInternalInbound } from "@/lib/ops-intake";
import { handleSupplierMessage } from "@/lib/inventory/agents/supplier-chat-agent";
import { sendPendingPurchaseOrders } from "@/lib/inventory/procurement-po-send";
import { captureSupplierDocument } from "@/lib/inventory/agents/invoice-capture";

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
      const businessNumber = value.metadata?.display_phone_number ?? "";
      for (const msg of value.messages ?? []) {
        const body = msg.text?.body ?? msg.image?.caption ?? msg.document?.caption ?? null;
        console.log(
          `[whatsapp:webhook] inbound from=${msg.from} type=${msg.type} text=${JSON.stringify(body ?? `<${msg.type}>`)}`,
        );
        // For image/document messages, fetch the media bytes once and persist them
        // to Supabase Storage so the inbox can open the attachment (the Cloud API
        // media id alone is useless — the download URL is short-lived + token-gated).
        // storeWhatsAppMedia never throws and returns null on any failure, so this
        // can't block the 200 to Meta.
        const mediaUrl =
          msg.type === "image" || msg.type === "document"
            ? await storeWhatsAppMedia(msg.image?.id ?? msg.document?.id ?? null)
            : null;
        // 1) Persist for the supplier-chat monitor/inbox (Option 1). Best-effort —
        // recordInboundMessage never throws, so it never blocks the 200 to Meta.
        // supplierId is matched by phone inside. Returns false on a Meta re-delivery
        // (duplicate wamid) — atomic via the @unique — so we run the agent exactly once.
        const isNewInbound = await recordInboundMessage({
          waMessageId: msg.id,
          fromNumber: msg.from,
          toNumber: businessNumber,
          type: msg.type,
          body,
          mediaUrl,
          timestamp: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : undefined,
          raw: msg,
        });
        // 2) Ops workspace acks: a staff member replying "DONE"/"OK" (etc.)
        // closes the loop on what was pushed to them — open OpsAlerts (leads),
        // assigned reminders, and pending instruction acks. Each is independent
        // and best-effort; one staff reply can clear all three batches (the
        // digest-batch model). Never let this break the webhook — Meta needs a
        // fast 200.
        let consumedByAck = false;
        try {
          const reply = msg.text?.body ?? "";
          const [alertAck, reminderAck, instructionAck, outletReply] = await Promise.all([
            handleInboundAck(msg.from, reply).catch((e) => {
              console.error("[ops-pulse] alert ack failed:", e);
              return null;
            }),
            handleReminderAck(msg.from, reply).catch((e) => {
              console.error("[ops-reminders] ack failed:", e);
              return null;
            }),
            handleInstructionAck(msg.from, reply).catch((e) => {
              console.error("[ops-instructions] ack failed:", e);
              return null;
            }),
            // An outlet staff member answering "did this delivery arrive?" — gates the
            // supplier chase (procurement). Best-effort; never blocks the 200 to Meta.
            handleOutletDeliveryReply(msg.from, reply).catch((e) => {
              console.error("[outlet-confirm] reply failed:", e);
              return null;
            }),
          ]);
          if (alertAck?.resolved || reminderAck?.completed || instructionAck?.acked || outletReply) {
            consumedByAck = true;
            console.log(
              `[ops-workspace] ack from=${msg.from} alerts=${alertAck?.resolved ?? 0} reminders=${reminderAck?.completed ?? 0} instructions=${instructionAck?.acked ?? 0}${outletReply ? ` outletDelivery=${outletReply.result}` : ""}`,
            );
          }
        } catch (err) {
          console.error("[ops-workspace] inbound ack failed:", err);
        }
        // 2b) Internal bug/problem intake: a message from an owner/admin/manager
        // phone files a SystemReport (text + screenshots), acks the reporter, and
        // pings the owner — and MUST NOT fall through to the supplier flows below
        // (the agent would reply to a manager; a manager's screenshot would be
        // vision-read as a supplier invoice). Non-internal senders pass straight
        // through. Internally guarded, never throws.
        let fromInternal = false;
        if (isNewInbound) {
          const intake = await handleInternalInbound({
            fromNumber: msg.from,
            text: body,
            mediaUrl,
            waMessageId: msg.id,
            type: msg.type,
            consumedByAck,
          });
          fromInternal = intake.internal;
        }
        // 3) Supplier-chat AI agent (full-auto, flag-gated + allow-listed). Reads
        // the message in PO context, auto-replies in the supplier's language, and
        // edits the PO for clear low-risk cases; substitutions / cancellations /
        // low-confidence escalate to a human. It's internally guarded and never
        // throws, so we AWAIT it (serverless can freeze after the response, so a
        // fire-and-forget promise might not run) — it still returns fast for
        // non-suppliers and when the flag is off. TODO: Telegram monitor mirror.
        // Skip on a re-delivery (isNewInbound === false): otherwise two concurrent Meta
        // re-deliveries could both pass the agent's own check and double-apply a PO edit +
        // double-reply. The @unique wamid makes the first inbound store the atomic claim.
        let agentCapturedInvoice = false;
        if (isNewInbound && !fromInternal && (msg.type === "text" || msg.type === "document" || msg.type === "image")) {
          const agentRes = await handleSupplierMessage({
            fromNumber: msg.from,
            toNumber: businessNumber,
            text: body ?? "",
            waMessageId: msg.id,
            type: msg.type,
            mediaId: msg.document?.id ?? msg.image?.id ?? null,
          });
          agentCapturedInvoice = !!agentRes?.invoiceCaptured;
        }
        // 3b) Universal invoice capture: any supplier document the agent did NOT
        // capture (OFF suppliers, no open PO, invoice arriving after the PO
        // completed, ad-hoc bills) still gets vision-read and filed as a DRAFT
        // invoice for human review. Internal only — never replies. Trusts the
        // parser's docType, so PoP/DO/SOA photos are left for their own flows.
        if (isNewInbound && !fromInternal && (msg.type === "document" || msg.type === "image") && !agentCapturedInvoice) {
          await captureSupplierDocument({
            fromNumber: msg.from,
            type: msg.type,
            mediaId: msg.document?.id ?? msg.image?.id ?? null,
          });
        }
        // 4) Queued PO delivery: this inbound just (re)opened the supplier's 24h
        // window — deliver any PO blocks waiting behind a cold-send template
        // prompt (raw.poPromptFor with no raw.poSentFor). Best-effort, internally
        // deduped, never throws.
        if (isNewInbound && !fromInternal) {
          await sendPendingPurchaseOrders(msg.from);
        }
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
          image?: { id?: string; caption?: string; mime_type?: string };
          document?: { id?: string; caption?: string; filename?: string; mime_type?: string };
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
