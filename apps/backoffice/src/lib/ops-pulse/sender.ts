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

// Free-form digests render with NO emojis and a blank line between each point
// (one item per "paragraph") for readability on the recipient's phone.
export function composeManagerDigest(lines: string[]): string {
  const n = lines.length;
  const header = `Ops Pulse — ${n} item${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} you`;
  return [header, "", lines.map((l) => `• ${l}`).join("\n\n"), "", "Reply DONE when handled."].join("\n");
}

export function composeEscalation(lines: string[]): string {
  const n = lines.length;
  const header = `Ops escalation — ${n} item${n === 1 ? "" : "s"} unacked past SLA`;
  return [header, "", lines.map((l) => `• ${l}`).join("\n\n")].join("\n");
}

// The daily roundup — a once-a-day snapshot of everything outstanding in the
// recipient's lane, grouped Routine vs Adhoc. The predictable cadence builds the
// discipline.
export function composeDailyDigest(routine: string[], adhoc: string[]): string {
  const total = routine.length + adhoc.length;
  const parts = [`Daily Ops Pulse — ${total} open item${total === 1 ? "" : "s"}`];
  if (routine.length) parts.push("", "Routine", "", routine.map((l) => `• ${l}`).join("\n\n"));
  if (adhoc.length) parts.push("", "Adhoc", "", adhoc.map((l) => `• ${l}`).join("\n\n"));
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
// Exported so the workspace's reminder + instruction senders reuse the exact
// same template-or-free-form delivery + message-store recording.
export async function sendProactive(
  to: string,
  templateName: string,
  freeForm: string,
  templateVar: string,
): Promise<WhatsAppSendResult> {
  const param = sanitizeParam(templateVar);

  // Prefer the approved template — it delivers outside the recipient's 24h window.
  if (templateName) {
    const tpl = await sendWhatsAppTemplate(to, templateName, TEMPLATES.languageCode, [
      { type: "body", parameters: [{ type: "text", text: param }] },
    ]);
    if (tpl.ok) {
      await recordOutboundMessage({
        waMessageId: tpl.messageId,
        fromNumber: process.env.WHATSAPP_DISPLAY_NUMBER || "",
        toNumber: to,
        type: "template",
        body: param,
        status: "sent",
        raw: { kind: templateName }, // durable classification for the ops message monitor
      });
      return tpl;
    }
    // Template path failed — most commonly the template isn't APPROVED yet. Fall
    // back to free-form (delivered inside an open 24h window). Logged so a
    // genuinely broken template never hides silently behind the fallback.
    console.warn(`[ops-pulse] template "${templateName}" failed (${tpl.error}); falling back to free-form`);
  }

  // Free-form path (no template configured, or template send failed).
  const ff = await sendWhatsAppText(to, freeForm);
  await recordOutboundMessage({
    waMessageId: ff.messageId,
    fromNumber: process.env.WHATSAPP_DISPLAY_NUMBER || "",
    toNumber: to,
    type: "text",
    body: freeForm,
    status: ff.ok ? "sent" : "failed",
    raw: { kind: templateName }, // durable classification for the ops message monitor
  });
  return ff;
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

// Audit digest — its own message/template for the discipline leads (barista =
// Syafiq, kitchen = Chef Bo). A weekly coaching cadence, kept separate from the
// ops daily digest so it reads as "your audits", not buried in ops routine.
export function composeAuditDigest(lines: string[]): string {
  const n = lines.length;
  const header = `Audit — ${n} due`;
  return [header, "", lines.map((l) => `• ${l}`).join("\n\n"), "", "Run it and log the report. Reply DONE when done."].join("\n");
}

export function auditDigestVar(lines: string[]): string {
  return `${lines.length} audit${lines.length === 1 ? "" : "s"} due · ${summarize(lines)}`;
}

export function sendAuditDigest(phone: string, lines: string[]): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) return Promise.resolve(NOT_CONFIGURED);
  return sendProactive(phone, TEMPLATES.audit, composeAuditDigest(lines), auditDigestVar(lines));
}

// ─── Reminder nudge ──────────────────────────────────────────────────────
// A single manager-authored to-do pinged to its assignee — on assign, then again
// when it falls due. `when` is a human due phrase ("due today 3pm" / "overdue")
// or empty. Reply DONE closes it (lib/ops-reminders handleReminderAck).
export function composeReminder(title: string, notes: string | null, when: string): string {
  const parts = ["Reminder", "", title];
  if (notes) parts.push("", notes);
  if (when) parts.push("", when);
  parts.push("", "Reply DONE when it's handled.");
  return parts.join("\n");
}

export function reminderVar(title: string, when: string): string {
  return when ? `${title} (${when})` : title;
}

export function sendReminder(
  phone: string,
  title: string,
  notes: string | null,
  when: string,
): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) return Promise.resolve(NOT_CONFIGURED);
  return sendProactive(phone, TEMPLATES.reminder, composeReminder(title, notes, when), reminderVar(title, when));
}

// ─── Instruction ─────────────────────────────────────────────────────────
// An ad-hoc directive/announcement fanned out to staff. `fromName` is who sent
// it (accountability — a directive has an author). Reply DONE/OK acknowledges.
export function composeInstruction(title: string, body: string, fromName: string): string {
  const parts = ["Instruction", "", title];
  if (body && body.trim() !== title.trim()) parts.push("", body);
  if (fromName) parts.push("", `— ${fromName}`);
  parts.push("", "Reply OK to confirm you've got it.");
  return parts.join("\n");
}

export function instructionVar(title: string, body: string): string {
  const flat = sanitizeParam(body && body !== title ? `${title} — ${body}` : title);
  return flat.length <= 700 ? flat : flat.slice(0, 699).replace(/\s+\S*$/, "") + " …";
}

export function sendInstruction(
  phone: string,
  title: string,
  body: string,
  fromName: string,
): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) return Promise.resolve(NOT_CONFIGURED);
  return sendProactive(phone, TEMPLATES.instruction, composeInstruction(title, body, fromName), instructionVar(title, body));
}

// ─── Performance scoreboard ────────────────────────────────────────────────
// The full board is rendered upstream (lib/ops-scoreboard/render); this just
// delivers it: free-form multi-line in-window, single-line {{1}} otherwise.
export function sendScoreboard(phone: string, text: string, templateVar: string): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) return Promise.resolve(NOT_CONFIGURED);
  return sendProactive(phone, TEMPLATES.scoreboard, text, templateVar);
}

// ─── Real-time staff nudges (clock-in / stock count) ───────────────────────
// Gentle, first-person reminders DM'd to the staff member (the manager copy goes
// out as a normal manager digest). Both ride the generic ops_nudge template.
export function composeClockInNudge(name: string, outletName: string, startTime: string): string {
  const first = name.split(" ")[0];
  return [
    `Hi ${first}, you're on shift at ${outletName} (${startTime}) but haven't clocked in yet.`,
    "",
    "Please clock in now in the staff app. Takes 5 seconds.",
  ].join("\n");
}

export function sendClockInNudge(
  phone: string,
  name: string,
  outletName: string,
  startTime: string,
): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) return Promise.resolve(NOT_CONFIGURED);
  const text = composeClockInNudge(name, outletName, startTime);
  const v = `Clock in for your ${startTime} shift at ${outletName} — you haven't yet.`;
  return sendProactive(phone, TEMPLATES.nudge, text, v);
}

export function composeStockCountNudge(outletName: string, full: boolean): string {
  const label = full ? "Full stock count" : "Stock count";
  return [
    `${label} due today at ${outletName}.`,
    "",
    `Please do the ${full ? "full count" : "count"} and submit it in the app before end of day.`,
  ].join("\n");
}

export function sendStockCountNudge(phone: string, outletName: string, full: boolean): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) return Promise.resolve(NOT_CONFIGURED);
  const label = full ? "Full stock count" : "Stock count";
  const v = `${label} due today at ${outletName} — please count + submit before end of day.`;
  return sendProactive(phone, TEMPLATES.nudge, composeStockCountNudge(outletName, full), v);
}

// Bad-review nudge to the on-shift team — awareness + service recovery, framed
// constructively (not blame). `lines` are the new review summaries for the outlet.
export function composeReviewNudge(outletName: string, lines: string[]): string {
  return [
    `Heads up — guest feedback just came in at ${outletName}:`,
    "",
    lines.map((l) => `- ${l}`).join("\n"),
    "",
    "Let's make the next visit right, and flag to your manager to recover this guest. Reply DONE once handled.",
  ].join("\n");
}

export function sendReviewNudge(phone: string, outletName: string, lines: string[]): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) return Promise.resolve(NOT_CONFIGURED);
  const flat = sanitizeParam(`Guest feedback at ${outletName}: ${lines.join("; ")}`);
  const v = flat.length <= 700 ? flat : flat.slice(0, 699).replace(/\s+\S*$/, "") + " …";
  return sendProactive(phone, TEMPLATES.nudge, composeReviewNudge(outletName, lines), v);
}

// Manager-facing ops digest — professional but casual, no emoji. `headline` sets
// the ask ("8 staff haven't clocked in yet"); `lines` are the specifics.
export function composeOpsDigest(headline: string, lines: string[]): string {
  return [
    headline,
    "",
    lines.map((l) => `- ${l}`).join("\n"),
    "",
    "Could you follow up with the team? Reply DONE once it's sorted. Thanks.",
  ].join("\n");
}

export function sendOpsDigest(phone: string, headline: string, lines: string[]): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) return Promise.resolve(NOT_CONFIGURED);
  const flat = sanitizeParam(`${headline}: ${lines.join("; ")}`);
  const v = flat.length <= 700 ? flat : flat.slice(0, 699).replace(/\s+\S*$/, "") + " …";
  return sendProactive(phone, TEMPLATES.nudge, composeOpsDigest(headline, lines), v);
}

// Audit nudge — DM'd to the discipline lead (barista -> Syafiq, kitchen -> Chef Bo)
// with the outlet audits + skill training they owe this week. Rides ops_pulse_audit.
export function composeAuditNudge(name: string, lines: string[]): string {
  const first = name.split(" ")[0];
  return [
    `Hi ${first}, audit progress this week — ${lines.length} still to do:`,
    "",
    lines.map((l) => `- ${l}`).join("\n"),
    "",
    "Knock these off and log each report in the app. I'll check in daily.",
  ].join("\n");
}

export function sendAuditNudge(phone: string, name: string, lines: string[]): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) return Promise.resolve(NOT_CONFIGURED);
  const flat = sanitizeParam(`${lines.length} audit${lines.length === 1 ? "" : "s"} due: ${lines.join("; ")}`);
  const v = flat.length <= 700 ? flat : flat.slice(0, 699).replace(/\s+\S*$/, "") + " …";
  return sendProactive(phone, TEMPLATES.audit, composeAuditNudge(name, lines), v);
}
