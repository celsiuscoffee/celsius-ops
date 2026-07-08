import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
// Service-role: authenticated via getSession and every query is constrained to
// the caller's own shifts / attributed reviews server-side. The anon client
// would return nothing for hr_attendance_logs once RLS is enabled (mig 064).
import { supabaseAdmin as supabase } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/hr/my-reviews — reviews that landed while I was on shift.
//
// Reads from hr_review_penalty (which holds ALL reviews ≤ 3★ synced from GBP,
// regardless of penalty status). A review counts as "mine" if either:
//   1. I'm in attributed_user_ids (manager flagged me), OR
//   2. The review_timestamp falls within one of my attendance windows at
//      the same outlet.
//
// Note: 4-5★ positive reviews aren't synced today (only 1-3★ are). When we
// expand sync to cover positive reviews, this will surface them too.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const since = new Date();
  since.setDate(since.getDate() - 90);
  const sinceIso = since.toISOString();

  // 1. My attendance windows (last 90 days)
  const { data: logs } = await supabase
    .from("hr_attendance_logs")
    .select("outlet_id, clock_in, clock_out")
    .eq("user_id", session.id)
    .gte("clock_in", sinceIso)
    .not("clock_out", "is", null);
  const myShifts = (logs || []) as { outlet_id: string; clock_in: string; clock_out: string }[];

  // 2. All synced reviews (penalty table) for relevant outlets in the window
  const outletIds = Array.from(new Set(myShifts.map((s) => s.outlet_id)));
  const { data: penalties } = await supabase
    .from("hr_review_penalty")
    .select("id, gbp_review_id, outlet_id, review_date, review_timestamp, rating, review_text, reviewer_name, status, attributed_user_ids, penalty_amount")
    .gte("review_date", since.toISOString().slice(0, 10))
    .in("outlet_id", outletIds.length ? outletIds : ["__none__"]);

  type Row = {
    id: string;
    gbp_review_id: string;
    outlet_id: string;
    review_date: string;
    review_timestamp: string | null;
    rating: number;
    review_text: string | null;
    reviewer_name: string | null;
    status: "pending" | "applied" | "dismissed";
    attributed_user_ids: string[];
    penalty_amount: number;
  };
  const rows = (penalties || []) as Row[];

  // 3. Match each review to my shifts
  const outlets = outletIds.length
    ? await prisma.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true } })
    : [];
  const outletMap = new Map(outlets.map((o) => [o.id, o.name]));

  const mine = rows.filter((r) => {
    if ((r.attributed_user_ids || []).includes(session.id)) return true;
    const ts = r.review_timestamp ? new Date(r.review_timestamp) : null;
    if (!ts) return false;
    return myShifts.some(
      (s) => s.outlet_id === r.outlet_id && ts >= new Date(s.clock_in) && ts <= new Date(s.clock_out),
    );
  });

  const out = mine.map((r) => ({
    id: r.id,
    outletName: outletMap.get(r.outlet_id) || "",
    rating: r.rating,
    comment: r.review_text,
    reviewer: r.reviewer_name,
    createdAt: r.review_timestamp || `${r.review_date}T12:00:00Z`,
    isPenalty: r.status === "applied",
    penaltyStatus: r.status,
    // Aliases the native MyReview type reads (apps/staff-native/lib/hr/api.ts,
    // consumed by apps/staff-native/app/(staff)/hr/reviews.tsx). The penalty
    // table has no `source` column, so these all originate from GBP review sync.
    review_date: r.review_date,
    reviewer_name: r.reviewer_name,
    source: "review",
  }));
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return NextResponse.json({ reviews: out, count: out.length });
}
