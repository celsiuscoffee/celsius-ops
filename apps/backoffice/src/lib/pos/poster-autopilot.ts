/**
 * POS poster autopilot — scores each round's customer-display posters by
 * AOV-lift potential and decides which to make active (and in what order).
 *
 * Why a poster lifts AOV (not the same as "popular"):
 *   • margin RM    — price − BOM ingredient cost; push the high-ringgit-margin item
 *   • food-attach  — in drink-heavy rounds (high single-item %), a bite grows the basket
 *   • price anchor — higher-ticket signature items lift AOV directly
 *   • popularity   — light tie-breaker (and the sole signal in "control" mode)
 *
 * "control" mode ranks by popularity only — the switchback A/B baseline the cron
 * alternates with, so pos_poster_perf can tell whether margin/attach beats
 * popularity (and whether posters move AOV at all).
 *
 * The cron applies the returned decisions by flipping splash_posters.active /
 * sort_order. The /api/pos/posters reader serves the current round's active set.
 */
import { prisma } from "@/lib/prisma";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";

export type Round = "breakfast" | "brunch" | "lunch" | "midday" | "evening" | "dinner" | "supper";
export const ROUNDS: Round[] = ["breakfast", "brunch", "lunch", "midday", "evening", "dinner", "supper"];

// Mirrors the suggest-pairs FOOD_CATEGORIES — everything else is a drink.
const FOOD_CATEGORIES = new Set([
  "cakes", "cookies", "croissant", "fries", "nasi-lemak", "noodle", "pasta", "roti-bakar", "sandwiches",
]);

// A round counts as "drink-heavy" (worth pushing a bite) above this single-item rate.
const DRINK_HEAVY_SINGLE_RATE = 45;

export type PosterDecision = {
  round: Round | null;
  posterId: string;
  title: string | null;
  productId: string | null;
  active: boolean;
  sortOrder: number;
  score: number;
  reason: string;
};

/**
 * Cheapest-supplier ingredient cost (RM) per lower(menu.name), from the BOM.
 * Mirrors the Sales-reports cost model (ingredient part only — packaging is
 * small and channel-dependent, immaterial for ranking). ADHOC = RM0 placeholder.
 */
export async function ingredientCostByName(): Promise<Map<string, number>> {
  const [menus, supplierProducts] = await Promise.all([
    prisma.menu.findMany({
      select: {
        name: true,
        ingredients: {
          select: { productId: true, quantityUsed: true, product: { select: { itemType: true } } },
        },
      },
    }),
    prisma.supplierProduct.findMany({
      where: { isActive: true },
      select: {
        productId: true,
        price: true,
        productPackage: { select: { conversionFactor: true } },
        supplier: { select: { supplierCode: true } },
      },
    }),
  ]);

  const costPerBase = new Map<string, number>();
  for (const sp of supplierProducts) {
    if (sp.supplier?.supplierCode === "ADHOC") continue;
    const price = Number(sp.price);
    if (price <= 0) continue;
    const conv = sp.productPackage?.conversionFactor ? Number(sp.productPackage.conversionFactor) : 0;
    if (conv <= 0) continue;
    const c = price / conv;
    const ex = costPerBase.get(sp.productId);
    if (ex == null || c < ex) costPerBase.set(sp.productId, c);
  }

  const byName = new Map<string, number>();
  for (const m of menus) {
    if (!m.name) continue;
    let ing = 0;
    for (const li of m.ingredients) {
      if (li.product.itemType === "PACKAGING") continue;
      ing += Number(li.quantityUsed) * (costPerBase.get(li.productId) ?? 0);
    }
    byName.set(m.name.trim().toLowerCase(), Math.round(ing * 100) / 100);
  }
  return byName;
}

type Signals = {
  rounds: Record<string, { aov: number; single_rate: number; orders: number }>;
  products: { round: string; product_id: string; units: number }[];
};

export type Placement = "pos-display" | "home" | "splash";

// Default live-slot count per placement: POS shows 3/round, the home carousel
// rotates ~5, splash is a single launch poster (pick the one best one).
const DEFAULT_TOPK: Record<Placement, number> = { "pos-display": 3, home: 5, splash: 1 };

// Group key for a poster row: POS rotates by day-part round; app placements
// usually have no round (one '__all__' group) but support rounds once tagged.
const GROUP_ALL = "__all__";

/**
 * Build the active/sort_order plan for one placement. Pure read — returns
 * decisions; the caller applies them.
 *
 * pos-display has no per-poster conversion signal, so it scores purely on the
 * AOV-lift heuristic (margin + food-attach + price). home/splash posters carry
 * deeplinks, so once orders are attributed (poster_events → pos_poster_app_perf)
 * the engine blends each poster's MEASURED order AOV over the heuristic — the
 * blend weight ramps with attributed orders (cold-start heuristic → measured).
 */
export async function planPosterRotation(
  opts: { mode: "autopilot" | "control"; placement?: Placement; topK?: number; days?: number },
): Promise<PosterDecision[]> {
  const placement: Placement = opts.placement ?? "pos-display";
  const topK = opts.topK ?? DEFAULT_TOPK[placement];
  const days = opts.days ?? 21;
  const isApp = placement !== "pos-display";
  const supabase = getSupabaseAdmin();

  let postersQuery = supabase
    .from("splash_posters")
    .select("id,title,round,product_id")
    .eq("brand_id", "brand-celsius")
    .eq("placement", placement);
  // POS posters are always round-tagged; app posters may be round-less.
  if (placement === "pos-display") postersQuery = postersQuery.not("round", "is", null);

  const [sigRes, postersRes, productsRes, costByName, perfRes] = await Promise.all([
    supabase.rpc("pos_poster_signals", { p_days: days }),
    postersQuery,
    supabase.from("products").select("id,name,category,price").eq("brand_id", "brand-celsius"),
    ingredientCostByName(),
    isApp ? supabase.rpc("pos_poster_app_perf", { p_days: 28 }) : Promise.resolve({ data: [] }),
  ]);

  const sig = (sigRes.data ?? { rounds: {}, products: [] }) as Signals;
  const roundStats = sig.rounds ?? {};
  const unitsByRoundProduct = new Map<string, number>();
  for (const r of sig.products ?? []) unitsByRoundProduct.set(`${r.round}|${r.product_id}`, Number(r.units));

  // Measured per-poster order AOV (app placements only).
  const measuredByPoster = new Map<string, { orders: number; aov: number }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
  for (const r of ((perfRes as any)?.data ?? []) as any[]) {
    measuredByPoster.set(String(r.poster_id), { orders: Number(r.orders) || 0, aov: Number(r.attributed_aov) || 0 });
  }

  const prodById = new Map<string, { name: string; category: string | null; price: number }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
  for (const p of (productsRes.data ?? []) as any[]) {
    prodById.set(p.id, { name: p.name, category: p.category, price: Number(p.price ?? 0) });
  }

  // Group posters by round (or one '__all__' bucket for round-less app posters).
  const postersByGroup = new Map<string, { id: string; title: string | null; product_id: string | null; round: string | null }[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
  for (const po of (postersRes.data ?? []) as any[]) {
    const key = po.round ?? GROUP_ALL;
    const arr = postersByGroup.get(key) ?? [];
    arr.push({ id: po.id, title: po.title ?? null, product_id: po.product_id ?? null, round: po.round ?? null });
    postersByGroup.set(key, arr);
  }

  const decisions: PosterDecision[] = [];
  for (const [groupKey, posters] of postersByGroup) {
    if (!posters.length) continue;
    const round = (groupKey === GROUP_ALL ? null : (groupKey as Round));
    const drinkHeavy = round ? (roundStats[round]?.single_rate ?? 0) >= DRINK_HEAVY_SINGLE_RATE : false;

    const scored = posters.map((po) => {
      const prod = po.product_id ? prodById.get(po.product_id) : null;
      const priceRM = prod?.price ?? 0;
      // Fallback to a 35%-COGS assumption when a poster isn't linked / cost unknown.
      const costRM = prod ? costByName.get(prod.name.trim().toLowerCase()) ?? priceRM * 0.35 : priceRM * 0.35;
      const marginRM = Math.max(0, priceRM - costRM);
      const isFood = prod?.category ? FOOD_CATEGORIES.has(prod.category) : false;
      const units = po.product_id ? unitsByRoundProduct.get(`${round ?? ""}|${po.product_id}`) ?? 0 : 0;
      const measured = measuredByPoster.get(po.id) ?? { orders: 0, aov: 0 };
      return { po, prod, priceRM, marginRM, isFood, units, measured, attach: isFood && drinkHeavy };
    });

    const maxMargin = Math.max(1, ...scored.map((s) => s.marginRM));
    const maxPrice = Math.max(1, ...scored.map((s) => s.priceRM));
    const maxUnits = Math.max(1, ...scored.map((s) => s.units));
    const maxMeasuredAov = Math.max(1, ...scored.map((s) => s.measured.aov));

    const ranked = scored
      .map((s) => {
        const marginN = s.marginRM / maxMargin;
        const priceN = s.priceRM / maxPrice;
        const unitsN = s.units / maxUnits;
        let score: number;
        let reason: string;
        if (opts.mode === "control") {
          score = unitsN;
          reason = "popularity (control)";
        } else {
          const heuristic = 0.45 * marginN + 0.3 * (s.attach ? 1 : 0) + 0.15 * priceN + 0.1 * unitsN;
          const bits: string[] = [];
          if (s.attach) bits.push("fills drink-only gap");
          if (marginN > 0.7) bits.push(`RM${s.marginRM.toFixed(2)} margin`);
          if (priceN > 0.7) bits.push("premium anchor");
          if (!s.prod) bits.push("unlinked");
          // Blend in MEASURED order AOV as attributed orders accrue (app only):
          // weight ramps 0→1 over the first ~10 orders, then measured dominates.
          const w = Math.min(s.measured.orders / 10, 1);
          if (w > 0) {
            score = w * (s.measured.aov / maxMeasuredAov) + (1 - w) * heuristic;
            bits.unshift(`measured AOV RM${s.measured.aov.toFixed(2)} (${s.measured.orders} ord)`);
          } else {
            score = heuristic;
          }
          reason = bits.join(", ") || "balanced";
        }
        return { s, score, reason };
      })
      .sort((a, b) => b.score - a.score);

    ranked.forEach((r, i) => {
      decisions.push({
        round,
        posterId: r.s.po.id,
        title: r.s.po.title,
        productId: r.s.po.product_id,
        active: i < topK,
        sortOrder: (i + 1) * 10,
        score: Math.round(r.score * 1000) / 1000,
        reason: r.reason,
      });
    });
  }
  return decisions;
}
