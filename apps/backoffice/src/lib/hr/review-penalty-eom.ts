// End-of-month "decide before salary" reminder for review penalties.
//
// A ≤maxStar Google review creates a PENDING hr_review_penalty row. A manager
// must attribute it to the staff on shift (→ applied, which deducts that
// month's performance allowance) or dismiss it. Only APPLIED rows in the
// payroll month deduct. Left alone, a pending row is auto-dismissed by the
// daily sync — so without a nudge, penalties silently disappear before payroll.
//
// This reminder fires a few days before month-end (before the salary run) and
// WhatsApps the ops/manager leads a digest of every pending penalty for the
// closing month, so each one gets a deliberate decision. It sends nothing when
// there is nothing pending. Gated by OPS_NUDGES_MODE (shadow → log only).

import { prisma } from "@/lib/prisma";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { resolveRecipients } from "@/lib/ops-pulse/router";
import { sendOpsDigest } from "@/lib/ops-pulse/sender";
import { nudgesMode, type NudgesMode } from "@/lib/ops-nudges";

const MAX_LINES = 8;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Current MYT month window as YYYY-MM-DD strings (review_date is a plain date).
function mytMonthWindow(now: Date): { start: string; end: string; monthName: string } {
  const myt = new Date(now.getTime() + 8 * 3600_000);
  const y = myt.getUTCFullYear();
  const m = myt.getUTCMonth(); // 0-based
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const mm = String(m + 1).padStart(2, "0");
  return {
    start: `${y}-${mm}-01`,
    end: `${y}-${mm}-${String(lastDay).padStart(2, "0")}`,
    monthName: MONTHS[m],
  };
}

export interface ReviewPenaltyEomResult {
  mode: NudgesMode;
  ranAt: string;
  month: string;
  pending: number;
  managerSent: number;
}

export async function runReviewPenaltyEomReminder(now = new Date()): Promise<ReviewPenaltyEomResult> {
  const mode = nudgesMode();
  const ranAt = now.toISOString();
  const { start, end, monthName } = mytMonthWindow(now);
  const empty: ReviewPenaltyEomResult = { mode, ranAt, month: monthName, pending: 0, managerSent: 0 };
  if (mode === "off") return empty;

  // Pending penalties whose review falls in the month being closed.
  const { data: rows, error } = await hrSupabaseAdmin
    .from("hr_review_penalty")
    .select("id, outlet_id, review_date, rating, review_text, penalty_amount")
    .eq("status", "pending")
    .gte("review_date", start)
    .lte("review_date", end)
    .order("review_date", { ascending: true });
  if (error) throw new Error(`review-penalty EOM query failed: ${error.message}`);
  if (!rows || rows.length === 0) return empty;

  // Outlet names for readable lines.
  const outletIds = [...new Set(rows.map((r) => r.outlet_id).filter(Boolean))];
  const outlets = outletIds.length
    ? await prisma.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(outlets.map((o) => [o.id, o.name]));

  const fmtDate = (d: string) => {
    const [, mo, day] = d.split("-");
    return `${Number(day)} ${MONTHS[Number(mo) - 1]?.slice(0, 3) ?? mo}`;
  };
  const snippet = (t: string | null) => {
    if (!t) return "no comment";
    const s = t.replace(/\s+/g, " ").trim();
    return s.length > 40 ? `${s.slice(0, 40)}...` : s;
  };

  const lines = rows.slice(0, MAX_LINES).map((r) => {
    const outlet = nameById.get(r.outlet_id) || "Unknown outlet";
    return `${outlet} · ${r.rating}-star "${snippet(r.review_text)}" (${fmtDate(r.review_date)}) — RM${Number(r.penalty_amount)}`;
  });
  if (rows.length > MAX_LINES) lines.push(`...and ${rows.length - MAX_LINES} more in BackOffice`);

  const n = rows.length;
  const headline = `${n} review penalt${n > 1 ? "ies" : "y"} for ${monthName} still need a decision before this month's salary. Attribute each to the staff on shift or dismiss it in BackOffice (HR, Review penalties).`;

  if (mode === "shadow") {
    console.log("[review-penalty-eom:shadow]", JSON.stringify({ month: monthName, pending: n, headline, lines }));
    return { ...empty, pending: n };
  }

  const recips = await resolveRecipients("operations");
  let managerSent = 0;
  for (const m of recips) {
    if (!m.phone) continue;
    const res = await sendOpsDigest(m.phone, headline, lines);
    if (res.ok) managerSent += 1;
    else console.error(`[review-penalty-eom] digest to ${m.name} failed:`, res.error);
  }
  return { mode, ranAt, month: monthName, pending: n, managerSent };
}
