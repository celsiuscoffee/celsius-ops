/**
 * Weekly Local Rank digest — the loop reports itself.
 *
 * Sent to the owner's Telegram at the end of each weekly geogrid scan run, so
 * "is local rank improving?" arrives every Monday instead of being asked for:
 *   - rank movement for every combo scanned this run (vs its previous scan),
 *   - review velocity per outlet vs its target (the prominence lever),
 *   - an ads guardrail: the optimizer only ever CUTS budgets, so flag any
 *     campaign whose conversions collapsed after cuts — cost optimisation must
 *     not quietly starve a store of visibility.
 *
 * composeLocalRankDigest is pure (fixtures test the formatting); the
 * build-and-send wrapper does the queries and the Telegram call, best-effort —
 * a digest failure must never fail the scan run that feeds it.
 */
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/telegram";
import { ENABLED_STATUSES } from "@/lib/ads/optimizer";

export type ScannedCombo = {
  outlet: string;
  keyword: string;
  avgRank: number | null;
  pctTop3: number | null;
  prevRank: number | null;
  prevTop3: number | null;
};

export type OutletReviewLine = {
  outlet: string;
  reviews30d: number;
  reviewCount: number;
  competitorName: string | null;
  competitorReviews: number | null;
};

export type AdsFlag = { outlet: string; recentConv: number; priorConv: number };

// Review-velocity targets (reviews/30d). Grounded in the Aug 2026 QA: Tamarind
// proved ~28-37/30d is achievable with the ask ritual; Shah Alam's moat erodes
// below ~25; Nilai only needs a modest push to out-review its tiny local field.
export const REVIEW_TARGETS_30D: Array<{ match: RegExp; target: number }> = [
  { match: /nilai/i, target: 12 },
  { match: /shah alam/i, target: 30 },
];
export const REVIEW_TARGET_DEFAULT_30D = 25;

export function reviewTargetFor(outletName: string): number {
  return REVIEW_TARGETS_30D.find((t) => t.match.test(outletName))?.target ?? REVIEW_TARGET_DEFAULT_30D;
}

// Rank moves smaller than this are scan noise (same threshold the Progress
// page uses), not news.
const RANK_NOISE = 0.5;
const MAX_LINES_PER_OUTLET = 8;

const fmtRank = (r: number | null) => (r == null ? "unranked" : `#${r.toFixed(1)}`);

function rankLine(c: ScannedCombo): string {
  if (c.prevRank == null && c.avgRank == null) return `• ${c.keyword}: still unranked`;
  if (c.prevRank == null) return `• ${c.keyword}: ${fmtRank(c.avgRank)}${c.avgRank == null ? "" : " (first 10km scan)"}`;
  if (c.avgRank == null) return `• ${c.keyword}: ${fmtRank(c.prevRank)} → unranked ▼`;
  const delta = c.prevRank - c.avgRank; // positive = climbed toward #1
  const arrow = delta >= RANK_NOISE ? "▲" : delta <= -RANK_NOISE ? "▼" : "→";
  return `• ${c.keyword}: ${fmtRank(c.prevRank)} → ${fmtRank(c.avgRank)} ${arrow}`;
}

export function composeLocalRankDigest(input: {
  dateLabel: string;
  scanned: ScannedCombo[];
  reviews: OutletReviewLine[];
  adsFlags: AdsFlag[];
}): string {
  const byOutlet = new Map<string, ScannedCombo[]>();
  for (const c of input.scanned) {
    (byOutlet.get(c.outlet) ?? byOutlet.set(c.outlet, []).get(c.outlet)!).push(c);
  }

  const blocks: string[] = [`Local Rank weekly — ${input.dateLabel}`];

  const outletNames = [...new Set([...byOutlet.keys(), ...input.reviews.map((r) => r.outlet)])].sort();
  for (const name of outletNames) {
    const lines: string[] = [`\n${name}`];
    const combos = byOutlet.get(name) ?? [];
    for (const c of combos.slice(0, MAX_LINES_PER_OUTLET)) lines.push(rankLine(c));
    if (combos.length > MAX_LINES_PER_OUTLET) lines.push(`• …and ${combos.length - MAX_LINES_PER_OUTLET} more scanned`);

    const rev = input.reviews.find((r) => r.outlet === name);
    if (rev) {
      const target = reviewTargetFor(name);
      const status = rev.reviews30d >= target ? "on track" : `ASK MORE (target ${target})`;
      const gap =
        rev.competitorName && rev.competitorReviews != null
          ? ` · vs ${rev.competitorName} ${rev.competitorReviews - rev.reviewCount > 0 ? "-" : "+"}${Math.abs(rev.competitorReviews - rev.reviewCount)}`
          : "";
      lines.push(`Reviews: ${rev.reviews30d}/30d — ${status}${gap}`);
    }
    blocks.push(lines.join("\n"));
  }

  for (const f of input.adsFlags) {
    const pct = f.priorConv > 0 ? Math.round((1 - f.recentConv / f.priorConv) * 100) : 0;
    blocks.push(
      `\n⚠ Ads guardrail: ${f.outlet} conversions ${f.recentConv} last 14d vs ${f.priorConv} prior (−${pct}%). The optimizer only cuts — if this persists, step the budget back up in Google Ads.`,
    );
  }

  blocks.push(`\nThe lever order: categories → reviews → everything else. Reply here if you want the detail.`);
  // Telegram hard limit is 4096 chars; stay well under.
  return blocks.join("\n").slice(0, 3900);
}

/** Query reviews + ads context, compose, send. Returns the text sent, or null. */
export async function buildAndSendLocalRankDigest(scanned: ScannedCombo[]): Promise<string | null> {
  const chatRaw = process.env.TELEGRAM_OWNER_CHAT_ID;
  if (!chatRaw || scanned.length === 0) return null;

  const snapshots = await prisma.reviewDailySnapshot.findMany({
    orderBy: [{ outletId: "asc" }, { snapshotDate: "desc" }],
    distinct: ["outletId"],
    include: { outlet: { select: { name: true, status: true } } },
  });
  const reviews: OutletReviewLine[] = snapshots
    .filter((s) => s.outlet.status === "ACTIVE")
    .map((s) => ({
      outlet: s.outlet.name,
      reviews30d: s.reviews30d,
      reviewCount: s.reviewCount,
      competitorName: s.competitorName,
      competitorReviews: s.competitorReviews,
    }));

  // Guardrail: conversions in the last 14 days vs the 14 before, per enabled
  // campaign. Collapse >30% with a meaningful base (>=20 prior conv) is worth
  // the owner's eyes — everything smaller is weather.
  const adsFlags: AdsFlag[] = [];
  try {
    const campaigns = await prisma.adsCampaign.findMany({
      where: { status: { in: ENABLED_STATUSES }, account: { isManager: false } },
      select: { id: true, name: true, outletId: true },
    });
    const now = Date.now();
    const d14 = new Date(now - 14 * 86400000);
    const d28 = new Date(now - 28 * 86400000);
    const outletName = new Map(
      (await prisma.outlet.findMany({ select: { id: true, name: true } })).map((o) => [o.id, o.name]),
    );
    for (const c of campaigns) {
      const [recent, prior] = await Promise.all([
        prisma.adsMetricDaily.aggregate({ where: { campaignId: c.id, date: { gte: d14 } }, _sum: { conversions: true } }),
        prisma.adsMetricDaily.aggregate({
          where: { campaignId: c.id, date: { gte: d28, lt: d14 } },
          _sum: { conversions: true },
        }),
      ]);
      const recentConv = Math.round(Number(recent._sum.conversions ?? 0));
      const priorConv = Math.round(Number(prior._sum.conversions ?? 0));
      if (priorConv >= 20 && recentConv < priorConv * 0.7) {
        adsFlags.push({ outlet: (c.outletId && outletName.get(c.outletId)) || c.name, recentConv, priorConv });
      }
    }
  } catch {
    // Ads context is garnish — never block the digest on it.
  }

  const dateLabel = new Date().toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
  const text = composeLocalRankDigest({ dateLabel, scanned, reviews, adsFlags });
  await sendMessage(Number(chatRaw), text);
  return text;
}
