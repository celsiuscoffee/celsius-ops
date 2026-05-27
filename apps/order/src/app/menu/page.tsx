import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ShoppingCart, MapPin, ChevronRight, Plus, Star, Coffee, Leaf, Cake, Cookie, Sandwich, Candy, CupSoda, Cherry, Sparkles, Croissant, Wheat, UtensilsCrossed, Utensils, FlaskConical } from "lucide-react";
import { getMenuData } from "@/lib/menu-data";
import { GlobalCartPill } from "../_GlobalCartPill";
import { BottomNav } from "../_BottomNav";
import { MenuColumns } from "./_MenuColumns";

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
      <Header />
      <OutletPickerRow />
      {/* Pass the complete (visible) product set too so MenuColumns
          can resolve the customer's recent-item IDs (fetched client-
          side via /api/loyalty/recent-items) back to full Product
          records — same hydration the SPA's menu does for its
          "Usual" pill. */}
      <MenuColumns
        sections={sections}
        allProducts={menu.products.filter(
          (p) => p.isAvailable && !HIDDEN_CATEGORIES.has(p.categoryId),
        )}
      />
      <GlobalCartPill />
      <BottomNav active="menu" />
    </main>
  );
}

function Header() {
  return (
    <header
      className="bg-[#160800] text-white px-4 pb-3 flex items-center gap-3 sticky top-0 z-10"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
    >
      <Link href="/" className="-ml-1 p-1 active:opacity-60" aria-label="Back to home">
        <ArrowLeft size={20} color="#FFFFFF" />
      </Link>
      <h1 className="flex-1 font-peachi font-bold text-[22px] truncate">Pickup</h1>
      <Link href="/cart" className="p-1 active:opacity-60" aria-label="Cart">
        <ShoppingCart size={20} color="rgba(255,255,255,0.85)" />
      </Link>
    </header>
  );
}

function OutletPickerRow() {
  return (
    <Link
      href="/store"
      className="flex items-center gap-2 bg-[#F7F4F0] border-b border-[#E8E1D8] px-4 py-2 active:opacity-70"
    >
      <MapPin size={14} className="text-[#A2492C]" />
      <span className="text-sm font-bold flex-1 truncate">Select outlet</span>
      <ChevronRight size={14} className="text-[#8E8E93]" />
    </Link>
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
