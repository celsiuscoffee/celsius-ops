import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchGoogleReviews } from "@/lib/reviews/gbp";
import { fetchTopCompetitor } from "@/lib/reviews/competitors";
import { buildScoreboard } from "@/lib/reviews/scoreboard";
import { sendMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Daily snapshot of each outlet's Google review prominence + the top nearby
// competitor's review count. Feeds the /reviews/scoreboard "daily rank lever"
// (reviews/day vs the rate needed to out-review the leader). Idempotent per
// day via the (outletId, snapshotDate) unique key, so re-running just refreshes
// today's row.
export async function GET(req: NextRequest) {
  // Cron secret OR an authenticated admin (so it can be triggered manually).
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) {
    const user = await getUserFromHeaders(req.headers);
    if (!user) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const now = Date.now();
  const DAY = 86400000;

  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE" },
    include: { reviewSettings: true },
  });
  const connected = outlets.filter(
    (o) => o.reviewSettings?.gbpAccountId && o.reviewSettings?.gbpLocationName,
  );

  const results: { outlet: string; reviewCount?: number; competitor?: string | null; ok: boolean; error?: string }[] = [];

  for (const outlet of connected) {
    const s = outlet.reviewSettings!;
    try {
      const data = await fetchGoogleReviews(s.gbpAccountId!, s.gbpLocationName!, 50);
      const recentFetched = data.reviews.length;
      const recentResponded = data.reviews.filter((r) => r.reply).length;
      const reviews7d = data.reviews.filter((r) => new Date(r.createdAt).getTime() >= now - 7 * DAY).length;
      const reviews30d = data.reviews.filter((r) => new Date(r.createdAt).getTime() >= now - 30 * DAY).length;

      let comp = null;
      if (apiKey && outlet.lat != null && outlet.lng != null) {
        comp = await fetchTopCompetitor(apiKey, Number(outlet.lat), Number(outlet.lng), s.gbpPlaceId ?? null);
      }

      const payload = {
        reviewCount: data.totalReviewCount,
        averageRating: data.averageRating || null,
        recentFetched,
        recentResponded,
        reviews7d,
        reviews30d,
        competitorName: comp?.name ?? null,
        competitorPlaceId: comp?.placeId ?? null,
        competitorReviews: comp?.reviews ?? null,
        competitorRating: comp?.rating ?? null,
      };

      await prisma.reviewDailySnapshot.upsert({
        where: { outletId_snapshotDate: { outletId: outlet.id, snapshotDate: today } },
        create: { outletId: outlet.id, snapshotDate: today, ...payload },
        update: payload,
      });
      results.push({ outlet: outlet.name, reviewCount: data.totalReviewCount, competitor: comp?.name ?? null, ok: true });
    } catch (err) {
      results.push({ outlet: outlet.name, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Nudge: if any outlet is behind its required daily review rate, tell the owner.
  let nudged = false;
  try {
    const board = await buildScoreboard();
    const behind = board.filter((r) => r.status === "behind");
    const chatRaw = process.env.TELEGRAM_OWNER_CHAT_ID;
    if (behind.length && chatRaw) {
      const lines = behind.map(
        (r) => `• ${r.outletName}: ${r.velocity7d}/day now, need ${r.targetPerDay}/day to overtake ${r.competitorName} (gap ${r.gap})`,
      );
      const msg =
        `Local rank, outlets behind on reviews:\n\n${lines.join("\n")}\n\n` +
        `The lever: ask more happy customers to review (in-store QR plus post-order). Reviews are what move the rank.`;
      await sendMessage(Number(chatRaw), msg);
      nudged = true;
    }
  } catch (err) {
    console.error("[reviews-daily-snapshot] nudge failed", err);
  }

  return NextResponse.json({ snapshotDate: today.toISOString().slice(0, 10), outlets: results, nudged });
}
