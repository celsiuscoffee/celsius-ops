import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { mytDayWindow, type ConsumptionResult } from "@/lib/inventory/consumption";
import { postOutletConsumption } from "@/lib/inventory/consumption-post";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/cron/consumption-post — the consumption engine.
//
// For each active outlet, turns yesterday's menu sales into theoretical
// ingredient depletion (sales × recipe BOM) so stock reflects what was used, not
// just what was received. SHADOW BY DEFAULT: it computes + reports the numbers
// and writes nothing. It only posts negative stock adjustments when
// CONSUMPTION_ENGINE_ENABLED=true AND a system user exists — and that should stay
// off until stock quantities are normalised to base UOM (StockBalance is
// currently fragmented by package; see docs/design/procurement-qa-2026-06-26.md).
//
// Auth: Vercel cron secret, or an OWNER/ADMIN may trigger on demand (and pass
// ?date=YYYY-MM-DD to backfill a specific MYT day).
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) {
    const user = await getSession();
    if (!user || !["OWNER", "ADMIN"].includes(user.role)) {
      return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
    }
  }

  try {
    const dateParam = req.nextUrl.searchParams.get("date");
    // Default to yesterday in MYT (sales for a full closed day).
    const mytNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const mytYesterday = new Date(mytNow.getTime() - 86_400_000);
    const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : mytYesterday.toISOString().slice(0, 10);
    const { startUtc, endUtc } = mytDayWindow(date);

    const flagLive = process.env.CONSUMPTION_ENGINE_ENABLED === "true";
    // Live posting needs a real user for StockAdjustment.adjustedById.
    const systemUser = flagLive
      ? await prisma.user.findFirst({ where: { role: "OWNER" }, select: { id: true } })
      : null;
    const live = flagLive && !!systemUser;

    const outlets = await prisma.outlet.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, loyaltyOutletId: true, pickupStoreId: true },
    });

    const results: ConsumptionResult[] = [];
    for (const o of outlets) {
      try {
        results.push(
          await postOutletConsumption({
            outletId: o.id,
            outletName: o.name,
            loyaltyOutletId: o.loyaltyOutletId,
            pickupStoreId: o.pickupStoreId,
            date,
            dayStartUtc: startUtc,
            dayEndUtc: endUtc,
            live,
            systemUserId: systemUser?.id ?? null,
          }),
        );
      } catch (e) {
        console.error(`[consumption-post] outlet=${o.name} failed:`, e instanceof Error ? e.message : e);
      }
    }

    const summary = {
      date,
      mode: live ? "live" : "shadow",
      outlets: results.length,
      posted: results.filter((r) => r.posted).length,
      alreadyPosted: results.filter((r) => r.alreadyPosted).length,
      totalProductsConsumed: results.reduce((s, r) => s + r.productsConsumed, 0),
      menusWithoutRecipe: results.reduce((s, r) => s + r.menusWithoutRecipe, 0),
      itemsUnmapped: results.reduce((s, r) => s + r.itemsUnmapped, 0),
    };
    console.log(`[consumption-post] ${JSON.stringify(summary)}`);
    return NextResponse.json({ ok: true, summary, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "consumption-post failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
