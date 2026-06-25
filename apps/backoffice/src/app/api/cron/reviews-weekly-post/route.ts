import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createLocalPost, listLocalPosts } from "@/lib/reviews/gbp";
import { generateWeeklyPost } from "@/lib/reviews/weekly-post";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Weekly Google Post per connected outlet — keeps the profile active (a real
// prominence signal) without anyone lifting a finger. Idempotent: if the outlet
// already has a post in the last 7 days, it's skipped, so re-running never
// double-posts. Append-only (creates a post; never edits/deletes existing ones).
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TOTAL = 30; // safety ceiling per run

type OutletResult = { outletId: string; outletName: string; posted: boolean; skipped?: string; error?: string };

export async function GET(req: NextRequest) {
  // Cron secret OR an authenticated admin (so it can be triggered manually).
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) {
    const user = await getUserFromHeaders(req.headers);
    if (!user) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ skipped: "ANTHROPIC_API_KEY not set" });
  }

  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE" },
    include: { reviewSettings: true },
  });
  const connected = outlets.filter((o) => o.reviewSettings?.gbpAccountId && o.reviewSettings?.gbpLocationName);

  const results: OutletResult[] = [];
  let posted = 0;
  const cutoff = Date.now() - WEEK_MS;

  for (const outlet of connected) {
    if (posted >= MAX_TOTAL) break;
    const s = outlet.reviewSettings!;
    try {
      // Idempotency: bail if a post already went out this week.
      const { posts } = await listLocalPosts(s.gbpAccountId!, s.gbpLocationName!, 5);
      const recent = posts.some((p) => p.createTime && new Date(p.createTime).getTime() >= cutoff);
      if (recent) {
        results.push({ outletId: outlet.id, outletName: outlet.name, posted: false, skipped: "posted_this_week" });
        continue;
      }

      const keywords = await prisma.geoGridKeyword.findMany({
        where: { outletId: outlet.id, active: true },
        select: { keyword: true },
      });
      const summary = await generateWeeklyPost({
        outletName: outlet.name,
        city: outlet.city,
        keywords: keywords.map((k) => k.keyword),
      });
      if (!summary) {
        results.push({ outletId: outlet.id, outletName: outlet.name, posted: false, error: "empty_copy" });
        continue;
      }

      await createLocalPost(s.gbpAccountId!, s.gbpLocationName!, summary);
      posted++;
      results.push({ outletId: outlet.id, outletName: outlet.name, posted: true });
    } catch (err) {
      console.error(`[reviews-weekly-post] failed for outlet ${outlet.name}:`, err);
      results.push({ outletId: outlet.id, outletName: outlet.name, posted: false, error: "post_failed" });
    }
  }

  return NextResponse.json({
    ran_at: new Date().toISOString(),
    outlets_connected: connected.length,
    total_posted: posted,
    results,
  });
}
