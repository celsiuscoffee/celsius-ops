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

export const OPS_INTAKE_VERSION = "ops-intake-v1";

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
  let reporter: { id: string; name: string; phone: string | null; role: string; outletId: string | null } | undefined;
  try {
    const users = await prisma.user.findMany({
      where: { role: { in: [...INTAKE_ROLES] }, status: "ACTIVE", phone: { not: null } },
      select: { id: true, name: true, phone: true, role: true, outletId: true },
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
