"use client";

import { memo, useRef, useState } from "react";
import { Coffee, CupSoda, Cake, UtensilsCrossed, Sandwich, Cookie, Croissant, Salad, IceCream, Soup } from "lucide-react";
import type { Product } from "@/types/database";
import { displayRM } from "@/types/database";

type Props = {
  products: Product[];
  onProductTap: (product: Product) => void;
  onToggleAvailability?: (product: Product) => void;
  cartCounts?: Record<string, number>;
  columns?: number;
};

const GRID_CLASSES: Record<number, string> = {
  3: "grid-cols-3", 4: "grid-cols-4", 5: "grid-cols-5",
  6: "grid-cols-6", 7: "grid-cols-7", 8: "grid-cols-8",
};

function CategoryIcon({ category }: { category: string | null }) {
  const cls = "h-8 w-8 text-text-dim";
  const cat = category ?? "";

  if (cat.includes("coffee") || cat.includes("classic") || cat.includes("flavoured") || cat.includes("mocha"))
    return <Coffee className={cls} />;
  if (cat.includes("tea"))
    return <CupSoda className={cls} />;
  if (cat.includes("cake"))
    return <Cake className={cls} />;
  if (cat.includes("cookie"))
    return <Cookie className={cls} />;
  if (cat.includes("croissant"))
    return <Croissant className={cls} />;
  if (cat.includes("sandwich"))
    return <Sandwich className={cls} />;
  if (cat.includes("pasta") || cat.includes("noodle"))
    return <Soup className={cls} />;
  if (cat.includes("fries") || cat.includes("nasi"))
    return <UtensilsCrossed className={cls} />;
  if (cat.includes("mocktail") || cat.includes("fruit"))
    return <IceCream className={cls} />;
  if (cat.includes("matcha"))
    return <CupSoda className={cls} />;
  if (cat.includes("roti") || cat.includes("bakar"))
    return <Sandwich className={cls} />;
  if (cat.includes("salad"))
    return <Salad className={cls} />;

  return <UtensilsCrossed className={cls} />;
}

export const ProductGrid = memo(function ProductGrid({ products, onProductTap, onToggleAvailability, cartCounts = {}, columns = 6 }: Props) {
  const [contextMenu, setContextMenu] = useState<{ product: Product; x: number; y: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (products.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">
        No products found
      </div>
    );
  }

  const gridClass = GRID_CLASSES[columns] ?? "grid-cols-6";

  function handlePointerDown(product: Product, e: React.PointerEvent) {
    longPressTimer.current = setTimeout(() => {
      setContextMenu({ product, x: e.clientX, y: e.clientY });
    }, 600);
  }

  function handlePointerUp() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  return (
    <>
      <div className={`grid ${gridClass} gap-1.5`}>
        {products.map((product) => (
          <button
            key={product.id}
            onClick={() => product.is_available && onProductTap(product)}
            onPointerDown={(e) => handlePointerDown(product, e)}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onContextMenu={(e) => { e.preventDefault(); setContextMenu({ product, x: e.clientX, y: e.clientY }); }}
            className={`relative flex flex-col rounded-lg border text-left transition-all active:scale-[0.97] ${
              product.is_available
                ? "border-border bg-surface-raised hover:border-brand"
                : "border-danger/30 bg-surface-alt"
            }`}
          >
            {/* Cart count badge */}
            {cartCounts[product.id] > 0 && product.is_available && (
              <div className="absolute right-1 top-1 z-10 flex h-6 min-w-6 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-bold text-white shadow">
                {cartCounts[product.id]}
              </div>
            )}
            {!product.is_available && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-black/60">
                <span className="rounded-full bg-danger px-3 py-1 text-xs font-bold text-white">SOLD OUT</span>
              </div>
            )}

            {product.image_url ? (
              <div className="aspect-[4/3] w-full overflow-hidden rounded-t-lg bg-surface-alt">
                <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" loading="lazy" />
              </div>
            ) : (
              <div className="flex aspect-[4/3] w-full items-center justify-center rounded-t-lg bg-surface-alt">
                <CategoryIcon category={product.category} />
              </div>
            )}
            <div className="px-2 py-1.5">
              <p className="text-xs font-medium leading-tight line-clamp-2">{product.name}</p>
              <p className="text-xs font-bold text-brand">{displayRM(product.price)}</p>
            </div>
          </button>
        ))}
      </div>

      {contextMenu && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 w-48 rounded-lg border border-border bg-surface-raised py-1 shadow-xl"
            style={{ left: Math.min(contextMenu.x, window.innerWidth - 200), top: Math.min(contextMenu.y, window.innerHeight - 120) }}
          >
            <div className="border-b border-border px-3 py-1.5">
              <p className="text-xs font-semibold">{contextMenu.product.name}</p>
              <p className="text-xs text-text-muted">{displayRM(contextMenu.product.price)}</p>
            </div>
            <button
              onClick={() => { if (onToggleAvailability) onToggleAvailability(contextMenu.product); setContextMenu(null); }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-medium hover:bg-surface-hover"
            >
              {contextMenu.product.is_available ? (
                <><span className="h-2 w-2 rounded-full bg-danger" /><span className="text-danger">Mark as Sold Out (86)</span></>
              ) : (
                <><span className="h-2 w-2 rounded-full bg-success" /><span className="text-success">Mark as Available</span></>
              )}
            </button>
          </div>
        </>
      )}
    </>
  );
});
