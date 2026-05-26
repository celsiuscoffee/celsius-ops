import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/loyalty/co-purchase?ids=A,B,C&limit=4
 *
 * "What do customers actually buy alongside what's in this cart?"
 * Backed by the `product_co_purchase_scores` materialized view
 * (12 months of StoreHub POS baskets, refreshed nightly) via the
 * `get_co_purchased_products(for_product_id, limit_count)` RPC.
 *
 * We fan out one RPC per cart product id and aggregate co_counts
 * across cart items — products that co-occur with MULTIPLE items
 * in the current basket rank higher than products that only pair
 * with one. Tied scores break by raw co_count from the highest-
 * scoring partner so cult favorites still surface.
 *
 * Excludes any product already in the cart (we wouldn't suggest
 * "buy this with this") and any drink-only categories so the
 * suggestion strip stays food-led ("make it a meal" pattern).
 * Returns enriched product rows (name + category + price + image)
 * so the customer-display can render tiles without a second
 * round-trip.
 *
 * Response shape:
 *   { items: Array<{ id, name, category, price_sen, image_url, score }> }
 *
 * Empty `items` is a normal result — products fresh from the
 * catalog with no co-purchase history yet just return [], and the
 * customer-display falls back to its category-diversified popular
 * bites pool.
 */

// Categories we never surface in pair-with suggestions. Drinks
// dominate the cart already; suggesting another coffee on top of a
// coffee-led basket is noise. Bites/snacks/pastries are the AOV
// signal we want to drive. Mirrors BITE_CATEGORIES on the display
// but expressed as "non-bite" so we can include anything novel
// (e.g. merch, seasonal items) without an allowlist drift.
const EXCLUDED_CATEGORIES = new Set([
  "coffee",
  "non-coffee",
  "espresso-based",
  "manual-brew",
  "tea",
  "frappe",
  "mocktails",
  "smoothies",
  "milkshakes",
  "matcha",
  "specialty-drinks",
]);

function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export async function GET(req: NextRequest) {
  const idsParam = req.nextUrl.searchParams.get("ids");
  const limit = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("limit") ?? "6", 10), 1),
    20,
  );
  if (!idsParam) {
    return NextResponse.json({ items: [] });
  }

  // Comma-split + dedupe the cart product ids. Empty entries are
  // dropped — handy when the client appends a stray comma.
  const cartIds = Array.from(
    new Set(
      idsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
  if (cartIds.length === 0) {
    return NextResponse.json({ items: [] });
  }

  const supabase = getClient();

  try {
    // Fan-out: one RPC per cart product, run in parallel. The view
    // is materialized so each call is cheap (<50ms typical).
    const results = await Promise.all(
      cartIds.map((id) =>
        supabase.rpc("get_co_purchased_products", {
          for_product_id: id,
          limit_count: 20,
        }),
      ),
    );

    // Aggregate co_counts across all cart items. A product that
    // pairs with 3 cart items ranks higher than one that pairs
    // with only 1, even if the latter has a higher per-pair score.
    // basketBoost = number of distinct cart items this product co-
    // occurs with (acts as the primary sort key).
    const scoreMap = new Map<string, { score: number; basketBoost: number }>();
    for (const res of results) {
      if (res.error) {
        console.warn("[co-purchase] rpc failed:", res.error.message);
        continue;
      }
      const rows = (res.data ?? []) as Array<{ paired_with: string; co_count: number }>;
      for (const row of rows) {
        // Drop self-pairs in case the view ever leaks them, and
        // drop anything already in the current cart.
        if (cartIds.includes(row.paired_with)) continue;
        const cur = scoreMap.get(row.paired_with) ?? { score: 0, basketBoost: 0 };
        scoreMap.set(row.paired_with, {
          score: cur.score + (row.co_count ?? 0),
          basketBoost: cur.basketBoost + 1,
        });
      }
    }

    if (scoreMap.size === 0) {
      return NextResponse.json({ items: [] });
    }

    // Hydrate the candidate ids with catalog rows so the
    // customer-display can render tiles without a follow-up
    // fetch. is_available=true filter — we don't want to suggest
    // a sold-out item.
    const candidateIds = Array.from(scoreMap.keys());
    const { data: prods, error: prodErr } = await supabase
      .from("products")
      .select("id, name, category, price, image_url, is_available")
      .in("id", candidateIds)
      .eq("is_available", true);
    if (prodErr) {
      console.error("[co-purchase] product hydrate failed:", prodErr.message);
      return NextResponse.json({ items: [] });
    }

    // Sort by basketBoost desc, then raw co_count desc, then alpha
    // (stable tiebreak so the order doesn't jitter render-to-render).
    const enriched = (prods ?? [])
      .filter((p: any) => !EXCLUDED_CATEGORIES.has(p.category))
      .map((p: any) => {
        const s = scoreMap.get(p.id)!;
        return {
          id: p.id as string,
          name: p.name as string,
          category: p.category as string,
          price_sen: Math.round(Number(p.price ?? 0) * 100),
          image_url: (p.image_url ?? null) as string | null,
          score: s.score,
          basketBoost: s.basketBoost,
        };
      })
      .sort((a, b) => {
        if (b.basketBoost !== a.basketBoost) return b.basketBoost - a.basketBoost;
        if (b.score !== a.score) return b.score - a.score;
        return a.name.localeCompare(b.name);
      })
      .slice(0, limit);

    return NextResponse.json({ items: enriched });
  } catch (err) {
    console.error("[co-purchase] unexpected:", err);
    return NextResponse.json({ items: [] });
  }
}
