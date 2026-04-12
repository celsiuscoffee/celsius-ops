"use client";

import type { ProductCategory } from "@/types/database";

type Props = {
  categories: ProductCategory[];
  active: string;
  onChange: (slug: string) => void;
  layoutColors?: Record<string, string>; // custom colors per tab slug
};

// Default colors for category mode (Square POS style)
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

// Colors for dynamically generated tabs (tags, custom)
const PALETTE = [
  "#8B6914","#C0507E","#3A7D44","#7B5EA7","#D4792C","#CC3333",
  "#2E8B57","#2BA5B5","#6B8E23","#CD6600","#B22222","#5C3317",
  "#E06B75","#A0722D","#2F8F8F","#B8860B","#6B3A2A",
];

export function CategoryTabs({ categories, active, onChange, layoutColors = {} }: Props) {
  return (
    <div className="flex gap-2 overflow-x-auto bg-surface px-2 py-2.5 scrollbar-none">
      {categories.map((cat, i) => {
        const isActive = active === cat.slug;

        // Color priority: custom layout color → default map → palette rotation
        const color = layoutColors[cat.slug]
          ?? DEFAULT_COLORS[cat.slug]
          ?? PALETTE[i % PALETTE.length];

        return (
          <button
            key={cat.slug}
            onClick={() => onChange(cat.slug)}
            style={{ backgroundColor: color }}
            className={`whitespace-nowrap rounded-xl px-5 py-3 text-sm font-semibold text-white transition-all min-h-[48px] ${
              isActive
                ? "ring-2 ring-white/50 scale-[1.02] shadow-lg"
                : "opacity-70 hover:opacity-100"
            }`}
          >
            {cat.name}
          </button>
        );
      })}
    </div>
  );
}
