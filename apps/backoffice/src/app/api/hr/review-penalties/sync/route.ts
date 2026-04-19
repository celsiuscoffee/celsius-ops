import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { fetchGoogleReviews } from "@/lib/reviews/gbp";

export const dynamic = "force-dynamic";

// GET  /api/hr/review-penalties/sync — Vercel Cron entrypoint (Bearer CRON_SECRET)
// POST /api/hr/review-penalties/sync — manual admin trigger from UI
// Both run the same sync: pull latest GBP reviews per outlet, auto-create pending
// hr_review_penalty rows for 1-2★ reviews, auto-dismiss stale pending rows.
async function runSync() {
  const { data: settings } = await hrSupabaseAdmin
    .from("hr_company_settings")
    .select("review_penalty_amount, review_penalty_max_star_rating, review_penalty_auto_dismiss_days")
    .limit(1)
    .maybeSingle();
  const penaltyAmount = Number(settings?.review_penalty_amount ?? 50);
  const maxStar = Number(settings?.review_penalty_max_star_rating ?? 2);
  const autoDismissDays = Number(settings?.review_penalty_auto_dismiss_days ?? 7);

  // 1. Auto-dismiss stale pending rows
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - autoDismissDays);
  const { data: dismissed } = await hrSupabaseAdmin
    .from("hr_review_penalty")
    .update({
      status: "dismissed",
      dismiss_reason: `Auto-dismissed (unactioned >${autoDismissDays} days)`,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("status", "pending")
    .lt("created_at", cutoffDate.toISOString())
    .select("id");

  // 2. Fetch GBP reviews per outlet + create pending rows
  const outlets = await prisma.reviewSettings.findMany({
    where: { gbpAccountId: { not: null }, gbpLocationName: { not: null } },
    select: { outletId: true, gbpAccountId: true, gbpLocationName: true },
  });

  let created = 0;
  const errors: string[] = [];

  for (const o of outlets) {
    if (!o.gbpAccountId || !o.gbpLocationName) continue;
    try {
      const data = await fetchGoogleReviews(o.gbpAccountId, o.gbpLocationName, 50);
      for (const r of (data.reviews || [])) {
        if (r.rating > maxStar) continue;
        // Skip if already tracked
        const { data: existing } = await hrSupabaseAdmin
          .from("hr_review_penalty")
          .select("id")
          .eq("gbp_review_id", r.id)
          .maybeSingle();
        if (existing) continue;

        const reviewDate = r.createdAt.slice(0, 10);

        // Insert pending row (manager will attribute on review)
        const { error: insErr } = await hrSupabaseAdmin
          .from("hr_review_penalty")
          .insert({
            gbp_review_id: r.id,
            outlet_id: o.outletId,
            review_date: reviewDate,
            review_timestamp: r.createdAt,
            rating: r.rating,
            review_text: r.comment || null,
            reviewer_name: r.reviewer?.name || null,
            status: "pending",
            attributed_user_ids: [],
            penalty_amount: penaltyAmount,
          });
        if (insErr) {
          errors.push(`${o.outletId}/${r.id}: ${insErr.message}`);
        } else {
          created++;
        }
      }
    } catch (e) {
      errors.push(`${o.outletId}: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  return NextResponse.json({
    ok: true,
    created,
    autoDismissed: (dismissed || []).length,
    errors,
  });
}

// Vercel Cron — Bearer CRON_SECRET
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runSync();
}

// Manual admin trigger from UI
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return runSync();
}
