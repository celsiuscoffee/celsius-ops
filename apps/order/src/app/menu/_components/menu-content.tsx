"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, Search, ShoppingCart, ChevronDown, X, Coffee, Leaf, Cake, Cookie, Croissant, Sandwich, Candy, CupSoda, Cherry, Sparkles, Wheat, UtensilsCrossed, Utensils, FlaskConical, MapPin, Star, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ProductImage } from "@/components/product-image";
import { BottomNav } from "@/components/bottom-nav";
import { useCartStore } from "@/store/cart";
import type { Product, Category } from "@/lib/types";
import type { LucideIcon } from "lucide-react";

const BEST_SELLERS_ID = "__best_sellers__";

const CAT_ICON: Record<string, LucideIcon> = {
  "artisan-choc": Candy,
  "artisan-matcha": Leaf,
  "cakes": Cake,
  "classic": Coffee,
  "cookies": Cookie,
  "croissant": Croissant,
  "flavoured": FlaskConical,
  "fries": Utensils,
  "fruit-tea": Cherry,
  "gourmet-tea": Sparkles,
  "mocha": Coffee,
  "mocktails": CupSoda,
  "nasi-lemak": UtensilsCrossed,
  "noodle": UtensilsCrossed,
  "pasta": UtensilsCrossed,
  "roti-bakar": Wheat,
  "sandwiches": Sandwich,
};

const HIDDEN_CATEGORIES = new Set(["bottles"]);

interface MenuContentProps {
  products: Product[];
  categories: Category[];
}

export function MenuContent({ products, categories }: MenuContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const storeId = searchParams.get("store");
  const visibleCategories = categories
    .filter((c) => !HIDDEN_CATEGORIES.has(c.id));
  const bestSellers = products.filter((p) => p.isPopular);
  const hasBestSellers = bestSellers.length > 0;
  const defaultCategory = hasBestSellers ? BEST_SELLERS_ID : (visibleCategories[0]?.id ?? "");
  const [activeCategory, setActiveCategory] = useState(defaultCategory);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [addedItems, setAddedItems] = useState<Record<string, boolean>>({});
  const selectedStore = useCartStore((s) => s.selectedStore);
  const itemCount = useCartStore((s) => s.getItemCount());
  const total = useCartStore((s) => s.getTotal());
  const addItem = useCartStore((s) => s.addItem);

  const filteredProducts = searchQuery
    ? products.filter((p) =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : activeCategory === BEST_SELLERS_ID
    ? products.filter((p) => p.isPopular)
    : products.filter((p) => p.categoryId === activeCategory);

  function handleAddSimple(e: React.MouseEvent, product: Product) {
    e.preventDefault();
    e.stopPropagation();
    addItem(product, { selections: [], specialInstructions: "" });
    setAddedItems((prev) => ({ ...prev, [product.id]: true }));
    setTimeout(() => setAddedItems((prev) => ({ ...prev, [product.id]: false })), 1000);
  }

  return (
    <div className="flex flex-col h-dvh bg-background">
      {/* Header */}
      <header className="bg-white border-b shrink-0 z-10 shadow-sm">
        {/* Row 1: Pickup title + search + cart */}
        <div className="flex items-center gap-3 px-4 pt-12 pb-2">
          {searchOpen ? (
            <div className="flex-1 flex items-center gap-2 bg-muted rounded-full px-3 py-1.5">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                autoFocus
                type="text"
                placeholder="Search menu…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")}>
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>
          ) : (
            <h1 className="text-2xl font-black font-display flex-1 text-[#160800]">Pickup</h1>
          )}

          <button
            onClick={() => { setSearchOpen((v) => !v); if (searchOpen) setSearchQuery(""); }}
            className="p-1"
          >
            {searchOpen
              ? <span className="text-sm font-medium text-primary">Cancel</span>
              : <Search className="h-5 w-5 text-muted-foreground" />}
          </button>

          <Link href="/cart" className="p-1 relative">
            <ShoppingCart className="h-5 w-5" />
            {itemCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-primary text-primary-foreground text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {itemCount}
              </span>
            )}
          </Link>
        </div>

        {/* Row 2: Outlet selector */}
        <Link href="/store" className="flex items-center gap-2 px-4 pb-3">
          <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="font-semibold text-sm truncate flex-1">
            {selectedStore?.name ?? "Select outlet"}
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          {selectedStore && (
            <span className={`text-[11px] font-medium shrink-0 ${selectedStore.isBusy ? "text-amber-600" : "text-emerald-600"}`}>
              {selectedStore.isBusy ? "Busy" : selectedStore.pickupTime}
            </span>
          )}
        </Link>
      </header>

      {/* Body: sidebar + product list */}
      <div className="flex flex-1 overflow-hidden">
        {/* Category Sidebar */}
        {!searchQuery && (
          <nav className="w-[80px] shrink-0 bg-muted/40 border-r overflow-y-auto pb-14">
            {hasBestSellers && (() => {
              const isActive = activeCategory === BEST_SELLERS_ID;
              return (
                <button
                  key={BEST_SELLERS_ID}
                  onClick={() => setActiveCategory(BEST_SELLERS_ID)}
                  className={`w-full py-3.5 px-1 flex flex-col items-center gap-1.5 border-l-[3px] transition-colors ${
                    isActive ? "border-primary bg-white" : "border-transparent"
                  }`}
                >
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
                      isActive ? "bg-primary/10" : "bg-muted/40"
                    }`}
                  >
                    <Star className={`h-5 w-5 ${isActive ? "text-primary fill-primary" : "text-muted-foreground"}`} strokeWidth={1.5} />
                  </div>
                  <span
                    className={`text-[10px] leading-tight text-center line-clamp-2 font-medium ${
                      isActive ? "text-primary font-semibold" : "text-muted-foreground"
                    }`}
                  >
                    Best Sellers
                  </span>
                </button>
              );
            })()}
            {visibleCategories.map((cat) => {
              const isActive = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`w-full py-3.5 px-1 flex flex-col items-center gap-1.5 border-l-[3px] transition-colors ${
                    isActive
                      ? "border-primary bg-white"
                      : "border-transparent"
                  }`}
                >
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
                      isActive ? "bg-primary/10" : "bg-muted/40"
                    }`}
                  >
                    {(() => { const Icon = CAT_ICON[cat.id] ?? Coffee; return <Icon className={`h-5 w-5 ${isActive ? "text-primary" : "text-muted-foreground"}`} strokeWidth={1.5} />; })()}
                  </div>
                  <span
                    className={`text-[10px] leading-tight text-center line-clamp-2 font-medium ${
                      isActive ? "text-primary font-semibold" : "text-muted-foreground"
                    }`}
                  >
                    {cat.name}
                  </span>
                </button>
              );
            })}
          </nav>
        )}

        {/* Product List */}
        <main className="flex-1 overflow-y-auto">
          {searchQuery && (
            <p className="text-xs text-muted-foreground px-4 pt-3 pb-1">
              {filteredProducts.length} result{filteredProducts.length !== 1 ? "s" : ""} for &ldquo;{searchQuery}&rdquo;
            </p>
          )}

          {/* Category header */}
          {!searchQuery && (
            <div className="px-4 pt-3 pb-2 border-b bg-white/60">
              <p className="font-bold text-sm">
                {activeCategory === BEST_SELLERS_ID
                  ? "Best Sellers"
                  : visibleCategories.find((c) => c.id === activeCategory)?.name}
              </p>
            </div>
          )}

          <div className="divide-y">
            {filteredProducts.map((product, idx) => {
              const isSimple = product.variants.length === 0 && product.modifierGroups.length === 0;
              const wasAdded = addedItems[product.id] ?? false;

              const thumbnail = (
                <div className="w-[88px] h-[88px] rounded-3xl bg-muted shrink-0 relative overflow-hidden">
                  <div
                    className="absolute inset-0"
                    style={{ transform: `scale(${(product.imageZoom ?? 100) / 100})`, transformOrigin: "center" }}
                  >
                  <ProductImage
                    src={product.image}
                    alt={product.name}
                    fill
                    sizes="88px"
                    priority={idx < 4}
                    thumbnailWidth={88}
                    fit="cover"
                  />
                  </div>
                  {product.isNew && (
                    <Badge className="absolute top-1 left-1 text-[9px] px-1 py-0 bg-green-600 rounded-sm">
                      NEW
                    </Badge>
                  )}
                  {!product.isAvailable && (
                    <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                      <span className="text-[10px] font-bold text-muted-foreground rotate-[-20deg]">
                        SOLD OUT
                      </span>
                    </div>
                  )}
                </div>
              );

              const info = (
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`font-semibold text-[15px] leading-snug ${!product.isAvailable ? "text-muted-foreground" : ""}`}>
                      {product.name}
                    </p>
                    {product.isPopular && !product.isNew && (
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0 rounded-sm">
                        Popular
                      </Badge>
                    )}
                  </div>
                  {product.description && (
                    <p className="text-[13px] text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                      {product.description}
                    </p>
                  )}
                  {product.isAvailable ? (
                    <p className="text-primary font-bold text-[15px] mt-1.5">
                      RM {product.basePrice.toFixed(2)}
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-xs mt-1.5">Unavailable</p>
                  )}
                </div>
              );

              if (isSimple) {
                return (
                  <Link
                    key={product.id}
                    href={`/menu/${product.id}?store=${storeId || selectedStore?.id || ""}`}
                    className="flex items-start gap-3.5 px-4 py-4 hover:bg-muted/30 transition-colors active:bg-muted/50"
                  >
                    {thumbnail}
                    {info}
                    {product.isAvailable && (
                      <div className="shrink-0 mt-auto">
                        <button
                          onClick={(e) => handleAddSimple(e, product)}
                          className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shadow-sm transition-colors active:bg-primary/80"
                          aria-label={`Add ${product.name} to cart`}
                        >
                          {wasAdded
                            ? <Check className="h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
                            : <span className="text-primary-foreground text-lg font-bold leading-none">+</span>
                          }
                        </button>
                      </div>
                    )}
                  </Link>
                );
              }

              return (
                <Link
                  key={product.id}
                  href={`/menu/${product.id}?store=${storeId || selectedStore?.id || ""}`}
                  className="flex items-start gap-3.5 px-4 py-4 hover:bg-muted/30 transition-colors active:bg-muted/50"
                >
                  {thumbnail}
                  {info}
                  {product.isAvailable && (
                    <div className="shrink-0 mt-auto">
                      <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shadow-sm">
                        <span className="text-primary-foreground text-lg font-bold leading-none">+</span>
                      </div>
                    </div>
                  )}
                </Link>
              );
            })}
          </div>

          {filteredProducts.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-sm">No drinks found</p>
            </div>
          )}

          {/* Bottom padding — always enough for bottom nav, more for floating cart button */}
          <div className={itemCount > 0 ? "h-32" : "h-20"} />
        </main>
      </div>

      {/* Floating Cart Button — sits above bottom nav */}
      {itemCount > 0 && (
        <Link
          href="/cart"
          className="fixed bottom-16 right-4 bg-primary text-primary-foreground rounded-full px-4 py-2.5 flex items-center gap-2 shadow-lg z-20"
        >
          <ShoppingCart className="h-4 w-4" />
          <span className="text-sm font-semibold">
            {itemCount} item{itemCount > 1 ? "s" : ""} · RM {total.toFixed(2)}
          </span>
        </Link>
      )}

      <BottomNav />
    </div>
  );
}
