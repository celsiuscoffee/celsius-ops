import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getMenuData } from "@/lib/menu-data";
import { selectHomePosters } from "@/lib/poster/select-home";
import { GlobalCartPill } from "./_GlobalCartPill";
import { BottomNav } from "./_BottomNav";
import { PosterCarousel } from "./_PosterCarousel";
import { HeroInfoCard } from "./_HeroInfoCard";
import { OutletRow } from "./_OutletRow";
import { ActiveChallengeCard } from "./_ActiveChallengeCard";
import { VoucherRail } from "./_VoucherRail";
import { GuestSignInCTA } from "./_GuestSignInCTA";
import { ActiveOrderTracker } from "./_ActiveOrderTracker";
import { ExpiringRewardBanner } from "./_ExpiringRewardBanner";

/**
 * Customer home — Next.js Server Component. Plain HTML so iOS Safari
 * can collapse its URL bar on body scroll. Mirrors the SPA's home
 * structure: floating top bar over the hero, PosterCarousel,
 * dark info card overlay (Hi-name + Points + Rewards), outlet picker,
 * Best Sellers, "Open the menu" CTA, BottomNav.
 *
 * Inner SPA routes (/product/[id], /checkout, /order/[id], /store)
 * still rewrite to the RN bundle for now — each one gets ported in
 * the same pattern as the routes already migrated (#167, #168).
 */

export const revalidate = 60;

export default async function HomePage() {
  // Tight, day-part-targeted carousel — the shared selector windows by current
  // round and trims to a few high-AOV picks + a signature drink (same logic the
  // native app's /api/home-posters uses, so web + native never drift).
  const [posters, menu] = await Promise.all([selectHomePosters({ limit: 3 }), getMenuData()]);
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
          src="/images/icon-192.png"
          alt="Celsius"
          width={28}
          height={28}
          style={{ borderRadius: 6 }}
        />
        <div className="flex-1" />
        <Link
          href="/cart"
          className="flex items-center justify-center active:opacity-60"
          aria-label="Cart"
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: "rgba(255,255,255,0.92)",
            boxShadow: "0 2px 6px rgba(0,0,0,0.10)",
          }}
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

      {/* Expiring-reward urgency banner — the REDEEM half of the reward
          loop. Surfaces the soonest-expiring unused voucher above the
          fold with a one-tap "use now" (pre-applies + routes to menu).
          Renders nothing for guests / no expiring reward. */}
      <ExpiringRewardBanner />

      {/* Outlet row — under the hero, brand voice. Client component
          reads chosen outlet from localStorage so customers see their
          outlet name instead of the placeholder. */}
      <OutletRow />

      {/* Guest sign-in CTA — espresso panel with gift icon, surfaces
          for logged-out customers as the first conversion ask. Hidden
          once signed in. Mirrors apps/pickup-native/app/index.tsx
          :586-644. */}
      <GuestSignInCTA />

      {/* In-progress order banner — colored panel that links to the
          order detail page. Refreshes every 15s. */}
      <ActiveOrderTracker />

      {/* Active challenge teaser (signed-in customers with an in-
          progress mission). Mirrors apps/pickup-native/app/index.tsx
          :764-845. Renders nothing when there's no active mission. */}
      <ActiveChallengeCard />

      {/* Voucher wallet rail — signed-in customers with active vouchers
          see them as a horizontally scrolling deck of themed cards.
          Renders nothing for guests / empty wallets. */}
      <VoucherRail />

      {/* Best Sellers — horizontal scroll matching apps/pickup-native/app
          /index.tsx: w-40 compact cards, 4/5 image aspect, ChevronRight CTA.
          px-4 aligns the first card with the challenge box (mx-4) above. */}
      {bestSellers.length > 0 && (
        <section className="mt-5">
          <div className="flex items-center px-4 mb-3">
            <h2 className="font-peachi font-bold text-[18px] flex-1">Best Sellers</h2>
            <Link
              href="/menu"
              className="text-[#A2492C] text-xs font-bold flex items-center gap-0.5 active:opacity-70"
            >
              More <ChevronRight size={14} />
            </Link>
          </div>

          <div
            className="flex gap-3 overflow-x-auto px-4 pb-1"
            style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}
          >
            {bestSellers.map((p) => (
              <Link
                key={p.id}
                href={`/product/${p.id}`}
                className="flex-shrink-0 w-40 rounded-2xl bg-white overflow-hidden active:opacity-70"
                style={{
                  border: "1px solid rgba(26, 2, 0, 0.10)",
                  boxShadow: "0 3px 8px rgba(0,0,0,0.06)",
                  scrollSnapAlign: "start",
                }}
              >
                <div className="relative w-full bg-white" style={{ aspectRatio: "4 / 5" }}>
                  {p.image ? (
                    <Image
                      src={p.image}
                      alt={p.name}
                      fill
                      sizes="160px"
                      className="object-cover"
                    />
                  ) : null}
                </div>
                <div className="px-3 py-2.5">
                  <p className="font-peachi font-bold text-[13px] text-[#160800] truncate">{p.name}</p>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="font-peachi font-bold text-[14px] text-[#A2492C]">
                      RM{p.basePrice.toFixed(2)}
                    </span>
                    <span
                      className="rounded-full bg-[#160800] flex items-center justify-center"
                      style={{ width: 24, height: 24 }}
                    >
                      <ChevronRight size={14} color="#FFFFFF" />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <GlobalCartPill />
      <BottomNav active="home" />
    </main>
  );
}
