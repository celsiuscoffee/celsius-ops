// EOD source router — the single place that decides, per outlet/date, whether
// the day's AR journal comes from StoreHub or from our own POS-native infra.
//
// Routing is mutually exclusive (see eodSourceFor): a cutover outlet goes to
// the internal ingester, a pre-cutover outlet with a StoreHub id goes to the
// StoreHub ingester, and anything with neither source is skipped. StoreHub and
// internal therefore never both post for the same outlet/date — and even if a
// manual run raced them, the one-journal-per-outlet/date guard in each ingester
// would no-op the loser.
//
// The daily finance-eod cron calls this; the per-source "all" helpers remain
// for manual/report-only runs.

import { prisma } from "@/lib/prisma";
import { ingestOutletEod } from "./storehub-eod";
import { ingestOutletEodInternal } from "./internal-eod";
import { eodSourceFor } from "./internal-eod-aggregate";
import type { IngestEodResult } from "./storehub-eod";

export type RoutedEodResult = IngestEodResult & {
  source: "storehub" | "internal" | "skipped";
};

export async function ingestAllOutletsEodRouted(date: string): Promise<RoutedEodResult[]> {
  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, storehubId: true, posNativeCutoverAt: true },
  });

  const results: RoutedEodResult[] = [];
  for (const o of outlets) {
    const source = eodSourceFor(o, date);
    if (source === "internal") {
      results.push({ ...(await ingestOutletEodInternal(o.id, date)), source });
    } else if (source === "storehub") {
      results.push({ ...(await ingestOutletEod(o.id, date)), source });
    } else {
      results.push({
        outletId: o.id,
        outletName: o.name,
        date,
        transactionsFetched: 0,
        skipped: "no source (pre-cutover, no storehubId)",
        source,
      });
    }
  }
  return results;
}
