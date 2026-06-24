// Ops KPI Pulse runner. Orchestrates detect → route → (shadow) log / (armed)
// persist + page + escalate. See docs/design/ops-kpi-pulse-loop.md.
//
//   shadow — logs each breach it *would* page; no writes, no sends.
//   armed  — records each breach in the OpsAlert ledger (deduped), DMs the
//            accountable manager one digest of their NEW items, then escalates
//            any incident sitting unacked past the SLA to the owner.

import { pulseMode, THRESHOLDS } from "./config";
import {
  detectPhoneCapture,
  detectChecklist,
  detectReviews,
  detectOutletAudit,
  detectSkillTraining,
} from "./detectors";
import { resolveAssignee, resolveOwner } from "./router";
import { findEscalatable, markEscalated, markSent, recordBreach } from "./ledger";
import { sendManagerDigest, sendOwnerEscalation } from "./sender";
import type { Assignee, Breach, PulseRunResult, RoutedBreach } from "./types";

// Last-4 only — shadow output goes to plaintext logs / cron responses, so never
// emit a full number there.
function maskPhone(p: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/[^0-9]/g, "");
  return d.length <= 4 ? "****" : `••••${d.slice(-4)}`;
}

function detectorFailed(name: string) {
  return (err: unknown) => {
    console.error(`[ops-pulse] ${name} detector failed:`, err);
    return [] as Breach[];
  };
}

export async function runOpsPulse(now = new Date()): Promise<PulseRunResult> {
  const mode = pulseMode();
  if (mode === "off") {
    return { mode, ranAt: now.toISOString(), breachCount: 0, routed: [], sent: 0, escalated: 0 };
  }

  // Detectors are isolated: one failing must not sink the run.
  const [phone, checklist, reviews, outletAudit, skill] = await Promise.all([
    detectPhoneCapture(now).catch(detectorFailed("phone-capture")),
    detectChecklist(now).catch(detectorFailed("checklist")),
    detectReviews(now).catch(detectorFailed("reviews")),
    detectOutletAudit(now).catch(detectorFailed("outlet-audit")),
    detectSkillTraining(now).catch(detectorFailed("skill-training")),
  ]);
  const breaches: Breach[] = [...phone, ...checklist, ...reviews, ...outletAudit, ...skill];

  // Resolve the accountable assignee once per outlet.
  const assigneeByOutlet = new Map<string, Assignee | null>();
  const routed: RoutedBreach[] = [];
  for (const b of breaches) {
    if (!assigneeByOutlet.has(b.outletId)) {
      assigneeByOutlet.set(b.outletId, await resolveAssignee(b.outletId));
    }
    routed.push({ ...b, assignee: assigneeByOutlet.get(b.outletId) ?? null });
  }

  const maskedRouted = (): RoutedBreach[] =>
    routed.map((r) => ({ ...r, assignee: r.assignee ? { ...r.assignee, phone: maskPhone(r.assignee.phone) } : null }));

  // ── SHADOW: log what we *would* page; never message anyone, never persist. ──
  if (mode === "shadow") {
    for (const r of routed) {
      console.log(
        "[ops-pulse:shadow]",
        JSON.stringify({
          signal: r.signal,
          severity: r.severity,
          outlet: r.outletName,
          wouldNotify: r.assignee
            ? { name: r.assignee.name, phone: maskPhone(r.assignee.phone), fallbackToOwner: r.assignee.fallback }
            : null,
          summary: r.summary,
        }),
      );
    }
    return { mode, ranAt: now.toISOString(), breachCount: breaches.length, routed: maskedRouted(), sent: 0, escalated: 0 };
  }

  // ── ARMED: persist + page new alerts + escalate stale ones. ──
  // Record every breach (dedupe in the ledger); bucket the NEW ones per assignee.
  const newByUser = new Map<string, { phone: string | null; name: string; lines: string[]; alertIds: string[] }>();
  for (const r of routed) {
    const { alert, isNew } = await recordBreach(r, r.assignee);
    if (!isNew) continue;
    const key = r.assignee?.userId ?? "__unrouted__";
    const bucket = newByUser.get(key) ?? {
      phone: r.assignee?.phone ?? null,
      name: r.assignee?.name ?? "unrouted",
      lines: [],
      alertIds: [],
    };
    bucket.lines.push(r.summary);
    bucket.alertIds.push(alert.id);
    newByUser.set(key, bucket);
  }

  let sent = 0;
  for (const [key, bucket] of newByUser) {
    if (!bucket.phone) {
      console.warn(`[ops-pulse] ${bucket.alertIds.length} new alert(s) for ${key} but no phone on file — not sent`);
      continue;
    }
    const res = await sendManagerDigest(bucket.phone, bucket.lines);
    // Mark sent even on failure so the escalation timer starts; a failed send is
    // surfaced via the log and the alert simply stays OPEN to escalate.
    for (const id of bucket.alertIds) await markSent(id, res.ok ? res.messageId ?? null : null);
    if (res.ok) sent += 1;
    else console.error(`[ops-pulse] manager digest to ${bucket.name} failed:`, res.error);
  }

  // Escalation sweep — incidents unacked past SLA go to the owner, batched.
  let escalated = 0;
  const due = await findEscalatable(THRESHOLDS.escalation.slaMinutes, now);
  if (due.length > 0) {
    const owner = await resolveOwner();
    if (owner?.phone) {
      const res = await sendOwnerEscalation(owner.phone, due.map((a) => a.summary));
      if (res.ok) {
        for (const a of due) {
          await markEscalated(a.id);
          escalated += 1;
        }
      } else {
        console.error("[ops-pulse] owner escalation failed:", res.error);
      }
    } else {
      console.warn(`[ops-pulse] ${due.length} alert(s) due for escalation but no owner phone on file`);
    }
  }

  return { mode, ranAt: now.toISOString(), breachCount: breaches.length, routed: maskedRouted(), sent, escalated };
}
