// Internal bug/problem intake over WhatsApp (verifier-agent thread, Approach A).
//
// Owners/admins/managers already live on the business number (nudges, DONE
// replies) — this makes it a two-way channel for SYSTEM problems: "POS tak boleh
// print", a screenshot of a broken page, etc. Today every such report routes
// through Ammar by hand (manager → owner WhatsApp → screenshot into Claude Code).
// This files it directly instead:
//
//   internal sender → SystemReport row (+ media) → ack the reporter (free, their
//   message opened the 24h window) → one digest line to the owner.
//
// The queue is worked from Claude Code ("work the bug queue") — no UI in v1.
// Deliberately NOT an LLM agent: intake is deterministic (store + ack + notify);
// classification/triage is a later rung on the trust ladder.
//
// Multi-message reports (text, then a screenshot 30s later) APPEND to the same
// OPEN report within a 15-min window instead of filing duplicates; appends are
// silent (no second ack, no second owner ping).

import { prisma } from "@/lib/prisma";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { recordOutboundMessage } from "@/lib/whatsapp-store";
import { sendOpsDigest } from "@/lib/ops-pulse/sender";
import { resolveOwner } from "@/lib/ops-pulse/router";
import { samePhone, ACK_SOFT } from "@/lib/ops-pulse/inbound";
import { runInternalAssistant, assistantEnabled } from "./assistant";

export const OPS_INTAKE_VERSION = "ops-intake-v1";

const digits = (s: string) => s.replace(/[^0-9]/g, "");

// Who may file: the internal tier. STAFF deliberately excluded in v1 — their
// path stays "tell your manager" until intake noise is understood.
const INTAKE_ROLES = ["OWNER", "ADMIN", "MANAGER"] as const;
// A follow-up from the same reporter lands on their still-OPEN report this long
// after the last update (text → screenshot arrives as separate webhook events).
const APPEND_WINDOW_MS = 15 * 60_000;

export interface InternalInboundInput {
  fromNumber: string;
  text: string | null;
  mediaUrl: string | null;
  waMessageId: string;
  type: string; // text | image | document | ...
  consumedByAck: boolean; // an ops ack handler already actioned this message
}

export interface InternalInboundResult {
  internal: boolean; // sender is owner/admin/manager → skip supplier flows
  filed: boolean; // a SystemReport was created or appended
  answered?: boolean; // the Q&A assistant replied instead of filing
  reportId?: string;
}

const NOT_INTERNAL: InternalInboundResult = { internal: false, filed: false };

/**
 * Route an inbound WhatsApp message from an INTERNAL phone into the report queue.
 * Returns { internal: false } for non-internal senders so the webhook falls
 * through to the supplier flows. Never throws — the webhook must 200 fast.
 */
export async function handleInternalInbound(input: InternalInboundInput): Promise<InternalInboundResult> {
  // Identify the sender first, in its own guard: a lookup failure must fall
  // through as NOT internal (so a real supplier still reaches the agent),
  // whereas a failure AFTER a match must stay internal (so the supplier agent
  // never replies to a manager).
  let reporter:
    | { id: string; name: string; phone: string | null; role: string; outletId: string | null; outletIds: string[] }
    | undefined;
  try {
    const users = await prisma.user.findMany({
      where: { role: { in: [...INTAKE_ROLES] }, status: "ACTIVE", phone: { not: null } },
      select: { id: true, name: true, phone: true, role: true, outletId: true, outletIds: true },
    });
    reporter = users.find((u) => u.phone && samePhone(input.fromNumber, u.phone));
  } catch (err) {
    console.error("[ops-intake] reporter lookup failed:", err instanceof Error ? err.message : err);
    return NOT_INTERNAL;
  }
  if (!reporter) return NOT_INTERNAL;

  try {
    const body = (input.text ?? "").trim();

    // A digest reply ("DONE", "ok siap") was already consumed by the ack
    // handlers — never double-file it as a bug report.
    if (input.consumedByAck) return { internal: true, filed: false };

    // Only the types the media pipeline handles; a sticker/voice note is not a
    // usable report on its own.
    if (!["text", "image", "document"].includes(input.type)) return { internal: true, filed: false };

    // Noise gate for bare text: too short to mean anything, or a stray
    // ack/thanks that matched no open items ("ok 👍"). Media always passes —
    // a lone screenshot IS a report.
    if (!input.mediaUrl && (body.length < 4 || (ACK_SOFT.test(body) && body.length <= 30))) {
      return { internal: true, filed: false };
    }

    // Append to the reporter's still-fresh OPEN report, if any (multi-message
    // reports: text now, screenshot in a moment). Silent — one ack per report.
    const recent = await prisma.systemReport.findFirst({
      where: {
        reporterUserId: reporter.id,
        status: "OPEN",
        updatedAt: { gte: new Date(Date.now() - APPEND_WINDOW_MS) },
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, body: true, mediaUrls: true, waMessageIds: true },
    });
    if (recent) {
      await prisma.systemReport.update({
        where: { id: recent.id },
        data: {
          body: body ? (recent.body ? `${recent.body}\n${body}` : body) : recent.body,
          mediaUrls: input.mediaUrl ? [...recent.mediaUrls, input.mediaUrl] : undefined,
          waMessageIds: [...recent.waMessageIds, input.waMessageId],
        },
      });
      return { internal: true, filed: true, reportId: recent.id };
    }

    // Q&A assistant (Approach B): a bare text message may be a QUESTION, not a
    // report — let the assistant answer it from the read-only toolset. It calls
    // file_bug_report (→ "report") when it judges the message a problem report,
    // and any failure falls through to filing, so a broken assistant can never
    // swallow a bug report. Media messages skip straight to filing — a
    // screenshot is a report.
    if (!input.mediaUrl && assistantEnabled()) {
      const history = await prisma.whatsAppMessage.findMany({
        where: { OR: [{ fromNumber: digits(input.fromNumber) }, { toNumber: digits(input.fromNumber) }] },
        orderBy: { timestamp: "desc" },
        take: 12,
        select: { direction: true, body: true },
      });
      const outcome = await runInternalAssistant({
        reporter: {
          id: reporter.id,
          name: reporter.name,
          role: reporter.role,
          outletId: reporter.outletId,
          outletIds: reporter.outletIds,
        },
        text: body,
        history: history.reverse(),
      });
      if (outcome.kind === "reply") {
        const sent = await sendWhatsAppText(input.fromNumber, outcome.text);
        await recordOutboundMessage({
          waMessageId: sent.messageId,
          fromNumber: "",
          toNumber: input.fromNumber,
          type: "text",
          body: outcome.text,
          status: sent.ok ? "sent" : "failed",
          raw: { agent: OPS_INTAKE_VERSION, assistant: true, ok: sent.ok, error: sent.error ?? null },
        });
        console.log(`[ops-intake] answered question from=${reporter.name} sent=${sent.ok}`);
        return { internal: true, filed: false, answered: true };
      }
      // "report" or "none" → file it below.
    }

    const report = await prisma.systemReport.create({
      data: {
        reporterUserId: reporter.id,
        reporterName: reporter.name,
        reporterPhone: input.fromNumber,
        outletId: reporter.outletId,
        body,
        mediaUrls: input.mediaUrl ? [input.mediaUrl] : [],
        waMessageIds: [input.waMessageId],
      },
      select: { id: true },
    });
    const ref = report.id.slice(0, 8);

    // Ack the reporter — their message just opened the 24h window, so this is a
    // free in-window text. Recorded with an agent marker so the human-takeover
    // heuristic never mistakes it for a human inbox reply.
    const first = (reporter.name || "there").trim().split(/\s+/)[0];
    const ack = `Got it ${first} 🙏 Logged for the tech team (ref ${ref}). Send more screenshots or details here anytime.`;
    const sent = await sendWhatsAppText(input.fromNumber, ack);
    await recordOutboundMessage({
      waMessageId: sent.messageId,
      fromNumber: "",
      toNumber: input.fromNumber,
      type: "text",
      body: ack,
      status: sent.ok ? "sent" : "failed",
      raw: { agent: OPS_INTAKE_VERSION, systemReportFor: report.id, ok: sent.ok, error: sent.error ?? null },
    });

    // One line to the owner (unless the owner filed it themselves).
    if (reporter.role !== "OWNER") {
      const owner = await resolveOwner();
      if (owner?.phone) {
        const line = `${reporter.name}: ${body ? body.slice(0, 150) : "(screenshot)"}${input.mediaUrl ? " 📎" : ""}`;
        await sendOpsDigest(owner.phone, "🐞 New system report", [line]);
      }
    }

    console.log(`[ops-intake] filed report=${report.id} from=${reporter.name} media=${!!input.mediaUrl}`);
    return { internal: true, filed: true, reportId: report.id };
  } catch (err) {
    console.error("[ops-intake] failed:", err instanceof Error ? err.message : err);
    // The sender IS internal (matched above) — even on failure, never let the
    // supplier agent reply to a manager's number.
    return { internal: true, filed: false };
  }
}

// ── Close the loop: tell the reporter when their report is fixed ──────────────
// Reports are worked from Claude Code, which flips status → RESOLVED (+
// resolution) straight in the DB — it has no way to send WhatsApp from a dev
// session. This cron-driven pass notices unnotified resolutions and messages
// the reporter: free in-window text first, ops template as the cold fallback.
// Stamps reporterNotifiedAt only on a successful send, so failures retry next
// run (the template path makes permanent failure effectively unreachable).
export async function notifyResolvedReports(): Promise<{ notified: number; failed: number }> {
  let notified = 0;
  let failed = 0;
  const due = await prisma.systemReport.findMany({
    where: { status: "RESOLVED", reporterNotifiedAt: null },
    orderBy: { resolvedAt: "asc" },
    take: 20,
    select: { id: true, reporterName: true, reporterPhone: true, resolution: true },
  });
  for (const r of due) {
    try {
      // Telegram-filed reports may carry a "telegram:<chatId>" pseudo-phone —
      // nothing to WhatsApp; stamp it so it doesn't retry forever (the owner
      // sees resolutions in the queue anyway).
      if (digits(r.reporterPhone).length < 8) {
        await prisma.systemReport.update({ where: { id: r.id }, data: { reporterNotifiedAt: new Date() } });
        continue;
      }
      const first = (r.reporterName || "there").trim().split(/\s+/)[0];
      const ref = r.id.slice(0, 8);
      const text = `✅ ${first}, your report (ref ${ref}) is fixed${r.resolution ? ` — ${r.resolution}` : ""}. Thanks for flagging it 🙏`;
      let ok = false;
      const free = await sendWhatsAppText(r.reporterPhone, text);
      if (free.ok) {
        ok = true;
        await recordOutboundMessage({
          waMessageId: free.messageId,
          fromNumber: "",
          toNumber: r.reporterPhone,
          type: "text",
          body: text,
          status: "sent",
          raw: { agent: OPS_INTAKE_VERSION, resolutionNotifyFor: r.id },
        });
      } else {
        // 24h window closed → template path (sender records its own row).
        const tpl = await sendOpsDigest(r.reporterPhone, "✅ Your system report is fixed", [text]);
        ok = tpl.ok;
      }
      if (ok) {
        await prisma.systemReport.update({ where: { id: r.id }, data: { reporterNotifiedAt: new Date() } });
        notified += 1;
      } else {
        failed += 1;
      }
    } catch (err) {
      failed += 1;
      console.error(`[ops-intake] resolution notify failed for ${r.id}:`, err instanceof Error ? err.message : err);
    }
  }
  if (due.length) console.log(`[ops-intake] resolution notify: ${notified} sent, ${failed} failed`);
  return { notified, failed };
}
