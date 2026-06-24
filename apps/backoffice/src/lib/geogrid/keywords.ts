/**
 * Auto-select which keywords each outlet's geogrid tracks, from the GBP
 * Performance API (the terms customers actually searched). Branded and
 * navigational/address terms are filtered out — we only track discovery terms.
 */
import { prisma } from "@/lib/prisma";
import { getTopSearchKeywords } from "@/lib/reviews/gbp";

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

  const discovery = all.filter((k) => !isBrandedOrNav(k.keyword)).slice(0, topN);
  if (discovery.length === 0) return { ok: false, reason: "no discovery keywords found" };

  const keep = discovery.map((d) => d.keyword);
  for (const d of discovery) {
    await prisma.geoGridKeyword.upsert({
      where: { outletId_keyword: { outletId, keyword: d.keyword } },
      update: { active: true, impressions: d.impressions, source: "auto" },
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
