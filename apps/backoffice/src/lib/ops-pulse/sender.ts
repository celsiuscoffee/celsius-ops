// WhatsApp delivery for the ops pulse. One digest per recipient.
//
// Proactive (business-initiated) messages outside the recipient's 24h window
// REQUIRE an approved template. When OPS_PULSE_TPL_* is set we send the template
// (one body variable carrying the composed text); otherwise we fall back to
// free-form text, which Meta only delivers inside an open window — fine for a
// test ping to someone who just messaged the bot, NOT for production paging.

import {
  isWhatsAppConfigured,
  sendWhatsAppTemplate,
  sendWhatsAppText,
  type WhatsAppSendResult,
} from "@/lib/whatsapp";
import { TEMPLATES } from "./config";
import { recordOutbound } from "@/lib/wa-messages";

const NOT_CONFIGURED: WhatsAppSendResult = {
  ok: false,
  status: 0,
  error: "WhatsApp not configured",
};

export function composeManagerDigest(lines: string[]): string {
  const n = lines.length;
  const header = `🔴 Ops Pulse — ${n} item${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} you`;
  return [header, ...lines.map((l) => `• ${l}`), "", "Reply DONE when handled."].join("\n");
}

export function composeEscalation(lines: string[]): string {
  const n = lines.length;
  const header = `⚠️ Ops escalation — ${n} item${n === 1 ? "" : "s"} unacked past SLA`;
  return [header, ...lines.map((l) => `• ${l}`)].join("\n");
}

// The daily roundup — a once-a-day snapshot of everything outstanding in the
// recipient's lane, grouped Routine vs Adhoc. The predictable cadence builds the
// discipline.
export function composeDailyDigest(routine: string[], adhoc: string[]): string {
  const total = routine.length + adhoc.length;
  const parts = [`☀️ Daily Ops Pulse — ${total} open item${total === 1 ? "" : "s"}`];
  if (routine.length) parts.push("", "🔁 Routine", ...routine.map((l) => `• ${l}`));
  if (adhoc.length) parts.push("", "⚡ Adhoc", ...adhoc.map((l) => `• ${l}`));
  parts.push("", "Clear them today. Reply DONE as you go.");
  return parts.join("\n");
}

async function sendProactive(
  to: string,
  templateName: string,
  body: string,
): Promise<WhatsAppSendResult> {
  const result = templateName
    ? await sendWhatsAppTemplate(to, templateName, TEMPLATES.languageCode, [
        { type: "body", parameters: [{ type: "text", text: body }] },
      ])
    : await sendWhatsAppText(to, body);
  // Persist the outbound digest (success OR failure) so it shows in the Ops
  // chat inbox — failures are useful signal there too. Best-effort; the send
  // result is what the caller acts on, never the recording.
  try {
    await recordOutbound({
      to,
      body,
      templateName: templateName || undefined,
      ok: result.ok,
      waMessageId: result.messageId,
      error: result.error,
    });
  } catch (err) {
    console.error("[ops-pulse] persist outbound failed:", err);
  }
  return result;
}

export function sendManagerDigest(phone: string, lines: string[]): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) return Promise.resolve(NOT_CONFIGURED);
  return sendProactive(phone, TEMPLATES.managerDigest, composeManagerDigest(lines));
}

export function sendOwnerEscalation(phone: string, lines: string[]): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) return Promise.resolve(NOT_CONFIGURED);
  return sendProactive(phone, TEMPLATES.ownerEscalation, composeEscalation(lines));
}

export function sendDailyDigest(phone: string, routine: string[], adhoc: string[]): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) return Promise.resolve(NOT_CONFIGURED);
  return sendProactive(phone, TEMPLATES.dailyDigest, composeDailyDigest(routine, adhoc));
}
