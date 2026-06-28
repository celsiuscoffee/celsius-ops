// Ops KPI Pulse runner. Orchestrates detect → route → (shadow) log / (armed)
// persist + page + escalate. See docs/design/ops-kpi-pulse-loop.md.
//
//   shadow — logs each breach it *would* page; no writes, no sends.
//   armed  — records each breach in the OpsAlert ledger (deduped), DMs every
//            recipient of its discipline one digest of their NEW items, then
//            escalates any incident sitting unacked past the SLA to the owner.

import { prisma } from "@/lib/prisma";
import { pulseMode, dailyMode, REALTIME_SIGNALS, THRESHOLDS, categoryFor, TEAM_NOTIFY_SIGNALS } from "./config";
import {
  detectPhoneCapture,
  detectChecklist,
  detectReviews,
  detectOutletAudit,
  detectSkillTraining,
  detectStockCount,
  detectReceivings,
  detectMenuSnoozed,
  detectNoClockIn,
  detectPosNotOpen,
  detectRestockNeeded,
} from "./detectors";
import { resolveRecipients, resolveOwner, resolveOutletTeam } from "./router";
import { findEscalatable, markEscalated, markSent, recordBreach } from "./ledger";
import { sendManagerDigest, sendOwnerEscalation, sendDailyDigest, sendAuditDigest } from "./sender";
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

// Run every detector (isolated — one failing can't sink the run) and flatten.
async function detectAll(now: Date): Promise<Breach[]> {
  const results = await Promise.all([
    detectPhoneCapture(now).catch(detectorFailed("phone-capture")),
    detectChecklist(now).catch(detectorFailed("checklist")),
    detectReviews(now).catch(detectorFailed("reviews")),
    detectOutletAudit(now).catch(detectorFailed("outlet-audit")),
    detectSkillTraining(now).catch(detectorFailed("skill-training")),
    detectStockCount(now).catch(detectorFailed("stock-count")),
    detectReceivings(now).catch(detectorFailed("receivings")),
    detectMenuSnoozed(now).catch(detectorFailed("menu-snoozed")),
    detectNoClockIn(now).catch(detectorFailed("no-clock-in")),
    detectPosNotOpen(now).catch(detectorFailed("pos-not-open")),
    detectRestockNeeded(now).catch(detectorFailed("restock-needed")),
  ]);
  return results.flat();
}

// Attach each breach's recipients: the discipline lead(s) (cached per routeKey)
// plus — for team-work signals like stock take — the on-shift outlet team.
async function routeAll(breaches: Breach[], now: Date): Promise<RoutedBreach[]> {
  const recipientsByRoute = new Map<string, Assignee[]>();
  const teamByOutlet = new Map<string, Assignee[]>();
  const routed: RoutedBreach[] = [];
  for (const b of breaches) {
    if (!recipientsByRoute.has(b.routeKey)) {
      recipientsByRoute.set(b.routeKey, await resolveRecipients(b.routeKey));
    }
    const assignees: Assignee[] = [...(recipientsByRoute.get(b.routeKey) ?? [])];
    if (TEAM_NOTIFY_SIGNALS.has(b.signal) && b.outletId) {
      if (!teamByOutlet.has(b.outletId)) {
        teamByOutlet.set(b.outletId, await resolveOutletTeam(b.outletId, now));
      }
      const seen = new Set(assignees.map((a) => a.userId || a.phone));
      for (const t of teamByOutlet.get(b.outletId) ?? []) {
        const k = t.userId || t.phone;
        if (k && !seen.has(k)) {
          assignees.push(t);
          seen.add(k);
        }
      }
    }
    routed.push({ ...b, assignees });
  }
  return routed;
}

function maskRouted(routed: RoutedBreach[]): RoutedBreach[] {
  return routed.map((r) => ({ ...r, assignees: r.assignees.map((a) => ({ ...a, phone: maskPhone(a.phone) })) }));
}

export async function runOpsPulse(now = new Date()): Promise<PulseRunResult> {
  const mode = pulseMode();
  if (mode === "off") {
    return { mode, ranAt: now.toISOString(), breachCount: 0, routed: [], sent: 0, escalated: 0 };
  }

  // Real-time tier only — the fast pulse alerts on the instant signals (reviews,
  // menu-snoozed, …); everything else surfaces in the daily digest.
  const breaches = (await detectAll(now)).filter((b) => REALTIME_SIGNALS.has(b.signal));
  const routed = await routeAll(breaches, now);

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
    return { mode, ranAt: now.toISOString(), breachCount: breaches.length, routed: maskRouted(routed), sent: 0, escalated: 0 };
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

  // Escalation sweep — unacked incidents + audits/skill past SLA go to the owner,
  // tagged with the responsible lead so the owner sees WHO isn't getting it done.
  let escalated = 0;
  const due = await findEscalatable(THRESHOLDS.escalation.slaMinutes, now);
  if (due.length > 0) {
    const owner = await resolveOwner();
    if (owner?.phone) {
      const leadIds = [...new Set(due.map((a) => a.assigneeUserId).filter((x): x is string => !!x))];
      const leadName = new Map<string, string>();
      if (leadIds.length > 0) {
        const leads = await prisma.user.findMany({ where: { id: { in: leadIds } }, select: { id: true, name: true } });
        for (const l of leads) leadName.set(l.id, l.name);
      }
      const lines = due.map((a) => {
        const n = a.assigneeUserId ? leadName.get(a.assigneeUserId) : undefined;
        return n ? `${a.summary} — lead: ${n}` : a.summary;
      });
      const res = await sendOwnerEscalation(owner.phone, lines);
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

  return { mode, ranAt: now.toISOString(), breachCount: breaches.length, routed: maskRouted(routed), sent, escalated };
}

// Daily pulse — once a day, one digest per recipient of EVERYTHING currently
// outstanding in their lane (full snapshot, not just new items). No ledger, no
// escalation; the predictable daily cadence is the point — it builds the
// discipline. Controlled independently by OPS_PULSE_DAILY_MODE, so the daily
// digest can go live while the real-time path stays in shadow.
export async function runDailyPulse(now = new Date()): Promise<PulseRunResult> {
  const mode = dailyMode();
  if (mode === "off") {
    return { mode, ranAt: now.toISOString(), breachCount: 0, routed: [], sent: 0, escalated: 0 };
  }

  // Daily carries ROUTINE items only — the scheduled-discipline snapshot. Adhoc
  // event signals (reviews, 86'd items, receiving disputes) are trigger-based:
  // they fire on the real-time pulse the moment they happen, so re-listing them
  // a day later would just double-page. Excluded here by category.
  //
  // Clock-in, stock count, and audit are now owned by the dedicated ops-nudges
  // loops (which DM staff + the lead). Excluded here so the daily digest doesn't
  // double-ping the leads. The daily pulse keeps its unique routine signals
  // (checklist, POS-open, phone capture, restock).
  const NUDGE_OWNED = new Set(["NO_CLOCK_IN", "STOCK_COUNT", "AUDIT"]);
  const breaches = (await detectAll(now)).filter(
    (b) => categoryFor(b.signal) === "routine" && !NUDGE_OWNED.has(b.signal),
  );
  const routed = await routeAll(breaches, now);

  // Group routine items by recipient, splitting AUDIT (its own template for the
  // discipline leads — Syafiq/barista, Chef Bo/kitchen) from the ops routine digest.
  const byUser = new Map<string, { phone: string | null; name: string; routine: string[]; audit: string[] }>();
  for (const r of routed) {
    const isAudit = r.signal === "AUDIT";
    for (const a of r.assignees) {
      const key = a.userId || a.phone || a.name;
      const bucket = byUser.get(key) ?? { phone: a.phone, name: a.name, routine: [], audit: [] };
      (isAudit ? bucket.audit : bucket.routine).push(r.summary);
      byUser.set(key, bucket);
    }
  }

  if (mode === "shadow") {
    for (const [, b] of byUser) {
      console.log(
        "[ops-pulse:daily:shadow]",
        JSON.stringify({ to: b.name, phone: maskPhone(b.phone), routine: b.routine, audit: b.audit }),
      );
    }
    return { mode, ranAt: now.toISOString(), breachCount: breaches.length, routed: maskRouted(routed), sent: 0, escalated: 0 };
  }

  // ARMED: per recipient — the ops routine digest and/or their audit digest.
  let sent = 0;
  for (const [key, b] of byUser) {
    if (!b.phone) {
      console.warn(`[ops-pulse:daily] items for ${b.name} (${key}) but no phone on file — not sent`);
      continue;
    }
    if (b.routine.length) {
      const res = await sendDailyDigest(b.phone, b.routine, []);
      if (res.ok) sent += 1;
      else console.error(`[ops-pulse:daily] digest to ${b.name} failed:`, res.error);
    }
    if (b.audit.length) {
      const res = await sendAuditDigest(b.phone, b.audit);
      if (res.ok) sent += 1;
      else console.error(`[ops-pulse:daily] audit to ${b.name} failed:`, res.error);
    }
  }
  return { mode, ranAt: now.toISOString(), breachCount: breaches.length, routed: maskRouted(routed), sent, escalated: 0 };
}
