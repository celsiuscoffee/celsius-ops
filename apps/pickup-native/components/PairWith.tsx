import { useEffect, useMemo } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import * as Haptics from "expo-haptics";
import { Plus, Check, Sparkles } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import type { Product } from "../lib/menu";
import { useApp } from "../lib/store";
import { formatPrice } from "../lib/api";
import { cloudinaryThumb, prefetchImages } from "../lib/image";
import { ProductImage } from "./ProductImage";
import { fetchActiveCombos, bestComboForPair, type ComboPromotion } from "../lib/combos";
import { fetchCoPurchasedProducts, type CoPurchaseScore } from "../lib/co-purchase";
import { useActiveSales } from "../lib/use-active-sales";
import { bestSaleForProduct } from "../lib/product-sales";
import { PriceTag } from "./PriceTag";

/**
 * Pair-with cross-sell on the product detail screen. Stage-and-commit
 * pattern — taps select pairings into a "to add" set on the parent
 * screen; the parent's main "Add to cart" button is what actually
 * commits everything (drink + every staged pairing) in one shot.
 *
 * Why staged + tied to the main commit instead of independent adds:
 *   - Direct add felt disjointed: tap + on a pair → silent add →
 *     no feedback → main drink still not in cart yet → if user
 *     backs out of the screen, the pair is orphaned in the cart.
 *   - Stage-and-commit matches the mental model of "build my
 *     order on this page". One decision, one commit.
 *   - If user changes their mind and backs out, nothing gets added.
 *
 * Visual state:
 *   - Default: white card, plus button bottom-right
 *   - Staged: amber border + tint, checkmark replaces the plus,
 *     subtle "Added" pill at the top-left of the card
 *
 * Pairing logic (Phase 1, deliberately simple):
 *   - Each category is tagged drink/food via CATEGORY_KIND below.
 *   - Drink → suggest food. Food → suggest drink.
 *   - Rank by featured first, then featured_position, then name.
 *   - De-dupe against cart so we don't suggest already-in-basket items.
 *   - Show 6 items max in a horizontal scroll.
 */

const CATEGORY_KIND: Record<string, "drink" | "food"> = {
  // Drinks
  "artisan-choc":   "drink",
  "artisan-matcha": "drink",
  "classic":        "drink",
  "flavoured":      "drink",
  "fruit-tea":      "drink",
  "gourmet-tea":    "drink",
  "mocha":          "drink",
  "mocktails":      "drink",
  "bottles":        "drink",
  // Food
  "cakes":          "food",
  "cookies":        "food",
  "croissant":      "food",
  "fries":          "food",
  "nasi-lemak":     "food",
  "noodle":         "food",
  "pasta":          "food",
  "roti-bakar":     "food",
  "sandwiches":     "food",
};

const MAX_PAIRS = 6;

export type PairWithProps = {
  /** The product currently being viewed. */
  current: Product;
  /** All products from the menu fetch. */
  allProducts: Product[];
  /** Set of product IDs the customer has staged for "add together"
   *  with the main product. The parent owns this state — we just
   *  reflect it visually and emit toggles. */
  stagedIds: Set<string>;
  /** Toggle a product into / out of the staged set. */
  onToggle: (p: Product) => void;
};

/** Compute the price of a pair-with line at default selections. The
 *  parent uses this to roll up the bottom CTA total without having
 *  to peek into modifier shape. Exported so the product page can
 *  share the exact same math. */
export function defaultPairLinePrice(p: Product): number {
  const defaultModTotal = (p.modifiers ?? [])
    .filter((g) => !g.multiSelect)
    .reduce((s, g) => {
      const def = g.options.find((o) => o.isDefault) ?? g.options[0];
      return s + (def?.priceDelta ?? 0);
    }, 0);
  return p.price + defaultModTotal;
}

/** Build the pair-with suggestion list using three layered signals,
 *  in priority order:
 *
 *    1. Combo pair  — anything that triggers a backoffice combo with
 *       the current product. These are real money-saving deals so they
 *       deserve the top slots even if they're same-kind (a drink+drink
 *       combo is fine here). Sorted by combo savings, descending.
 *
 *    2. Co-purchase — products customers have HISTORICALLY bought with
 *       this one (POS data via product_co_purchase_scores view).
 *       Filtered to opposite kind so the section header ("Pair with a
 *       bite") still reads true. Sorted by co_count descending.
 *
 *    3. Category fallback — opposite-kind products by featured_position
 *       + name. Pads slots when combo + co-purchase don't fill MAX_PAIRS,
 *       and provides the entire list for new products with no signal yet.
 *
 *  Dedupes by product id so a product that appears in both combo and
 *  co-purchase doesn't take two slots. Caps at MAX_PAIRS total. */
export function buildPairSuggestions(args: {
  current: Product;
  allProducts: Product[];
  cartProductIds: Set<string>;
  /** Optional — when present, combo-eligible products jump to the top
   *  of the list. Pass an empty array (or omit) to skip this layer. */
  combos?: ComboPromotion[];
  /** Optional — when present, co-purchase data drives the middle slot.
   *  Pass an empty array (or omit) to skip this layer. */
  coPurchaseScores?: CoPurchaseScore[];
  /** Outlet ID — passed to the combo-eligibility check so we don't
   *  surface combos that don't apply at the customer's outlet. */
  outletId?: string | null;
}): Product[] {
  const { current, allProducts, cartProductIds, combos = [], coPurchaseScores = [], outletId = null } = args;

  const currentKind = CATEGORY_KIND[current.category] ?? "drink";
  const targetKind: "drink" | "food" = currentKind === "drink" ? "food" : "drink";

  // Index for fast lookup.
  const byId = new Map<string, Product>();
  for (const p of allProducts) byId.set(p.id, p);

  // Reusable predicate: skip the current product, in-cart products,
  // and unavailable products. Doesn't filter by kind here — the
  // combo layer is allowed to break kind, the others enforce it.
  const isCandidate = (p: Product): boolean =>
    p.id !== current.id && p.is_available && !cartProductIds.has(p.id);

  const result: Product[] = [];
  const seen = new Set<string>();

  function tryAdd(p: Product | undefined): void {
    if (!p || seen.has(p.id) || !isCandidate(p)) return;
    if (result.length >= MAX_PAIRS) return;
    seen.add(p.id);
    result.push(p);
  }

  // ── Layer 1: combo-eligible (any kind) ──────────────────────────
  if (combos.length > 0) {
    type Scored = { product: Product; savings: number };
    const scored: Scored[] = [];
    for (const candidate of allProducts) {
      if (!isCandidate(candidate)) continue;
      const best = bestComboForPair({
        combos,
        currentProductId:       current.id,
        currentProductCategory: current.category,
        currentProductPrice:    current.price,
        pairProductId:          candidate.id,
        pairProductCategory:    candidate.category,
        pairProductPrice:       candidate.price,
        outletId,
      });
      if (best && best.savings > 0) scored.push({ product: candidate, savings: best.savings });
    }
    scored.sort((a, b) => b.savings - a.savings);
    for (const s of scored) tryAdd(s.product);
  }

  // ── Layer 2: co-purchase, opposite kind ─────────────────────────
  if (coPurchaseScores.length > 0) {
    for (const score of coPurchaseScores) {
      const p = byId.get(score.paired_with);
      if (!p) continue;
      // Section header reads "Pair with a bite/drink" so keep co-purchase
      // suggestions on the opposite-kind axis. Same-kind co-purchase
      // (e.g. someone always orders Black + Latte) shows up in the
      // wider rotation when we add a "frequently bought together"
      // surface, not in the pair-with section.
      if ((CATEGORY_KIND[p.category] ?? "drink") !== targetKind) continue;
      tryAdd(p);
    }
  }

  // ── Layer 3: category fallback (opposite kind by featured order) ─
  const fallback = allProducts
    .filter((p) =>
      isCandidate(p) &&
      (CATEGORY_KIND[p.category] ?? "drink") === targetKind,
    )
    .sort((a, b) => {
      if (a.is_featured !== b.is_featured) return a.is_featured ? -1 : 1;
      const ap = a.featured_position ?? 9999;
      const bp = b.featured_position ?? 9999;
      if (ap !== bp) return ap - bp;
      return a.name.localeCompare(b.name);
    });
  for (const p of fallback) tryAdd(p);

  return result;
}

export function PairWith({ current, allProducts, stagedIds, onToggle }: PairWithProps) {
  const cart = useApp((s) => s.cart);
  const outletId = useApp((s) => s.outletId);

  // Active combos — cached 5min so the section render is instant on
  // subsequent product pages. Empty list when no combos exist (the
  // common case until admins set some up); component renders normally.
  const { data: combos = [] } = useQuery({
    queryKey: ["active-combos"],
    queryFn: fetchActiveCombos,
    staleTime: 5 * 60_000,
  });

  // Active sale-shaped promos. When a pair-with card is on sale AND
  // not part of a combo, we render the PriceTag with strikethrough.
  // If the card is in a combo, the combo treatment wins (combos
  // are the more salient deal in this context).
  const { sales } = useActiveSales();

  // Co-purchase scores from POS data — "what people actually buy with
  // this drink". Per-product, cached 10min. Empty when the product is
  // too new to have signal; builder falls back to category logic.
  const { data: coPurchaseScores = [] } = useQuery({
    queryKey: ["co-purchase", current.id],
    queryFn: () => fetchCoPurchasedProducts(current.id, 30),
    staleTime: 10 * 60_000,
    enabled: !!current.id,
  });

  // The builder now does combo + co-purchase + category fallback in
  // one pass with proper de-dup. No post-sort needed.
  const suggestionsSorted = useMemo(
    () => buildPairSuggestions({
      current,
      allProducts,
      cartProductIds: new Set(cart.map((c) => c.productId)),
      combos,
      coPurchaseScores,
      outletId,
    }),
    [current, allProducts, cart, combos, coPurchaseScores, outletId],
  );

  // Warm the image cache as soon as we know the suggestion list.
  // The horizontal scroll lazy-renders offscreen items, but
  // Image.prefetch primes the native cache so the first scroll past
  // them is buttery instead of "appearing 1-2s after they slide in".
  useEffect(() => {
    prefetchImages(
      suggestionsSorted.map((p) => cloudinaryThumb(p.image_url, { size: 140 })),
    );
  }, [suggestionsSorted]);

  if (suggestionsSorted.length === 0) return null;

  const heading =
    (CATEGORY_KIND[current.category] ?? "drink") === "drink"
      ? "Pair with a bite"
      : "Pair with a drink";

  // If any staged pair triggers a combo with the current product,
  // surface a section-level "Combo unlocked" hint above the cards
  // so the customer sees confirmation that the savings will apply
  // when they tap Add to cart.
  // Combo savings preview for the section banner. A combo fires
  // ONCE per cart at evaluation time (the gate is "all categories
  // present", not "all categories present multiple times"), so we
  // pick the best single combo savings across staged pairs rather
  // than summing — summing would over-promise vs what the server
  // actually applies. Matches the math used by the product page CTA.
  let stagedComboSavings = 0;
  if (combos.length > 0) {
    for (const p of suggestionsSorted) {
      if (!stagedIds.has(p.id)) continue;
      const c = bestComboForPair({
        combos,
        currentProductId:       current.id,
        currentProductCategory: current.category,
        currentProductPrice:    current.price,
        pairProductId:          p.id,
        pairProductCategory:    p.category,
        pairProductPrice:       p.price,
        outletId,
      });
      if (c && c.savings > stagedComboSavings) stagedComboSavings = c.savings;
    }
  }

  return (
    <View className="mt-8">
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-espresso text-xs font-bold uppercase tracking-wider">
          {heading}
        </Text>
        <Text className="text-muted-fg text-[10px] uppercase tracking-wider">
          Tap to add
        </Text>
      </View>
      {stagedComboSavings > 0 ? (
        <View
          className="mb-3 rounded-xl px-3 py-2 flex-row items-center gap-2"
          style={{ backgroundColor: "#DCFCE7", borderWidth: 1, borderColor: "#86EFAC" }}
        >
          <Sparkles size={12} color="#15803D" strokeWidth={2.5} />
          <Text
            className="text-green-800 text-[12px] flex-1"
            style={{ fontFamily: "SpaceGrotesk_700Bold" }}
          >
            Combo unlocked — saves {formatPrice(stagedComboSavings).replace(/^RM ?/, "RM")}
          </Text>
        </View>
      ) : (
        <Text
          className="text-muted-fg text-[11px] mb-3"
          style={{ fontFamily: "SpaceGrotesk_400Regular" }}
        >
          Adds together when you tap Add to cart below.
        </Text>
      )}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10, paddingRight: 8 }}
      >
        {suggestionsSorted.map((p) => {
          const isStaged = stagedIds.has(p.id);
          // Combo savings preview — null when no combo applies. Drives
          // the "Save RMx" badge that nudges customers toward the
          // value pairing.
          const combo = combos.length > 0
            ? bestComboForPair({
                combos,
                currentProductId:       current.id,
                currentProductCategory: current.category,
                currentProductPrice:    current.price,
                pairProductId:          p.id,
                pairProductCategory:    p.category,
                pairProductPrice:       p.price,
                outletId,
              })
            : null;
          return (
            <Pressable
              key={p.id}
              onPress={() => {
                Haptics.selectionAsync();
                onToggle(p);
              }}
              className="rounded-2xl overflow-hidden active:opacity-90"
              style={{
                width: 140,
                backgroundColor: isStaged ? "#FFF6F1" : "#FFFFFF",
                borderWidth: isStaged ? 2 : 1,
                borderColor: isStaged ? "#C05040" : "rgba(26,8,0,0.10)",
                shadowColor: "#000",
                shadowOpacity: isStaged ? 0.08 : 0.04,
                shadowRadius: 4,
                shadowOffset: { width: 0, height: 2 },
              }}
              accessibilityRole="button"
              accessibilityLabel={
                isStaged
                  ? `Remove ${p.name} from order, ${formatPrice(defaultPairLinePrice(p))}`
                  : `Add ${p.name} to order, ${formatPrice(defaultPairLinePrice(p))}`
              }
              accessibilityState={{ selected: isStaged }}
            >
              {/* Image area — ProductImage handles the loading state
                  (cream pulse + delayed spinner + fade-in) so the card
                  never reads as broken or empty. The parent Pressable
                  is 140 wide; we lock height too. */}
              <View style={{ width: 140, height: 140, position: "relative" }}>
                <ProductImage
                  uri={cloudinaryThumb(p.image_url, { size: 140 })}
                  width={140}
                  height={140}
                  fallback={
                    <Text
                      className="text-espresso text-[13px] text-center"
                      style={{ fontFamily: "Peachi-Bold" }}
                      numberOfLines={3}
                    >
                      {p.name}
                    </Text>
                  }
                />
                {/* Combo savings badge — surfaces "Save RMx" when this
                    pair triggers a backoffice combo promo. Sits on top
                    of the image at top-left. Suppressed when "Added"
                    is showing (the staged state takes precedence so
                    the badge area never has two pills fighting). */}
                {!isStaged && combo && (
                  <View
                    style={{
                      position: "absolute",
                      top: 8,
                      left: 8,
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: "#16A34A", // green to read as "deal"
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 10,
                      shadowColor: "#000",
                      shadowOpacity: 0.18,
                      shadowRadius: 3,
                      shadowOffset: { width: 0, height: 1 },
                      elevation: 2,
                    }}
                  >
                    <Sparkles size={10} color="#FFFFFF" strokeWidth={2.5} />
                    <Text
                      className="text-white text-[9px] uppercase ml-0.5"
                      style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 0.5 }}
                    >
                      Save {formatPrice(combo.savings).replace(/^RM ?/, "RM")}
                    </Text>
                  </View>
                )}
                {/* "Added" badge on staged cards — top-left so it doesn't
                    fight with the toggle button bottom-right. */}
                {isStaged && (
                  <View
                    style={{
                      position: "absolute",
                      top: 8,
                      left: 8,
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: "#C05040",
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 10,
                    }}
                  >
                    <Check size={10} color="#FFFFFF" strokeWidth={3} />
                    <Text
                      className="text-white text-[9px] uppercase ml-0.5"
                      style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 0.5 }}
                    >
                      Added
                    </Text>
                  </View>
                )}
                {/* Toggle button. + when not staged, ✓ when staged. */}
                <View
                  style={{
                    position: "absolute",
                    bottom: 8,
                    right: 8,
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: isStaged ? "#FFFFFF" : "#160800",
                    borderWidth: isStaged ? 1.5 : 0,
                    borderColor: "#C05040",
                    // A small shadow lifts the button off the photo so
                    // it's tappable even on a busy product image.
                    shadowColor: "#000",
                    shadowOpacity: 0.25,
                    shadowRadius: 3,
                    shadowOffset: { width: 0, height: 1 },
                    elevation: 2,
                  }}
                >
                  {isStaged ? (
                    <Check size={18} color="#C05040" strokeWidth={3} />
                  ) : (
                    <Plus size={18} color="#FFFFFF" strokeWidth={2.5} />
                  )}
                </View>
              </View>
              <View className="px-2.5 py-2">
                <Text
                  className="text-espresso text-[12px]"
                  style={{ fontFamily: "Peachi-Bold" }}
                  numberOfLines={1}
                >
                  {p.name}
                </Text>
                {(() => {
                  // Both sale AND combo can apply to the same line at
                  // checkout (promos are stackable=true on the combos
                  // we seed). The pair-with card should reflect both
                  // savings paths so the customer sees the FULL deal.
                  //
                  // Four states:
                  //   - none      → just price
                  //   - sale only → PriceTag with strikethrough
                  //   - combo only → strikethrough + "with combo"
                  //   - sale + combo → sale price + strikethrough +
                  //     "with combo" hint
                  const pairBase = defaultPairLinePrice(p);
                  const sale = bestSaleForProduct({
                    sales,
                    productId: p.id,
                    productCategory: p.category,
                    productBasePrice: pairBase,
                    outletId,
                  });
                  // Combo savings sit ON TOP of any sale price; we show
                  // the sale's effective price as the headline (since
                  // that's the per-line price) and the combo as a
                  // qualifier next to it.
                  if (combo && sale) {
                    return (
                      <View className="flex-row items-baseline gap-1.5 mt-0.5 flex-wrap">
                        <Text
                          className="text-primary text-[12px]"
                          style={{ fontFamily: "Peachi-Bold" }}
                        >
                          {formatPrice(sale.effective_price)}
                        </Text>
                        <Text
                          className="text-muted-fg text-[11px]"
                          style={{ fontFamily: "SpaceGrotesk_500Medium", textDecorationLine: "line-through" }}
                        >
                          {formatPrice(pairBase)}
                        </Text>
                        <Text
                          className="text-green-700 text-[11px]"
                          style={{ fontFamily: "Peachi-Bold" }}
                        >
                          + combo
                        </Text>
                      </View>
                    );
                  }
                  if (combo) {
                    return (
                      <View className="flex-row items-baseline gap-1.5 mt-0.5">
                        <Text
                          className="text-muted-fg text-[11px]"
                          style={{ fontFamily: "SpaceGrotesk_500Medium", textDecorationLine: "line-through" }}
                        >
                          {formatPrice(pairBase)}
                        </Text>
                        <Text
                          className="text-green-700 text-[12px]"
                          style={{ fontFamily: "Peachi-Bold" }}
                        >
                          with combo
                        </Text>
                      </View>
                    );
                  }
                  return (
                    <View className="mt-0.5">
                      <PriceTag
                        basePrice={pairBase}
                        sale={sale}
                        size="sm"
                        hideBadge
                      />
                    </View>
                  );
                })()}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
