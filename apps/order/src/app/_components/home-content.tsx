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

interface HomeContentProps {
  featuredProducts: Product[];
  campaignBgUrl:    string | null;
}

export function HomeContent({ featuredProducts, campaignBgUrl }: HomeContentProps) {
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
        {/* Hero — campaign poster from app_settings.campaign_bg. The
            text-only promo-banner fallback was retired in favor of
            full-bleed splash photos managed via the splash-poster
            flow (see SplashPoster + app_settings.splash_poster). */}
        {campaignBgUrl && (
          <Link href={selectedStore ? `/menu?store=${selectedStore.id}` : "/store"} className="block relative w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={campaignBgUrl}
              alt="Campaign"
              className="w-full object-cover"
              style={{ maxHeight: "60vw" }}
            />
          </Link>
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
