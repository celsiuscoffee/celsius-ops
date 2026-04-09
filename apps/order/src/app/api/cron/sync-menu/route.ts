import { NextRequest, NextResponse } from "next/server";
import { getProducts, getStores, getInventory } from "@/lib/storehub/client";

/**
 * GET /api/cron/sync-menu
 * Scheduled cron job (every 10 min on Vercel) that syncs menu from StoreHub.
 * Configure in vercel.json:
 *   { "crons": [{ "path": "/api/cron/sync-menu", "schedule": "0,10,20,30,40,50 * * * *" }] }
 *
 * Protected by CRON_SECRET env var to prevent unauthorized calls.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.STOREHUB_API_KEY) {
    return NextResponse.json({ error: "STOREHUB_API_KEY not configured" }, { status: 400 });
  }

  try {
    const storeIds = ["shah-alam", "conezion", "tamarind"]; // match your StoreHub store IDs

    const [products, stores, ...inventoryArrays] = await Promise.all([
      getProducts(),
      getStores(),
      ...storeIds.map((id) => getInventory(id)),
    ]);

    const inventory = Object.fromEntries(
      storeIds.map((id, i) => [id, inventoryArrays[i]])
    );

    const categories = [...new Set(products.map((p) => p.category).filter(Boolean))];

    return NextResponse.json({
      synced: { products: products.length, categories: categories.length, stores: stores.length },
      inventory,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
