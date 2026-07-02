/**
 * Paid x Organic consolidation — where paid search spend overlaps organic
 * local-pack strength, per search term, per outlet.
 *
 * Joins the Smart-campaign search-term spend (ads_search_term_daily) with the
 * latest geogrid scan per outlet keyword, and classifies each term:
 *
 *   exclude_candidate — you own it organically (avg rank <=3 across >=70% of
 *                       the grid): paying for these clicks is buying what you
 *                       get free -> suggest excluding the term (APPROVAL-GATED;
 *                       nothing is written to Google Ads from this module).
 *   almost            — rank 4-10: paid still earns its keep, but organic is
 *                       close — push relevance/reviews and re-check.
 *   keep              — rank >10 or not ranking: paid is your only presence.
 *   competitor        — a rival's brand: never winnable organically, paid
 *                       conquesting is a deliberate choice (owner's call).
 *   brand             — your own brand: should be excluded/owned already.
 *   no_data           — no geogrid scan covers this term yet.
 */

import { prisma } from "@/lib/prisma";
import { microsToMYR } from "./client";
import { isCompetitorBrand } from "@/lib/geogrid/target-keywords";
import { coreTerms } from "@/lib/geogrid/relevance";

export type TermVerdict = "exclude_candidate" | "almost" | "keep" | "competitor" | "brand" | "no_data";

// Own-it thresholds: dominant rank across most of the scanned grid. pctTop3
// (not just avgRank) guards the radius problem — organic #1 at the storefront
// alone is NOT ownership across the ads catchment.
export const OWN_AVG_RANK = 3;
export const OWN_PCT_TOP3 = 70;

export type OrganicSignal = { keyword: string; avgRank: number | null; pctTop3: number | null; scannedAt: string };

export function classifyTerm(term: string, organic: OrganicSignal | null): TermVerdict {
  const t = term.toLowerCase();
  if (/celsius|celcius/.test(t)) return "brand";
  if (isCompetitorBrand(t)) return "competitor";
  if (!organic) return "no_data";
  const { avgRank, pctTop3 } = organic;
  if (avgRank != null && avgRank <= OWN_AVG_RANK && (pctTop3 ?? 0) >= OWN_PCT_TOP3) return "exclude_candidate";
  if (avgRank != null && avgRank <= 10) return "almost";
  return "keep";
}

/** Latest scan per keyword, matchable by exact text or by core terms. */
export function matchOrganic(
  term: string,
  byKeyword: Map<string, OrganicSignal>,
  byCore: Map<string, OrganicSignal>,
): OrganicSignal | null {
  return byKeyword.get(term.toLowerCase()) ?? byCore.get(coreTerms(term)) ?? null;
}

export type PaidOrganicRow = {
  outletId: string | null;
  outletName: string;
  campaignId: string; // ads_campaign.id (our PK)
  campaignName: string;
  searchTerm: string;
  clicks: number;
  costMyr: number; // over the window
  estMonthlySavingMyr: number; // cost normalized to 30d
  organic: OrganicSignal | null;
  verdict: TermVerdict;
  exclusion: { status: string; decidedAt: string } | null;
};

export type PaidOrganicReport = {
  windowDays: number;
  rows: PaidOrganicRow[];
  summary: {
    totalCostMyr: number;
    candidateSavingMyr: number;
    counts: Record<TermVerdict, number>;
    termsWithSpend: number;
    lastTermDate: string | null;
  };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function buildPaidOrganicReport(windowDays = 30): Promise<PaidOrganicReport> {
  const since = new Date(Date.now() - windowDays * 86400000);

  const [terms, scans, outlets, exclusions] = await Promise.all([
    prisma.adsSearchTermDaily.findMany({
      where: { date: { gte: since } },
      select: {
        searchTerm: true,
        clicks: true,
        costMicros: true,
        date: true,
        campaign: { select: { id: true, name: true, outletId: true } },
      },
    }),
    prisma.geoGridScan.findMany({
      where: { status: { not: "failed" } },
      orderBy: { createdAt: "asc" }, // later rows overwrite -> maps hold the latest
      select: { outletId: true, keyword: true, avgRank: true, pctTop3: true, createdAt: true },
    }),
    prisma.outlet.findMany({ select: { id: true, name: true } }),
    prisma.adsTermExclusion.findMany({
      select: { campaignId: true, searchTerm: true, status: true, decidedAt: true },
    }),
  ]);

  const outletName = new Map<string, string>(outlets.map((o) => [o.id, o.name]));
  const exclusionMap = new Map<string, { status: string; decidedAt: string }>(
    exclusions.map((e) => [
      `${e.campaignId} ${e.searchTerm.toLowerCase()}`,
      { status: e.status, decidedAt: e.decidedAt.toISOString() },
    ]),
  );

  // Latest organic signal per outlet, addressable by exact keyword and by core.
  const organicByOutlet = new Map<string, { byKeyword: Map<string, OrganicSignal>; byCore: Map<string, OrganicSignal> }>();
  for (const s of scans) {
    const sig: OrganicSignal = {
      keyword: s.keyword,
      avgRank: s.avgRank,
      pctTop3: s.pctTop3,
      scannedAt: s.createdAt.toISOString().slice(0, 10),
    };
    const entry = organicByOutlet.get(s.outletId) ?? { byKeyword: new Map(), byCore: new Map() };
    entry.byKeyword.set(s.keyword.toLowerCase(), sig);
    entry.byCore.set(coreTerms(s.keyword), sig);
    organicByOutlet.set(s.outletId, entry);
  }

  // Spend per campaign x term over the window. Key = "<campaignPk> <term>";
  // the campaign PK never contains a space, the term itself may.
  type Agg = { clicks: number; costMicros: bigint; campaignName: string; outletId: string | null };
  const spend = new Map<string, Agg>();
  let lastTermDate: Date | null = null;
  for (const t of terms) {
    const key = `${t.campaign.id} ${t.searchTerm.toLowerCase()}`;
    const agg = spend.get(key) ?? {
      clicks: 0,
      costMicros: BigInt(0),
      campaignName: t.campaign.name,
      outletId: t.campaign.outletId,
    };
    agg.clicks += Number(t.clicks);
    agg.costMicros += t.costMicros;
    spend.set(key, agg);
    if (!lastTermDate || t.date > lastTermDate) lastTermDate = t.date;
  }

  const rows: PaidOrganicRow[] = [...spend.entries()].map(([key, agg]) => {
    const sep = key.indexOf(" ");
    const campaignId = key.slice(0, sep);
    const term = key.slice(sep + 1);
    const org = agg.outletId ? organicByOutlet.get(agg.outletId) : undefined;
    const organic = org ? matchOrganic(term, org.byKeyword, org.byCore) : null;
    const verdict = classifyTerm(term, organic);
    const costMyr = microsToMYR(agg.costMicros);
    return {
      outletId: agg.outletId,
      outletName: agg.outletId ? outletName.get(agg.outletId) ?? "Unknown outlet" : "Unmapped campaign",
      campaignId,
      campaignName: agg.campaignName,
      searchTerm: term,
      clicks: agg.clicks,
      costMyr: round2(costMyr),
      estMonthlySavingMyr: round2((costMyr / windowDays) * 30),
      organic,
      verdict,
      exclusion: exclusionMap.get(key) ?? null,
    };
  });

  rows.sort((a, b) => b.costMyr - a.costMyr);

  const counts: Record<TermVerdict, number> = { exclude_candidate: 0, almost: 0, keep: 0, competitor: 0, brand: 0, no_data: 0 };
  let totalCostMyr = 0;
  let candidateSavingMyr = 0;
  for (const r of rows) {
    counts[r.verdict]++;
    totalCostMyr += r.costMyr;
    if (r.verdict === "exclude_candidate" && r.exclusion?.status !== "applied") candidateSavingMyr += r.estMonthlySavingMyr;
  }

  return {
    windowDays,
    rows,
    summary: {
      totalCostMyr: round2(totalCostMyr),
      candidateSavingMyr: round2(candidateSavingMyr),
      counts,
      termsWithSpend: rows.length,
      lastTermDate: lastTermDate ? lastTermDate.toISOString().slice(0, 10) : null,
    },
  };
}
