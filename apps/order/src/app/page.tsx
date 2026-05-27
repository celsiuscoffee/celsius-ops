import Image from "next/image";
import Link from "next/link";
import { Plus, ChevronRight } from "lucide-react";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getMenuData } from "@/lib/menu-data";
import { GlobalCartPill } from "./_GlobalCartPill";
import { BottomNav } from "./_BottomNav";
import { PosterCarousel } from "./_PosterCarousel";
import { HeroInfoCard } from "./_HeroInfoCard";
import { OutletRow } from "./_OutletRow";
import { ActiveChallengeCard } from "./_ActiveChallengeCard";
import { VoucherRail } from "./_VoucherRail";

/**
 * Customer home — Next.js Server Component. Plain HTML so iOS Safari
 * can collapse its URL bar on body scroll. Mirrors the SPA's home
 * structure: floating top bar over the hero, PosterCarousel,
 * dark info card overlay (Hi-name + Beans + Rewards), outlet picker,
 * Best Sellers, "Open the menu" CTA, BottomNav.
 *
 * Inner SPA routes (/product/[id], /checkout, /order/[id], /store)
 * still rewrite to the RN bundle for now — each one gets ported in
 * the same pattern as the routes already migrated (#167, #168).
 */

export const revalidate = 60;

type HomePoster = {
  id: string;
  image_url: string;
  title: string | null;
  deeplink: string | null;
};

async function fetchPosters(): Promise<HomePoster[]> {
  try {
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();
    const { data } = await supabase
      .from("splash_posters")
      .select("id, image_url, title, deeplink, starts_at, ends_at, sort_order")
      .eq("brand_id", "brand-celsius")
      .eq("active", true)
      .eq("placement", "home")
      .order("sort_order", { ascending: true, nullsFirst: false });
    if (!data) return [];
    return data
      .filter((p) => {
        if (p.starts_at && new Date(p.starts_at).toISOString() > now) return false;
        if (p.ends_at && new Date(p.ends_at).toISOString() < now) return false;
        return true;
      })
      .map((p) => ({ id: p.id, image_url: p.image_url, title: p.title, deeplink: p.deeplink }));
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const [posters, menu] = await Promise.all([fetchPosters(), getMenuData()]);
  const bestSellers = menu.products
    .filter((p) => p.isPopular && p.isAvailable)
    .sort((a, b) => (a.featuredPosition ?? 9999) - (b.featuredPosition ?? 9999))
    .slice(0, 6);

  return (
    <main className="bg-white text-[#160800] pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
      {/* Floating top bar — small wordmark + cart icon, sits over the
          hero. Same design as the SPA's home (apps/pickup-native/app/
          index.tsx:330-376). */}
      <div
        className="absolute left-4 right-4 z-10 flex items-center"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Image
          src="/icons/icon-192.png"
          alt="Celsius"
          width={28}
          height={28}
          className="rounded-md"
        />
        <div className="flex-1" />
        <Link
          href="/cart"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 active:opacity-80"
          aria-label="Cart"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#160800" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="21" r="1" />
            <circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
          </svg>
        </Link>
      </div>

      {/* Hero — carousel + info card overlay */}
      <div className="relative">
        <PosterCarousel posters={posters} />
        <HeroInfoCard />
      </div>

      {/* Outlet row — under the hero, brand voice. Client component
          reads chosen outlet from localStorage so customers see their
          outlet name instead of the placeholder. */}
      <OutletRow />

      {/* Active challenge teaser (signed-in customers with an in-
          progress mission). Mirrors apps/pickup-native/app/index.tsx
          :764-845. Renders nothing when there's no active mission. */}
      <ActiveChallengeCard />

      {/* Voucher wallet rail — signed-in customers with active vouchers
          see them as a horizontally scrolling deck of themed cards.
          Renders nothing for guests / empty wallets. */}
      <VoucherRail />

      {/* Best Sellers — card-style horizontal scroll (matching the SPA) */}
      {bestSellers.length > 0 && (
        <section className="mt-5">
          <div className="flex items-center px-4 mb-3">
            <h2 className="font-peachi font-bold text-[20px] flex-1">Best Sellers</h2>
            <Link
              href="/menu"
              className="text-[#A2492C] text-sm flex items-center gap-1 active:opacity-70"
            >
              More <ChevronRight size={14} />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3 px-4">
            {bestSellers.map((p) => (
              <Link
                key={p.id}
                href={`/product/${p.id}`}
                className="rounded-2xl bg-white border border-[#EBE5DE] overflow-hidden active:opacity-80"
                style={{ boxShadow: "0 2px 6px rgba(0,0,0,0.04)" }}
              >
                <div className="relative w-full aspect-square bg-[#F2EDE5]">
                  {p.image ? (
                    <Image
                      src={p.image}
                      alt={p.name}
                      fill
                      sizes="(max-width: 430px) 50vw, 215px"
                      className="object-cover"
                    />
                  ) : null}
                </div>
                <div className="p-3">
                  <p className="text-sm font-bold truncate">{p.name}</p>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-sm text-[#A2492C] font-bold">
                      RM{p.basePrice.toFixed(2)}
                    </span>
                    <span className="h-7 w-7 rounded-full bg-[#160800] flex items-center justify-center">
                      <Plus size={14} color="#FFFFFF" strokeWidth={2.5} />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Primary CTA */}
      <div className="mt-6 mx-4">
        <Link
          href="/menu"
          className="block w-full rounded-full bg-[#A2492C] text-white text-center py-4 font-bold active:opacity-80"
        >
          Open the menu →
        </Link>
      </div>

      <GlobalCartPill />
      <BottomNav active="home" />
    </main>
  );
}
