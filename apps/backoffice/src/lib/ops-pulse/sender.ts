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

async function sendProactive(
  to: string,
  templateName: string,
  body: string,
): Promise<WhatsAppSendResult> {
  if (templateName) {
    return sendWhatsAppTemplate(to, templateName, TEMPLATES.languageCode, [
      { type: "body", parameters: [{ type: "text", text: body }] },
    ]);
  }
  return sendWhatsAppText(to, body);
}

export function sendManagerDigest(phone: string, lines: string[]): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) return Promise.resolve(NOT_CONFIGURED);
  return sendProactive(phone, TEMPLATES.managerDigest, composeManagerDigest(lines));
}

export function sendOwnerEscalation(phone: string, lines: string[]): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) return Promise.resolve(NOT_CONFIGURED);
  return sendProactive(phone, TEMPLATES.ownerEscalation, composeEscalation(lines));
}
