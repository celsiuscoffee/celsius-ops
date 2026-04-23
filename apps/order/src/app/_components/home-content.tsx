"use client";

import Link from "next/link";
import { MapPin, Clock, ChevronRight, ChevronDown, ShoppingCart, Coffee, Navigation } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CelsiusLogo } from "@/components/celsius-logo";
import { ProductImage } from "@/components/product-image";
import { BottomNav } from "@/components/bottom-nav";
import { useCartStore } from "@/store/cart";
import type { Product } from "@/lib/types";
import type { PromoBanner } from "@/lib/supabase/types";

interface HomeContentProps {
  featuredProducts: Product[];
  promoBanner:      PromoBanner;
  campaignBgUrl:    string | null;
}

export function HomeContent({ featuredProducts, promoBanner, campaignBgUrl }: HomeContentProps) {
  const hasHydrated = useCartStore((s) => s._hasHydrated);
  const _selectedStore = useCartStore((s) => s.selectedStore);
  const _itemCount = useCartStore((s) => s.getItemCount());

  // Use server-safe defaults until Zustand rehydrates from localStorage
  const selectedStore = hasHydrated ? _selectedStore : null;
  const itemCount = hasHydrated ? _itemCount : 0;

  // If the cart has items, the "Order Now" CTAs jump straight to checkout
  // flow so a half-built order isn't abandoned by starting a new one.
  const orderHref = itemCount > 0
    ? "/cart"
    : selectedStore ? `/menu?store=${selectedStore.id}` : "/store";

  return (
    <div className="flex flex-col min-h-dvh bg-[#f5f5f5]">
      {/* Header */}
      <header className="bg-[#160800] text-white px-4 pb-5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}>
        <div className="flex items-center justify-between">
          <div>
            <CelsiusLogo variant="white" size="md" />
            <p className="text-[10px] text-white/50 mt-0.5 tracking-wide">Pickup only · Order ahead</p>
          </div>
          <Link href="/cart" className="relative p-1">
            <ShoppingCart className="h-6 w-6 text-white/80" />
            {itemCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-white text-primary text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {itemCount}
              </span>
            )}
          </Link>
        </div>

        {/* Store selector in header */}
        <Link href="/store" className="flex items-center gap-1.5 mt-4">
          <MapPin className="h-3.5 w-3.5 text-white/70 shrink-0" />
          <span className="text-sm font-semibold text-white">
            {selectedStore?.name ?? "Select pickup outlet"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-white/70" />
          {selectedStore?.isBusy && (
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0 ml-auto">
              Busy
            </Badge>
          )}
        </Link>
      </header>

      <main className="flex-1 space-y-4 pb-20">
        {/* Hero — campaign poster takes priority, falls back to text promo banner */}
        {campaignBgUrl ? (
          <Link href={selectedStore ? `/menu?store=${selectedStore.id}` : "/store"} className="block relative w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={campaignBgUrl}
              alt="Campaign"
              className="w-full object-cover"
              style={{ maxHeight: "60vw" }}
            />
          </Link>
        ) : promoBanner.enabled && (
          <div className="bg-gradient-to-br from-[#160800] via-[#2a1200] to-[#3d1f00] mx-0 relative overflow-hidden">
            <div className="px-5 pt-6 pb-7">
              <p className="text-[10px] font-bold text-amber-400/80 uppercase tracking-widest">
                {promoBanner.label}
              </p>
              <div className="flex items-end gap-3 mt-1">
                <p className="text-5xl font-black font-display text-white leading-none">
                  {promoBanner.headline}<br />
                  <span className="text-amber-400">{promoBanner.highlight}</span>
                </p>
                <svg
                  viewBox="0 0 48 48"
                  className="w-14 h-14 mb-1 opacity-90 shrink-0"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <ellipse cx="24" cy="40" rx="12" ry="4" fill="#ffffff18" />
                  <rect x="10" y="18" width="28" height="18" rx="10" fill="white" fillOpacity="0.18" />
                  <rect x="10" y="18" width="28" height="18" rx="10" stroke="white" strokeOpacity="0.5" strokeWidth="1.5" />
                  <rect x="16" y="14" width="16" height="6" rx="3" fill="white" fillOpacity="0.25" stroke="white" strokeOpacity="0.4" strokeWidth="1" />
                  <path d="M38 22 Q44 22 44 27 Q44 32 38 32" stroke="white" strokeOpacity="0.5" strokeWidth="1.5" strokeLinecap="round" fill="none" />
                  <path d="M19 10 Q21 7 23 10 Q25 13 27 10 Q29 7 31 10" stroke="#FBBF24" strokeOpacity="0.7" strokeWidth="1.2" strokeLinecap="round" fill="none" />
                </svg>
              </div>
              <p className="text-sm text-white/60 mt-2">{promoBanner.description}</p>
              <Link
                href={orderHref}
                className="inline-flex items-center gap-1.5 mt-4 bg-white text-primary rounded-full px-5 py-2.5 text-sm font-bold shadow-lg"
              >
                Order Now <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="absolute -right-8 -top-8 w-44 h-44 rounded-full bg-white/5" />
            <div className="absolute -right-4 -bottom-12 w-36 h-36 rounded-full bg-amber-400/5" />
            <div className="absolute right-16 top-4 w-20 h-20 rounded-full bg-white/3" />
          </div>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-3 px-4">
          <Link href={orderHref} className="block h-full">
            <Card className="p-4 flex flex-col gap-2.5 border border-border/60 shadow-sm bg-white hover:shadow-md hover:border-primary/20 transition-all active:scale-[0.98] h-full">
              <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center">
                <Coffee className="h-5 w-5 text-primary" strokeWidth={1.5} />
              </div>
              <div>
                <p className="font-bold text-sm">{itemCount > 0 ? "Review Cart" : "Order Now"}</p>
                <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                  {itemCount > 0 ? `${itemCount} item${itemCount === 1 ? "" : "s"} waiting` : "Browse full menu"}
                </p>
              </div>
            </Card>
          </Link>
          <Link href="/store" className="block h-full">
            <Card className="p-4 flex flex-col gap-2.5 border border-border/60 shadow-sm bg-white hover:shadow-md hover:border-primary/20 transition-all active:scale-[0.98] h-full">
              <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center">
                <Navigation className="h-5 w-5 text-primary" strokeWidth={1.5} />
              </div>
              <div>
                <p className="font-bold text-sm">Our Outlets</p>
                <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                  Shah Alam · Conezion · Tamarind
                </p>
              </div>
            </Card>
          </Link>
        </div>

        {/* Best Sellers — horizontal scroll */}
        <section className="px-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-black text-base">Best Sellers</h2>
            <Link
              href={selectedStore ? `/menu?store=${selectedStore.id}` : "/store"}
              className="text-xs text-primary font-semibold flex items-center gap-0.5"
            >
              More <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide -mx-4 px-4">
            {featuredProducts.map((product) => (
              <Link
                key={product.id}
                href={
                  selectedStore
                    ? `/menu/${product.id}?store=${selectedStore.id}`
                    : "/store"
                }
                className="shrink-0 w-40"
              >
                <Card className="overflow-hidden border border-border/60 shadow-sm bg-white hover:shadow-md transition-shadow active:scale-[0.98] rounded-3xl">
                  <div className="aspect-[3/4] bg-[#f5f5f5] relative">
                    <ProductImage
                      src={product.image}
                      alt={product.name}
                      fill
                      sizes="160px"
                      thumbnailWidth={160}
                      fit="cover"
                      priority
                    />
                    {product.isNew && (
                      <Badge className="absolute top-2 left-2 text-[9px] px-1.5 py-0 bg-green-600 rounded-sm">
                        NEW
                      </Badge>
                    )}
                    {product.isPopular && !product.isNew && (
                      <div className="absolute top-2 left-2 bg-primary text-white text-[9px] font-bold px-1.5 py-0.5 rounded-sm">
                        Popular
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="font-bold text-[13px] leading-tight line-clamp-2 min-h-[32px]">
                      {product.name}
                    </p>
                    <p className="text-primary font-black text-sm mt-1.5">
                      RM {product.basePrice.toFixed(2)}
                    </p>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>

        {/* Outlet info strip */}
        {selectedStore && (
          <div className="mx-4">
            <Card className="p-3.5 flex items-center gap-3 border border-border/60 shadow-sm bg-white">
              <div className="bg-primary/10 rounded-full p-2">
                <MapPin className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm leading-tight">{selectedStore.name}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Clock className="h-3 w-3" />
                  Ready in {selectedStore.pickupTime}
                </p>
              </div>
              <Link href="/store">
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            </Card>
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
