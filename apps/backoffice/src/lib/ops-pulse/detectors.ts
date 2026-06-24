// Ops Pulse detectors. Each returns the Breaches it found; pure read, no writes.
//
// Phase 1 signals:
//   • PHONE_CAPTURE — % of today's completed POS sales that captured a customer
//     phone, per outlet, below the floor. Phone is the join key for every
//     loyalty/marketing loop, so an uncaptured sale is a customer lost to them.
//   • CHECKLIST     — a scheduled checklist still PENDING/IN_PROGRESS past its
//     dueAt + grace window, at an active outlet.

import { prisma } from "@/lib/prisma";
import { THRESHOLDS } from "./config";
import type { Breach } from "./types";

// Today's MYT (UTC+8) calendar date + the UTC instant of its 00:00. pos_orders
// store created_at as a timestamp; this mirrors the EOD ingestor's day boundary.
function mytToday(now: Date): { ymd: string; dayStart: Date } {
  const ymd = new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
  return { ymd, dayStart: new Date(`${ymd}T00:00:00+08:00`) };
}

// pos_orders.outlet_id is the loyalty outlet id, so we join through
// Outlet.loyaltyOutletId rather than Outlet.id.
export async function detectPhoneCapture(now: Date): Promise<Breach[]> {
  const { ymd, dayStart } = mytToday(now);

  const rows = await prisma.$queryRaw<
    Array<{ outlet_id: string | null; total: number; with_phone: number }>
  >`
    SELECT outlet_id,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (
             WHERE customer_phone IS NOT NULL AND length(trim(customer_phone)) > 0
           )::int AS with_phone
    FROM pos_orders
    WHERE status = 'completed'
      AND refund_of_order_id IS NULL
      AND created_at >= ${dayStart}
    GROUP BY outlet_id
  `;
  if (rows.length === 0) return [];

  const loyaltyIds = rows.map((r) => r.outlet_id).filter((x): x is string => !!x);
  if (loyaltyIds.length === 0) return [];

  const outlets = await prisma.outlet.findMany({
    where: { loyaltyOutletId: { in: loyaltyIds }, status: "ACTIVE" },
    select: { id: true, name: true, loyaltyOutletId: true },
  });
  const byLoyalty = new Map<string, (typeof outlets)[number]>();
  for (const o of outlets) byLoyalty.set(o.loyaltyOutletId as string, o);

  const { floorPct, minOrders } = THRESHOLDS.phoneCapture;
  const breaches: Breach[] = [];
  for (const r of rows) {
    const outlet = r.outlet_id ? byLoyalty.get(r.outlet_id) : undefined;
    if (!outlet) continue; // unmapped or inactive outlet
    if (r.total < minOrders) continue; // sample too small to judge
    const pct = Math.round((r.with_phone / r.total) * 100);
    if (pct >= floorPct) continue;

    breaches.push({
      signal: "PHONE_CAPTURE",
      outletId: outlet.id,
      outletName: outlet.name,
      severity: "MED",
      dedupeKey: `PHONE_CAPTURE:${outlet.id}:${ymd}`,
      summary: `Phone capture ${pct}% today (${r.with_phone}/${r.total} sales) — below ${floorPct}% floor`,
      detail: { pct, withPhone: r.with_phone, total: r.total, floorPct, date: ymd },
    });
  }
  return breaches;
}

// A scheduled checklist with an explicit dueAt that is still not done, more than
// graceMinutes past due, at an active outlet. (Shift-only checklists with no
// dueAt aren't paged here — that needs shift-end resolution; a Phase 2 refinement.)
export async function detectChecklist(now: Date): Promise<Breach[]> {
  const cutoff = new Date(now.getTime() - THRESHOLDS.checklist.graceMinutes * 60_000);

  const overdue = await prisma.checklist.findMany({
    where: {
      status: { in: ["PENDING", "IN_PROGRESS"] },
      dueAt: { not: null, lt: cutoff },
    },
    select: {
      id: true,
      outletId: true,
      dueAt: true,
      shift: true,
      outlet: { select: { name: true, status: true } },
      sop: { select: { title: true } },
    },
    orderBy: { dueAt: "asc" },
    take: 200, // safety cap; a backlog this deep is itself the alert
  });

  const breaches: Breach[] = [];
  for (const c of overdue) {
    if (c.outlet.status !== "ACTIVE") continue;
    const dueAt = c.dueAt as Date;
    const overdueMinutes = Math.round((now.getTime() - dueAt.getTime()) / 60_000);
    breaches.push({
      signal: "CHECKLIST",
      outletId: c.outletId,
      outletName: c.outlet.name,
      // An unopened opening checklist (prep/food-safety) is the high-stakes case.
      severity: c.shift === "OPENING" ? "HIGH" : "MED",
      dedupeKey: `CHECKLIST:${c.id}`, // each instance is unique
      summary: `${c.sop.title} (${c.shift.toLowerCase()}) overdue ${overdueMinutes}m — ${c.outlet.name}`,
      detail: {
        checklistId: c.id,
        sopTitle: c.sop.title,
        shift: c.shift,
        dueAt: dueAt.toISOString(),
        overdueMinutes,
      },
    });
  }
  return breaches;
}

// Trim a free-text review to a one-line preview for the digest.
function clip(s: string | null | undefined, n = 60): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

// Bad reviews still needing attention. Two sources, both reused from the live
// reviews module rather than re-detected:
//   • InternalFeedback — QR-gate feedback (already 1–3★); page the ≤2★ that are
//     still "open".
//   • ReviewReplyDraft — negative (1–3★) Google reviews still "pending" a reply.
// Bounded to the recency window so arming doesn't burst on historical backlog;
// the ledger then dedupes each review to a single page.
export async function detectReviews(now: Date): Promise<Breach[]> {
  const { internalMaxRating, googleMaxRating, recencyHours } = THRESHOLDS.review;
  const since = new Date(now.getTime() - recencyHours * 3_600_000);
  const breaches: Breach[] = [];

  const feedback = await prisma.internalFeedback.findMany({
    where: {
      status: "open",
      rating: { lte: internalMaxRating },
      createdAt: { gte: since },
    },
    select: {
      id: true,
      outletId: true,
      rating: true,
      feedback: true,
      outlet: { select: { name: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  for (const f of feedback) {
    if (f.outlet.status !== "ACTIVE") continue;
    breaches.push({
      signal: "REVIEW",
      outletId: f.outletId,
      outletName: f.outlet.name,
      severity: f.rating <= 1 ? "HIGH" : "MED",
      dedupeKey: `REVIEW:IF:${f.id}`,
      summary: `${f.rating}★ feedback — ${f.outlet.name}: "${clip(f.feedback)}"`,
      detail: { source: "internal_feedback", feedbackId: f.id, rating: f.rating },
    });
  }

  const drafts = await prisma.reviewReplyDraft.findMany({
    where: {
      status: "pending",
      rating: { lte: googleMaxRating },
      createdAt: { gte: since },
    },
    select: {
      id: true,
      outletId: true,
      rating: true,
      comment: true,
      outlet: { select: { name: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  for (const d of drafts) {
    if (d.outlet.status !== "ACTIVE") continue;
    breaches.push({
      signal: "REVIEW",
      outletId: d.outletId,
      outletName: d.outlet.name,
      severity: d.rating <= 1 ? "HIGH" : "MED",
      dedupeKey: `REVIEW:GBP:${d.id}`,
      summary: `${d.rating}★ Google review awaiting reply — ${d.outlet.name}: "${clip(d.comment)}"`,
      detail: { source: "google_review", draftId: d.id, rating: d.rating },
    });
  }

  return breaches;
}
