/**
 * GBP location relink — detect (and optionally repair) an outlet whose stored
 * gbpLocationName points at the wrong listing, by matching the GBP account's
 * own location list against the outlet's verified Places id.
 *
 * Why placeId is the anchor: it's the outlet's public identity, cross-checked
 * against its geogrid scans and review-QR g.page token — while the internal
 * locations/NNN id is invisible outside the GBP API and was mis-set by hand
 * once (Tamarind carried Shah Alam's id, so its review snapshots, feed and
 * relevance audit read the wrong shop, and its scoreboard velocity spiked
 * when the wrong listing's count entered its history).
 *
 * Used by the admin/cron endpoint /api/reviews/gbp-relink and, in repair mode,
 * by the nightly reviews-daily-snapshot cron so a mis-link self-heals instead
 * of silently poisoning every downstream reviews feature.
 */
import { prisma } from "@/lib/prisma";
import { listAccountLocations } from "@/lib/reviews/gbp";

export type RelinkResult = {
  outlet: string;
  status: "ok" | "mismatch" | "repaired" | "no_match" | "error";
  location?: string;
  stored?: string | null;
  correct?: string;
  gbpTitle?: string | null;
  placeId?: string | null;
  error?: string;
};

export async function relinkGbpLocations(apply: boolean): Promise<{
  checked: number;
  repaired: number;
  results: RelinkResult[];
}> {
  const settings = await prisma.reviewSettings.findMany({
    where: {
      gbpAccountId: { not: null },
      gbpPlaceId: { not: null },
      outlet: { status: "ACTIVE" },
    },
    include: { outlet: { select: { name: true } } },
  });

  const byAccount = new Map<string, Awaited<ReturnType<typeof listAccountLocations>>>();
  const results: RelinkResult[] = [];
  let repaired = 0;

  for (const s of settings) {
    try {
      let locations = byAccount.get(s.gbpAccountId!);
      if (!locations) {
        locations = await listAccountLocations(s.gbpAccountId!);
        byAccount.set(s.gbpAccountId!, locations);
      }
      const match = locations.find((l) => l.placeId === s.gbpPlaceId);
      if (!match) {
        results.push({ outlet: s.outlet.name, status: "no_match", placeId: s.gbpPlaceId });
        continue;
      }
      if (match.name === s.gbpLocationName) {
        results.push({ outlet: s.outlet.name, status: "ok", location: match.name });
        continue;
      }
      if (apply) {
        await prisma.reviewSettings.update({
          where: { outletId: s.outletId },
          data: { gbpLocationName: match.name },
        });
        repaired++;
      }
      results.push({
        outlet: s.outlet.name,
        status: apply ? "repaired" : "mismatch",
        stored: s.gbpLocationName,
        correct: match.name,
        gbpTitle: match.title,
      });
    } catch (e) {
      results.push({ outlet: s.outlet.name, status: "error", error: (e as Error).message });
    }
  }

  return { checked: settings.length, repaired, results };
}
