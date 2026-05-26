"use client";

import type { ProductCategory } from "@/types/database";

type Props = {
  categories: ProductCategory[];
  active: string;
  onChange: (slug: string) => void;
  layoutColors?: Record<string, string>;
};

const DEFAULT_COLORS: Record<string, string> = {
  all:            "#4A4A4A",
  popular:        "#D4A843",
  classic:        "#8B6914",
  flavoured:      "#C0507E",
  mocha:          "#6B3A2A",
  "artisan-choc": "#5C3317",
  "artisan-matcha":"#3A7D44",
  cakes:          "#7B5EA7",
  cookies:        "#D4792C",
  croissant:      "#B8860B",
  fries:          "#CC3333",
  "fruit-tea":    "#E06B75",
  "gourmet-tea":  "#2E8B57",
  mocktails:      "#2BA5B5",
  "nasi-lemak":   "#6B8E23",
  noodle:         "#CD6600",
  pasta:          "#B22222",
  "roti-bakar":   "#A0722D",
  sandwiches:     "#2F8F8F",
};

const PALETTE = [
  "#8B6914","#C0507E","#3A7D44","#7B5EA7","#D4792C","#CC3333",
  "#2E8B57","#2BA5B5","#6B8E23","#CD6600","#B22222","#5C3317",
  "#E06B75","#A0722D","#2F8F8F","#B8860B","#6B3A2A",
];

export function CategoryTabs({ categories, active, onChange, layoutColors = {} }: Props) {
  // Split into exactly 2 rows
  const half = Math.ceil(categories.length / 2);
  const row1 = categories.slice(0, half);
  const row2 = categories.slice(half);

  function renderTab(cat: ProductCategory, i: number) {
    const isActive = active === cat.slug;
    const color = layoutColors[cat.slug]
      ?? DEFAULT_COLORS[cat.slug]
      ?? PALETTE[i % PALETTE.length];

    return (
      <button
        key={cat.slug}
        onClick={() => onChange(cat.slug)}
        style={{ backgroundColor: color }}
        className={`flex-1 min-w-0 rounded-lg py-2 text-sm font-semibold text-white text-center transition-all ${
          isActive
            ? "ring-2 ring-white/50 scale-[1.02] shadow-lg"
            : "opacity-70 hover:opacity-100"
        }`}
      >
        {cat.name}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 bg-surface px-3 py-2">
      {/* overflow-hidden (was overflow-x-auto scrollbar-none) — the
          tabs use `flex-1 min-w-0` so they always shrink to fit the
          row exactly; there's never anything to scroll. `scrollbar-
          none` is not a Tailwind utility, so the browser was
          reserving track space (~15px) under each row, producing a
          big visible dark band between row 1 and row 2 that looked
          like a missing third row. Removing the overflow-auto kills
          the reserved scrollbar space and the rows now sit flush. */}
      <div className="flex gap-1.5 overflow-hidden">
        {row1.map((cat, i) => renderTab(cat, i))}
      </div>
      {row2.length > 0 && (
        <div className="flex gap-1.5 overflow-hidden">
          {row2.map((cat, i) => renderTab(cat, half + i))}
        </div>
      )}
    </div>
  );
}
