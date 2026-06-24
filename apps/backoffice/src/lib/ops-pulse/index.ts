// Ops KPI Pulse runner. Orchestrates detect → route → (shadow) log / (armed)
// persist + page + escalate. See docs/design/ops-kpi-pulse-loop.md.
//
//   shadow — logs each breach it *would* page; no writes, no sends.
//   armed  — records each breach in the OpsAlert ledger (deduped), DMs every
//            recipient of its discipline one digest of their NEW items, then
//            escalates any incident sitting unacked past the SLA to the owner.

import { pulseMode, THRESHOLDS } from "./config";
import {
  detectPhoneCapture,
  detectChecklist,
  detectReviews,
  detectOutletAudit,
  detectSkillTraining,
  detectStockCount,
  detectReceivings,
  detectMenuSnoozed,
} from "./detectors";
import { resolveRecipients, resolveOwner } from "./router";
import { findEscalatable, markEscalated, markSent, recordBreach } from "./ledger";
import { sendManagerDigest, sendOwnerEscalation } from "./sender";
import type { Assignee, Breach, PulseRunResult, RoutedBreach } from "./types";

// Last-4 only — shadow output goes to plaintext logs / cron responses.
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
  const results = await Promise.all([
    detectPhoneCapture(now).catch(detectorFailed("phone-capture")),
    detectChecklist(now).catch(detectorFailed("checklist")),
    detectReviews(now).catch(detectorFailed("reviews")),
    detectOutletAudit(now).catch(detectorFailed("outlet-audit")),
    detectSkillTraining(now).catch(detectorFailed("skill-training")),
    detectStockCount(now).catch(detectorFailed("stock-count")),
    detectReceivings(now).catch(detectorFailed("receivings")),
    detectMenuSnoozed(now).catch(detectorFailed("menu-snoozed")),
  ]);
  const breaches: Breach[] = results.flat();

  // Resolve recipients once per discipline (routeKey).
  const recipientsByRoute = new Map<string, Assignee[]>();
  const routed: RoutedBreach[] = [];
  for (const b of breaches) {
    if (!recipientsByRoute.has(b.routeKey)) {
      recipientsByRoute.set(b.routeKey, await resolveRecipients(b.routeKey));
    }
    routed.push({ ...b, assignees: recipientsByRoute.get(b.routeKey) ?? [] });
  }

  const maskedRouted = (): RoutedBreach[] =>
    routed.map((r) => ({ ...r, assignees: r.assignees.map((a) => ({ ...a, phone: maskPhone(a.phone) })) }));

  // ── SHADOW: log what we *would* page; never message anyone, never persist. ──
  if (mode === "shadow") {
    for (const r of routed) {
      console.log(
        "[ops-pulse:shadow]",
        JSON.stringify({
          signal: r.signal,
          severity: r.severity,
          route: r.routeKey,
          outlet: r.outletName,
          wouldNotify: r.assignees.map((a) => ({ name: a.name, phone: maskPhone(a.phone), fallbackToOwner: a.fallback })),
          summary: r.summary,
        }),
      );
    }
    return { mode, ranAt: now.toISOString(), breachCount: breaches.length, routed: maskedRouted(), sent: 0, escalated: 0 };
  }

  // ── ARMED: persist + page new alerts + escalate stale ones. ──
  // Record every breach (dedupe in the ledger); primary = first recipient owns
  // the row's ack/escalation. Bucket each NEW breach into every recipient's digest.
  const newAlertIds = new Set<string>();
  const digestByUser = new Map<string, { phone: string | null; name: string; lines: string[] }>();
  for (const r of routed) {
    const primary = r.assignees[0] ?? null;
    const { alert, isNew } = await recordBreach(r, primary);
    if (!isNew) continue;
    newAlertIds.add(alert.id);
    for (const a of r.assignees) {
      // Phone-only recipients have no userId; key the digest by phone/name instead.
      const key = a.userId || a.phone || a.name;
      const bucket = digestByUser.get(key) ?? { phone: a.phone, name: a.name, lines: [] };
      bucket.lines.push(r.summary);
      digestByUser.set(key, bucket);
    }
  }

  let sent = 0;
  for (const [userId, bucket] of digestByUser) {
    if (!bucket.phone) {
      console.warn(`[ops-pulse] new alert(s) for ${bucket.name} (${userId}) but no phone on file — not sent`);
      continue;
    }
    const res = await sendManagerDigest(bucket.phone, bucket.lines);
    if (res.ok) sent += 1;
    else console.error(`[ops-pulse] digest to ${bucket.name} failed:`, res.error);
  }
  // Start the escalation timer on every new alert regardless of per-recipient
  // send success — a failed send is logged and the alert stays OPEN to escalate.
  for (const id of newAlertIds) await markSent(id, null);

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
