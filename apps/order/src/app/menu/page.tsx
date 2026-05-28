import { Plus, Star, Coffee, Leaf, Cake, Cookie, Sandwich, Candy, CupSoda, Cherry, Sparkles, Croissant, Wheat, UtensilsCrossed, Utensils, FlaskConical } from "lucide-react";
import { getMenuData } from "@/lib/menu-data";
import { GlobalCartPill } from "../_GlobalCartPill";
import { BottomNav } from "../_BottomNav";
import { MenuColumns } from "./_MenuColumns";
import { ReservedVoucherBanner } from "./_ReservedVoucherBanner";
import { OutletGate } from "./_OutletGate";
import { OutletPickerRow } from "./_OutletPickerRow";

/**
 * Customer menu — Next.js Server Component. Mirrors the SPA's
 * two-column layout: 60-80px sidebar with category pills (icon +
 * label) + scroll-spy'd product list that highlights the active
 * section as the customer scrolls. Plain HTML so iOS Safari's URL
 * bar collapses on body scroll.
 *
 * Categories ship with the same icon mapping as
 * apps/pickup-native/app/menu.tsx CAT_ICON so the sidebar looks
 * identical across the two surfaces.
 */

export const revalidate = 60;

const HIDDEN_CATEGORIES = new Set(["bottles"]);
const BEST_SELLERS_ID = "__best_sellers__";

// Same mapping as the SPA's CAT_ICON. Categories without an explicit
// entry fall back to the coffee glyph.
const CAT_ICON: Record<string, string> = {
  "artisan-choc":   "candy",
  "artisan-matcha": "leaf",
  cakes:            "cake",
  classic:          "coffee",
  cookies:          "cookie",
  croissant:        "croissant",
  flavoured:        "flask",
  fries:            "utensils",
  "fruit-tea":      "cherry",
  "gourmet-tea":    "sparkles",
  mocha:            "coffee",
  mocktails:        "cup-soda",
  "nasi-lemak":     "utensils-crossed",
  noodle:           "utensils-crossed",
  pasta:            "utensils-crossed",
  "roti-bakar":     "wheat",
  sandwiches:       "sandwich",
};

export default async function MenuPage() {
  const menu = await getMenuData();

  const visibleCats = menu.categories
    .filter((c) => !HIDDEN_CATEGORIES.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, icon: CAT_ICON[c.id] ?? "coffee" }));

  const bestSellers = menu.products
    .filter((p) => p.isPopular && p.isAvailable && !HIDDEN_CATEGORIES.has(p.categoryId))
    .sort((a, b) => (a.featuredPosition ?? 9999) - (b.featuredPosition ?? 9999));

  const productsByCat: Record<string, typeof menu.products> = {};
  for (const p of menu.products) {
    if (!p.isAvailable) continue;
    if (HIDDEN_CATEGORIES.has(p.categoryId)) continue;
    (productsByCat[p.categoryId] ??= []).push(p);
  }

  const sections = [
    ...(bestSellers.length > 0
      ? [{ id: BEST_SELLERS_ID, label: "Best Sellers", products: bestSellers, icon: "star" }]
      : []),
    ...visibleCats
      .map((c) => ({ id: c.id, label: c.name, products: productsByCat[c.id] ?? [], icon: c.icon }))
      .filter((s) => s.products.length > 0),
  ];

  return (
    <main className="bg-white text-[#160800] pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
      <OutletGate />
      {/* MenuColumns owns the sticky header (with the search toggle),
          so the outlet picker + reserved-voucher banner are passed in
          as children to render directly beneath it. */}
      <MenuColumns
        sections={sections}
        allProducts={menu.products.filter(
          (p) => p.isAvailable && !HIDDEN_CATEGORIES.has(p.categoryId),
        )}
      >
        <OutletPickerRow />
        <ReservedVoucherBanner />
      </MenuColumns>
      <GlobalCartPill />
      <BottomNav active="menu" />
    </main>
  );
}

// Re-export icon components for the client _MenuColumns to use without
// pulling lucide-react itself (so the client bundle is leaner). Not
// strictly needed — leaving here as a placeholder if we trim later.
export {
  Star,
  Coffee,
  Leaf,
  Cake,
  Cookie,
  Sandwich,
  Candy,
  CupSoda,
  Cherry,
  Sparkles,
  Croissant,
  Wheat,
  UtensilsCrossed,
  Utensils,
  FlaskConical,
  Plus,
};
