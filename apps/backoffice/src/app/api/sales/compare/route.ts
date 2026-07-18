import { sortOutlets } from "@/lib/outlet-order";
import { NextRequest, NextResponse } from "next/server";
import { getSession, verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeProjection } from "@/lib/sales/projection";
import {
  bucketEventsIntoPeriods,
  aggregatePeriod,
  formatPeriodLabel,
  type CompareEvent,
} from "../_lib/period-aggregation";
import { getUnifiedSalesForOutlet } from "../_lib/unified-sales";

// ─── GET /api/sales/compare ──────────────────────────────────────────────
// Compare multiple date ranges side by side.
// Query: ?periods=2026-04-07:2026-04-07,2026-03-31:2026-03-31&outletId=all

export async function GET(request: NextRequest) {
  try {
    // Cookie session (backoffice web) OR Bearer. The staff app's StoreHub bridge
    // forwards the caller's celsius-session JWT — same secret + format across apps,
    // so verifyToken validates it here. /compare only needs a valid session for the
    // gate (outletId comes from the query), so either auth path is equivalent.
    let user = await getSession();
    if (!user) {
      const m = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
      if (m) user = await verifyToken(m[1]);
    }
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const outletId = searchParams.get("outletId") || null;
    const periodsParam = searchParams.get("periods") || "";
    // The staff app's bridge passes source=storehub so it gets ONLY StoreHub sales
    // (it adds its own native pos+pickup). The backoffice graph omits it = unified.
    const storehubOnly = searchParams.get("source") === "storehub";

    // Parse periods: "from:to,from:to,..."
    const periodPairs = periodsParam
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const [from, to] = p.split(":");
        return { from, to: to || from };
      });

    if (periodPairs.length === 0 || periodPairs.length > 8) {
      return NextResponse.json(
        { error: "Provide 1-8 periods as from:to pairs separated by commas" },
        { status: 400 },
      );
    }

    // Validate dates
    for (const pp of periodPairs) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(pp.from) || !/^\d{4}-\d{2}-\d{2}$/.test(pp.to)) {
        return NextResponse.json({ error: `Invalid date format: ${pp.from}:${pp.to}` }, { status: 400 });
      }
    }

    // Fetch outlets. No storehubId requirement — consignment-only outlets
    // (Nilai, IOI Mall) have no till at all and were previously invisible to
    // Compare; their sales come from consignment_sales inside the unified source.
    const outletWhere = outletId && outletId !== "all"
      ? { id: outletId }
      : { status: "ACTIVE" as const };

    const outlets = await prisma.outlet.findMany({
      where: outletWhere,
      select: { id: true, name: true, storehubId: true, loyaltyOutletId: true, pickupStoreId: true, posNativeCutoverAt: true },
    });

    if (outlets.length === 0) {
      return NextResponse.json({ error: "No matching outlets" }, { status: 404 });
    }

    // Compute the global min/max date across all periods for smart merging
    let globalFrom = periodPairs[0].from;
    let globalTo = periodPairs[0].to;
    for (const pp of periodPairs) {
      if (pp.from < globalFrom) globalFrom = pp.from;
      if (pp.to > globalTo) globalTo = pp.to;
    }

    const warnings: string[] = [];

    // Fetch each outlet's sales once across the global span from the unified source
    // (hubbo + StoreHub archives, POS-native, pickup app, consignment), then
    // bucket per period.
    const globalFromDate = new Date(globalFrom + "T00:00:00+08:00");
    const globalToDate = new Date(globalTo + "T23:59:59+08:00");

    const outletResults = await Promise.allSettled(
      outlets.map((outlet) =>
        getUnifiedSalesForOutlet(
          {
            outletId: outlet.id,
            storehubStoreId: outlet.storehubId,
            loyaltyOutletId: outlet.loyaltyOutletId,
            pickupStoreId: outlet.pickupStoreId,
            cutoverAt: outlet.posNativeCutoverAt,
          },
          globalFromDate,
          globalToDate,
          { storehubOnly },
        ),
      ),
    );

    const events: CompareEvent[] = [];
    for (const result of outletResults) {
      if (result.status === "rejected") {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        console.error(`[sales/compare] Failed for outlet:`, msg);
        warnings.push(msg);
        continue;
      }
      for (const ev of result.value) events.push(ev);
    }

    // Pure aggregation — see _lib/period-aggregation (characterized by
    // its test suite; the SQL data-layer swap is gated on those tests).
    const periodBuckets = bucketEventsIntoPeriods(events, periodPairs);

    // Outlets we actually have data for — projection lib takes the IDs.
    const outletIdsForProjection = outlets.map((o) => o.id);

    // Build response for each period (async because projection compute hits the DB)
    const periods = await Promise.all(periodBuckets.map(async (bucket) => {
      // Projection — only computed when today falls inside the period.
      // Reads from the local unified_sales view (all channels), so it's a
      // fast local query. Returns null for past/future periods; client
      // falls back to hiding the projection card in that case.
      const projection = await computeProjection({
        from: bucket.from,
        to: bucket.to,
        outletIds: outletIdsForProjection,
      }).catch((err) => {
        console.warn(`[sales/compare] projection compute failed for ${bucket.from}–${bucket.to}:`, err);
        return null;
      });

      return {
        from: bucket.from,
        to: bucket.to,
        label: formatPeriodLabel(bucket.from, bucket.to),
        projection,
        ...aggregatePeriod(bucket),
      };
    }));

    // Outlets for filter dropdown — every active outlet, consignment-only
    // included, in canonical business order
    const allOutlets = await prisma.outlet.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
    });

    return NextResponse.json({
      periods,
      availableOutlets: sortOutlets(allOutlets),
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (err) {
    console.error("[sales/compare] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
