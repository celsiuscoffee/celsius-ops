import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ShoppingCart, MapPin, ChevronDown, Plus } from "lucide-react";
import { getMenuData } from "@/lib/menu-data";
import { GlobalCartPill } from "../_GlobalCartPill";
import { BottomNav } from "../_BottomNav";

/**
 * Customer menu — Next.js Server Component, plain HTML so iOS Safari's
 * URL bar collapses on body scroll. Replaces the SPA's /menu render.
 *
 * Layout simplifies the SPA's two-column (sidebar pills + product
 * list) to a single column with category sections — fits a mobile
 * browser viewport better and matches GrabFood / Foodpanda's mobile
 * pattern. Tapping a product card drops into the SPA at /product/[id]
 * for modifier selection (the product detail flow is a follow-up
 * Next.js rebuild).
 */

export const revalidate = 60;

const HIDDEN_CATEGORIES = new Set(["bottles"]);

export default async function MenuPage() {
  const menu = await getMenuData();

  const visibleCats = menu.categories.filter((c) => !HIDDEN_CATEGORIES.has(c.id));
  const bestSellers = menu.products
    .filter((p) => p.isPopular && p.isAvailable && !HIDDEN_CATEGORIES.has(p.categoryId))
    .sort((a, b) => (a.featuredPosition ?? 9999) - (b.featuredPosition ?? 9999));

  const productsByCat: Record<string, typeof menu.products> = {};
  for (const p of menu.products) {
    if (!p.isAvailable) continue;
    if (HIDDEN_CATEGORIES.has(p.categoryId)) continue;
    (productsByCat[p.categoryId] ??= []).push(p);
  }

  return (
    <main className="bg-white text-[#160800] pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
      <Header />

      <OutletPickerRow />

      {/* Best Sellers — pinned section at the top */}
      {bestSellers.length > 0 && (
        <section className="mt-2 px-4 pt-4">
          <h2
            className="text-[20px] mb-3"
            style={{ fontFamily: "Peachi-Bold, serif", letterSpacing: -0.3, fontWeight: 700 }}
          >
            Best Sellers
          </h2>
          <ProductList products={bestSellers.slice(0, 12)} />
        </section>
      )}

      {/* Each visible category as its own section */}
      {visibleCats.map((cat) => {
        const items = productsByCat[cat.id] ?? [];
        if (items.length === 0) return null;
        return (
          <section key={cat.id} className="mt-6 px-4">
            <h2
              className="text-[20px] mb-3"
              style={{ fontFamily: "Peachi-Bold, serif", letterSpacing: -0.3, fontWeight: 700 }}
            >
              {cat.name}
            </h2>
            <ProductList products={items} />
          </section>
        );
      })}

      <GlobalCartPill />
      <BottomNav active="menu" />
    </main>
  );
}

function Header() {
  return (
    <header
      className="bg-[#160800] text-white px-4 pb-3 flex items-center gap-3"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
    >
      <Link href="/" className="-ml-1 p-1 active:opacity-60" aria-label="Back to home">
        <ArrowLeft size={20} color="#FFFFFF" />
      </Link>
      <h1
        className="flex-1 text-[22px] truncate"
        style={{ fontFamily: "Peachi-Bold, serif", letterSpacing: -0.3, fontWeight: 700 }}
      >
        Pickup
      </h1>
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
      <ChevronDown size={14} className="text-[#8E8E93]" />
    </Link>
  );
}

function ProductList({
  products,
}: {
  products: Array<{
    id: string;
    name: string;
    description?: string;
    basePrice: number;
    image: string;
  }>;
}) {
  return (
    <ul className="flex flex-col gap-3">
      {products.map((p) => (
        <li key={p.id}>
          <Link
            href={`/product/${p.id}`}
            className="block bg-white rounded-2xl border border-[#EBE5DE] active:opacity-80"
            style={{
              boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
            }}
          >
            <div className="flex items-center gap-3 p-3">
              <div className="relative w-[72px] h-[72px] flex-shrink-0 rounded-xl overflow-hidden bg-[#F2EDE5]">
                {p.image ? (
                  <Image
                    src={p.image}
                    alt={p.name}
                    fill
                    sizes="72px"
                    className="object-cover"
                  />
                ) : null}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate">{p.name}</p>
                {p.description ? (
                  <p className="text-[11px] text-[#6E6E73] mt-0.5 line-clamp-2">
                    {p.description}
                  </p>
                ) : null}
                <p className="mt-1 text-sm text-[#A2492C] font-bold">
                  RM{p.basePrice.toFixed(2)}
                </p>
              </div>
              <span className="h-9 w-9 rounded-full bg-[#160800] flex items-center justify-center flex-shrink-0">
                <Plus size={16} color="#FFFFFF" strokeWidth={2.5} />
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
