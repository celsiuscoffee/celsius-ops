// Ops Pulse detectors. Each returns the Breaches it found; pure read, no writes.
//
// Phase 1 signals:
//   • PHONE_CAPTURE — % of today's completed POS sales that captured a customer
//     phone, per outlet, below the floor. Phone is the join key for every
//     loyalty/marketing loop, so an uncaptured sale is a customer lost to them.
//   • CHECKLIST     — a scheduled checklist still PENDING/IN_PROGRESS past its
//     dueAt + grace window, at an active outlet.

import { prisma } from "@/lib/prisma";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { AUDIT, THRESHOLDS, routeForRole } from "./config";
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
      routeKey: "operations",
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
      routeKey: "operations",
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
      routeKey: "operations",
      dedupeKey: `REVIEW:IF:${f.id}`,
      summary: `${f.rating}★ feedback — ${f.outlet.name}: "${clip(f.feedback, 1000)}"`,
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
      routeKey: "operations",
      dedupeKey: `REVIEW:GBP:${d.id}`,
      summary: `${d.rating}★ Google review awaiting reply — ${d.outlet.name}: "${clip(d.comment, 1000)}"`,
      detail: { source: "google_review", draftId: d.id, rating: d.rating },
    });
  }

  return breaches;
}

// OUTLET-audit coverage gap: a tracked role's OUTLET audit (e.g. Barista Station
// Audit, Kitchen Quality Audit) with no COMPLETED report at an active outlet
// inside the cadence window (weekly). LOW severity, deduped per
// outlet/role/window, never escalated (lagging, not a now-fix-it incident). A
// role is only checked if it has an active OUTLET template. Per-staff SKILL
// audits are handled separately by detectSkillTraining.
export async function detectOutletAudit(now: Date): Promise<Breach[]> {
  if (AUDIT.roles.length === 0) return [];
  const cutoff = new Date(now.getTime() - AUDIT.cadenceDays * 86_400_000);

  const [outlets, templates] = await Promise.all([
    prisma.outlet.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true } }),
    prisma.auditTemplate.findMany({
      where: { isActive: true, auditTarget: "OUTLET", roleType: { in: AUDIT.roles } },
      select: { id: true, roleType: true },
    }),
  ]);
  if (outlets.length === 0 || templates.length === 0) return [];

  const roleByTemplate = new Map<string, string>();
  for (const t of templates) roleByTemplate.set(t.id, t.roleType);
  // Only roles that actually have an active template can be "overdue".
  const activeRoles = [...new Set(templates.map((t) => t.roleType))];

  const recent = await prisma.auditReport.findMany({
    where: {
      status: "COMPLETED",
      templateId: { in: templates.map((t) => t.id) },
      date: { gte: cutoff },
    },
    select: { outletId: true, templateId: true },
  });
  const covered = new Set<string>(); // `${outletId}::${roleType}`
  for (const r of recent) {
    const role = roleByTemplate.get(r.templateId);
    if (role) covered.add(`${r.outletId}::${role}`);
  }

  // Re-alert once per cadence window: a stable bucket index over MYT days.
  const { ymd } = mytToday(now);
  const bucket = Math.floor(
    new Date(`${ymd}T00:00:00+08:00`).getTime() / (AUDIT.cadenceDays * 86_400_000),
  );

  const breaches: Breach[] = [];
  for (const o of outlets) {
    for (const role of activeRoles) {
      if (covered.has(`${o.id}::${role}`)) continue;
      breaches.push({
        signal: "AUDIT",
        outletId: o.id,
        outletName: o.name,
        severity: "LOW",
        routeKey: routeForRole(role),
        dedupeKey: `AUDIT:${role}:${o.id}:${bucket}`,
        summary: `No ${role} audit at ${o.name} in ${AUDIT.cadenceDays}d`,
        detail: { role, cadenceDays: AUDIT.cadenceDays },
      });
    }
  }
  return breaches;
}

// SKILL-audit (training) coverage: for each STAFF skill template, how many
// eligible staff (by HR position) at an outlet have a COMPLETED skill audit
// vs. how many should. The number trained is the metric. Cross-DB: positions
// live in hr_employee_profiles (HR Supabase), staff→outlet + reports in Prisma.
// "Trained" means skill-audited WITHIN the cadence window — skill = 1/week/staff,
// so each eligible staff needs a fresh skill audit every week (not just ever).
// LOW severity, never escalated — a scorecard/coaching number.
export async function detectSkillTraining(now: Date): Promise<Breach[]> {
  if (AUDIT.roles.length === 0) return [];

  const templates = await prisma.auditTemplate.findMany({
    where: { isActive: true, auditTarget: "STAFF", roleType: { in: AUDIT.roles } },
    select: { id: true, name: true, roleType: true, jobRoleFilter: true },
  });
  if (templates.length === 0) return [];

  // Fetch the eligible roster once: HR profiles whose position matches any tracked
  // template's jobRoleFilter.
  const positions = [...new Set(templates.flatMap((t) => t.jobRoleFilter))].filter(Boolean);
  if (positions.length === 0) return [];
  const { data: profiles, error } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, position")
    .in("position", positions);
  if (error) throw new Error(`hr_employee_profiles: ${error.message}`);

  const idsByPosition = new Map<string, Set<string>>();
  for (const p of (profiles ?? []) as Array<{ user_id: string | null; position: string | null }>) {
    if (!p.user_id || !p.position) continue;
    const set = idsByPosition.get(p.position) ?? new Set<string>();
    set.add(p.user_id);
    idsByPosition.set(p.position, set);
  }

  const { ymd } = mytToday(now);
  const cutoff = new Date(now.getTime() - AUDIT.cadenceDays * 86_400_000);
  const bucket = Math.floor(
    new Date(`${ymd}T00:00:00+08:00`).getTime() / (AUDIT.cadenceDays * 86_400_000),
  );

  const breaches: Breach[] = [];
  for (const t of templates) {
    const eligibleIds = new Set<string>();
    for (const pos of t.jobRoleFilter) for (const id of idsByPosition.get(pos) ?? []) eligibleIds.add(id);
    if (eligibleIds.size === 0) continue;
    const eligibleList = [...eligibleIds];

    const [staff, trainedRows] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: eligibleList }, status: "ACTIVE" },
        select: { id: true, outletId: true, outlet: { select: { name: true, status: true } } },
      }),
      prisma.auditReport.findMany({
        where: {
          templateId: t.id,
          status: "COMPLETED",
          auditeeId: { in: eligibleList },
          date: { gte: cutoff }, // skill = 1/week/staff → only THIS week's audits count
        },
        select: { auditeeId: true },
      }),
    ]);
    const trained = new Set(trainedRows.map((r) => r.auditeeId).filter((x): x is string => !!x));

    // Tally eligible vs trained per active outlet (staff need an outlet to route).
    const byOutlet = new Map<string, { name: string; eligible: number; trained: number }>();
    for (const s of staff) {
      if (!s.outletId || s.outlet?.status !== "ACTIVE") continue;
      const agg = byOutlet.get(s.outletId) ?? { name: s.outlet?.name ?? s.outletId, eligible: 0, trained: 0 };
      agg.eligible += 1;
      if (trained.has(s.id)) agg.trained += 1;
      byOutlet.set(s.outletId, agg);
    }

    for (const [outletId, agg] of byOutlet) {
      const untrained = agg.eligible - agg.trained;
      if (untrained <= 0) continue;
      breaches.push({
        signal: "AUDIT",
        outletId,
        outletName: agg.name,
        severity: "LOW",
        routeKey: routeForRole(t.roleType),
        dedupeKey: `SKILL:${t.roleType}:${outletId}:${bucket}`,
        summary: `${t.name}: ${agg.trained}/${agg.eligible} staff skill-audited this week — ${agg.name} (${untrained} to go)`,
        detail: {
          kind: "skill_training",
          template: t.name,
          role: t.roleType,
          cadenceDays: AUDIT.cadenceDays,
          eligible: agg.eligible,
          trained: agg.trained,
          untrained,
        },
      });
    }
  }
  return breaches;
}

// ── Procurement signals (route to operations) ────────────────

// Stock count overdue: an active outlet with no SUBMITTED/REVIEWED StockCount
// inside the cadence window. LOW severity, deduped per outlet/window.
export async function detectStockCount(now: Date): Promise<Breach[]> {
  const cadenceDays = THRESHOLDS.stockCount.cadenceDays;
  const cutoff = new Date(now.getTime() - cadenceDays * 86_400_000);

  const [outlets, recent] = await Promise.all([
    prisma.outlet.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true } }),
    prisma.stockCount.findMany({
      where: { status: { in: ["SUBMITTED", "REVIEWED"] }, countDate: { gte: cutoff } },
      select: { outletId: true },
    }),
  ]);
  const counted = new Set(recent.map((r) => r.outletId));

  const { ymd } = mytToday(now);
  const bucket = Math.floor(
    new Date(`${ymd}T00:00:00+08:00`).getTime() / (cadenceDays * 86_400_000),
  );

  const breaches: Breach[] = [];
  for (const o of outlets) {
    if (counted.has(o.id)) continue;
    breaches.push({
      signal: "STOCK_COUNT",
      outletId: o.id,
      outletName: o.name,
      severity: "LOW",
      routeKey: "operations",
      dedupeKey: `STOCK_COUNT:${o.id}:${bucket}`,
      summary: `No stock count submitted at ${o.name} in ${cadenceDays}d`,
      detail: { cadenceDays },
    });
  }
  return breaches;
}

// Receiving discrepancy: a DISPUTED/PARTIAL goods receipt in the recency window.
// DISPUTED = MED (active dispute), PARTIAL = LOW. Deduped per receiving.
export async function detectReceivings(now: Date): Promise<Breach[]> {
  const cutoff = new Date(now.getTime() - THRESHOLDS.receiving.recencyDays * 86_400_000);

  const rows = await prisma.receiving.findMany({
    where: { status: { in: ["DISPUTED", "PARTIAL"] }, receivedAt: { gte: cutoff } },
    select: {
      id: true,
      status: true,
      outletId: true,
      outlet: { select: { name: true, status: true } },
    },
    orderBy: { receivedAt: "desc" },
    take: 100,
  });

  const breaches: Breach[] = [];
  for (const r of rows) {
    if (r.outlet.status !== "ACTIVE") continue;
    breaches.push({
      signal: "RECEIVING",
      outletId: r.outletId,
      outletName: r.outlet.name,
      severity: r.status === "DISPUTED" ? "MED" : "LOW",
      routeKey: "operations",
      dedupeKey: `RECEIVING:${r.id}`,
      summary: `${r.status.toLowerCase()} goods receipt — ${r.outlet.name}`,
      detail: { receivingId: r.id, status: r.status },
    });
  }
  return breaches;
}

// Menu snoozed: items 86'd / out-of-stock at an outlet (outlet_product_availability
// in the loyalty DB; outlet_id is the pickupStoreId slug). A restock/procurement
// signal. Deduped per outlet/day (the count fluctuates).
export async function detectMenuSnoozed(now: Date): Promise<Breach[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("outlet_product_availability")
    .select("outlet_id")
    .eq("is_available", false);
  if (error) throw new Error(`outlet_product_availability: ${error.message}`);

  const countBySlug = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ outlet_id: string | null }>) {
    if (!row.outlet_id) continue;
    countBySlug.set(row.outlet_id, (countBySlug.get(row.outlet_id) ?? 0) + 1);
  }
  if (countBySlug.size === 0) return [];

  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE", pickupStoreId: { in: [...countBySlug.keys()] } },
    select: { id: true, name: true, pickupStoreId: true },
  });

  const { ymd } = mytToday(now);
  const minItems = THRESHOLDS.menuSnooze.minItems;
  const breaches: Breach[] = [];
  for (const o of outlets) {
    const n = o.pickupStoreId ? countBySlug.get(o.pickupStoreId) ?? 0 : 0;
    if (n < minItems) continue;
    breaches.push({
      signal: "MENU_SNOOZED",
      outletId: o.id,
      outletName: o.name,
      severity: "MED",
      routeKey: "operations",
      dedupeKey: `MENU_SNOOZED:${o.id}:${ymd}`,
      summary: `${n} menu item${n === 1 ? "" : "s"} snoozed (86'd) at ${o.name}`,
      detail: { snoozed: n },
    });
  }
  return breaches;
}

// Staff no-show: a published shift today whose start_time + grace has passed with
// no clock-in. Leaves the shift understaffed — urgent, routed to operations. The
// roster (hr_schedule_shifts/hr_schedules) and clock-ins (hr_attendance_logs)
// live in the same DB as Prisma, so we query them raw. One breach per staff/day.
export async function detectNoClockIn(now: Date): Promise<Breach[]> {
  const { ymd } = mytToday(now);
  const dayStart = new Date(`${ymd}T00:00:00+08:00`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  const shifts = await prisma.$queryRaw<
    Array<{ user_id: string; outlet_id: string | null; start_time: string }>
  >`
    SELECT s.user_id, sch.outlet_id, s.start_time::text AS start_time
    FROM hr_schedule_shifts s
    JOIN hr_schedules sch ON sch.id = s.schedule_id
    WHERE s.shift_date = ${ymd}::date
      AND sch.published_at IS NOT NULL
  `;
  if (shifts.length === 0) return [];

  const clockRows = await prisma.$queryRaw<Array<{ user_id: string }>>`
    SELECT DISTINCT user_id FROM hr_attendance_logs
    WHERE clock_in >= ${dayStart} AND clock_in < ${dayEnd}
  `;
  const clockedIn = new Set(clockRows.map((r) => r.user_id));

  const grace = THRESHOLDS.attendance.graceMinutes;
  const candidates = shifts.filter((s) => {
    if (!s.user_id || clockedIn.has(s.user_id)) return false;
    const start = new Date(`${ymd}T${s.start_time}+08:00`);
    return now.getTime() > start.getTime() + grace * 60_000;
  });
  if (candidates.length === 0) return [];

  const userIds = [...new Set(candidates.map((c) => c.user_id))];
  const outletIds = [...new Set(candidates.map((c) => c.outlet_id).filter((x): x is string => !!x))];
  const [users, outlets] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    outletIds.length
      ? prisma.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ]);
  const userName = new Map<string, string>();
  for (const u of users) userName.set(u.id, u.name);
  const outletName = new Map<string, string>();
  for (const o of outlets) outletName.set(o.id, o.name);

  // One breach per staff per day (earliest unmatched shift wins).
  const seen = new Set<string>();
  const breaches: Breach[] = [];
  for (const c of candidates) {
    if (seen.has(c.user_id)) continue;
    seen.add(c.user_id);
    const oName = c.outlet_id ? outletName.get(c.outlet_id) ?? c.outlet_id : "—";
    breaches.push({
      signal: "NO_CLOCK_IN",
      outletId: c.outlet_id ?? "",
      outletName: oName,
      severity: "MED",
      routeKey: "operations",
      dedupeKey: `NO_CLOCK_IN:${c.user_id}:${ymd}`,
      summary: `${userName.get(c.user_id) ?? c.user_id} did not clock in — scheduled ${c.start_time.slice(0, 5)} at ${oName}`,
      detail: { userId: c.user_id, scheduledStart: c.start_time, date: ymd },
    });
  }
  return breaches;
}
