// WhatsApp delivery for the ops pulse. One digest per recipient.
//
// Proactive (business-initiated) messages outside the recipient's 24h window
// REQUIRE an approved template. Each send therefore carries TWO renderings:
//   - free-form text: the full multi-line digest, delivered only inside an open
//     24h window (someone who just messaged the bot).
//   - template variable: a SINGLE-LINE, newline-free summary for the template's
//     {{1}} placeholder. WhatsApp REJECTS template parameters containing
//     newlines, tabs, or >4 consecutive spaces, so the rich multi-line text can
//     NOT be a variable — the template frames it ("☀️ Daily Ops Pulse … reply
//     DONE") and {{1}} carries the count + items joined on one line. Full detail
//     lives in the Ops chat inbox (/ops/chat-inbox).

import {
  isWhatsAppConfigured,
  sendWhatsAppTemplate,
  sendWhatsAppText,
  type WhatsAppSendResult,
} from "@/lib/whatsapp";
import { TEMPLATES } from "./config";
import { recordOutboundMessage } from "@/lib/whatsapp-store";

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

// ─── Template variable ({{1}}) builders ──────────────────────────────────
// A single-line, newline-free summary: "<count> <noun> · item · item · …".
// Items are joined with " · " and the whole thing is capped so the rendered
// template body stays well under WhatsApp's 1024-char limit; overflow is elided
// with a pointer to BackOffice (where the full list lives).
function summarize(items: string[], max = 600): string {
  if (items.length === 0) return "";
  const joined = items.join(" · ");
  if (joined.length <= max) return joined;
  return joined.slice(0, max - 1).replace(/\s+\S*$/, "") + " … (more in BackOffice)";
}

export function managerDigestVar(lines: string[]): string {
  return `${lines.length} need you · ${summarize(lines)}`;
}

export function escalationVar(lines: string[]): string {
  return `${lines.length} unacked past SLA · ${summarize(lines)}`;
}

export function dailyDigestVar(routine: string[], adhoc: string[]): string {
  const total = routine.length + adhoc.length;
  const items = summarize([...routine, ...adhoc]);
  return items ? `${total} open today · ${items}` : `${total} open today`;
}

// WhatsApp template parameters can't contain newlines, tabs, or >4 consecutive
// spaces. Collapse any whitespace run to a single space — defensive so a stray
// newline can never bounce a send, even though the *Var builders are flat.
function sanitizeParam(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// `freeForm` is the full multi-line text (in-window fallback); `templateVar` is
// the newline-free {{1}} content used when an approved template is configured.
async function sendProactive(
  to: string,
  templateName: string,
  freeForm: string,
  templateVar: string,
): Promise<WhatsAppSendResult> {
  const usingTemplate = !!templateName;
  const param = sanitizeParam(templateVar);
  const result = usingTemplate
    ? await sendWhatsAppTemplate(to, templateName, TEMPLATES.languageCode, [
        { type: "body", parameters: [{ type: "text", text: param }] },
      ])
    : await sendWhatsAppText(to, freeForm);
  // Persist the outbound digest (success OR failure) into the shared WhatsApp
  // store so it shows in the Ops chat inbox. We store what was actually sent —
  // the {{1}} summary for a template, the full text for free-form.
  // recordOutboundMessage swallows its own errors — the send result is what the
  // caller acts on, never the record.
  await recordOutboundMessage({
    waMessageId: result.messageId,
    fromNumber: process.env.WHATSAPP_DISPLAY_NUMBER || "",
    toNumber: to,
    type: usingTemplate ? "template" : "text",
    body: usingTemplate ? param : freeForm,
    status: result.ok ? "sent" : "failed",
  });
  return result;
}

export function sendManagerDigest(phone: string, lines: string[]): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) return Promise.resolve(NOT_CONFIGURED);
  return sendProactive(phone, TEMPLATES.managerDigest, composeManagerDigest(lines), managerDigestVar(lines));
}

export function sendOwnerEscalation(phone: string, lines: string[]): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) return Promise.resolve(NOT_CONFIGURED);
  return sendProactive(phone, TEMPLATES.ownerEscalation, composeEscalation(lines), escalationVar(lines));
}

export function sendDailyDigest(phone: string, routine: string[], adhoc: string[]): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) return Promise.resolve(NOT_CONFIGURED);
  return sendProactive(phone, TEMPLATES.dailyDigest, composeDailyDigest(routine, adhoc), dailyDigestVar(routine, adhoc));
}
