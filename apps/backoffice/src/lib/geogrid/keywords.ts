/**
 * Choose which keywords each outlet's geogrid tracks. Two sources, merged:
 *  - a curated, demand-ranked floor seeded from the Google Ads search-terms
 *    report (always, every active outlet — see target-keywords.ts), and
 *  - the GBP Performance API top terms (when the outlet is GBP-connected).
 * Branded, navigational/address, and competitor-brand terms are filtered out —
 * we only track ownable discovery terms.
 */
import { prisma } from "@/lib/prisma";
import { getTopSearchKeywords } from "@/lib/reviews/gbp";
import { isCompetitorBrand, targetKeywordsForOutlet } from "@/lib/geogrid/target-keywords";

// Branded ("celsius...") = trivially #1, not discovery. Address/navigational =
// the person already knows us. Drop both; keep category/product/location terms.
function isBrandedOrNav(keyword: string): boolean {
  const k = keyword.toLowerCase();
  if (/celsius|celcius/.test(k)) return true;
  if (k.length > 45) return true; // full-address strings
  if (/persiaran|jalan|lorong|lebuh|selangor|\b\d{5}\b/.test(k)) return true;
  return false;
}

export async function refreshKeywords(
  outletId: string,
  topN = 4,
): Promise<{ ok: boolean; selected?: string[]; reason?: string }> {
  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    include: { reviewSettings: true },
  });
  if (!outlet?.reviewSettings?.gbpLocationName) {
    return { ok: false, reason: "no GBP location" };
  }

  let all;
  try {
    all = await getTopSearchKeywords(outlet.reviewSettings.gbpLocationName);
  } catch (err) {
    return { ok: false, reason: `performance API: ${(err as Error).message}` };
  }

  const discovery = all
    .filter((k) => !isBrandedOrNav(k.keyword) && !isCompetitorBrand(k.keyword))
    .slice(0, topN);
  if (discovery.length === 0) return { ok: false, reason: "no discovery keywords found" };

  const keep = discovery.map((d) => d.keyword);
  for (const d of discovery) {
    await prisma.geoGridKeyword.upsert({
      where: { outletId_keyword: { outletId, keyword: d.keyword } },
      // Deliberately does NOT touch `active` on update: a term retired on the
      // Keyword Strategy board stays retired — resurrecting it here silently
      // undid every prune and re-bloated the scan budget. New terms start
      // active; reactivation is the board's explicit call.
      update: { impressions: d.impressions, source: "auto" },
      create: { outletId, keyword: d.keyword, impressions: d.impressions, source: "auto", active: true },
    });
  }
  // Retire auto keywords that dropped out of the top set (keep manual ones).
  await prisma.geoGridKeyword.updateMany({
    where: { outletId, source: "auto", active: true, keyword: { notIn: keep } },
    data: { active: false },
  });

  return { ok: true, selected: keep };
}

/**
 * Seed the curated, demand-ranked keyword set (from the Google Ads search-terms
 * report) for one outlet. Idempotent: creates missing terms as active "ads"
 * rows and refreshes demand on existing ones — but NEVER flips a retired term
 * back to active. A retire on the Keyword Strategy board is a human decision
 * about scan budget; the monthly re-seed used to silently overturn it, which
 * re-bloated the set to 90+ combos and starved the loop of repeat scans.
 * Works for every active outlet, GBP-connected or not.
 */
export async function seedTargetKeywords(outletId: string, outletName: string): Promise<string[]> {
  const targets = targetKeywordsForOutlet(outletName);
  for (const t of targets) {
    await prisma.geoGridKeyword.upsert({
      where: { outletId_keyword: { outletId, keyword: t.keyword } },
      update: { impressions: t.clicks || null },
      create: { outletId, keyword: t.keyword, impressions: t.clicks || null, source: "ads", active: true },
    });
  }
  return targets.map((t) => t.keyword);
}
