"use client";

import { formatRM } from "@celsius/shared";

import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Coffee, Search, Loader2, Printer, ArrowLeft, X } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

/**
 * Recipe Cards — a print-friendly view of every menu item's Bill of Materials.
 *
 * Same data as the Menu & BOM table (/api/inventory/menus), reshaped into one
 * card per item so it reads like a barista's recipe card: ingredients + qty
 * (with Hot/Iced split where the recipe differs), packaging, and an optional
 * cost summary. "Print" → the browser's Save-as-PDF gives a tidy 2-up sheet to
 * post in the bar. Costs can be hidden for a clean prep card.
 */

type ServiceMode = "ALL" | "DINE_IN" | "TAKEAWAY";
const SERVICE_MODE_LABEL: Record<ServiceMode, string> = {
  ALL: "Both",
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
};

type Ingredient = {
  product: string;
  productId: string;
  sku: string;
  qty: number;
  uom: string;
  unitCost: number;
  cost: number;
  serviceMode: ServiceMode;
  modifier?: string | null; // null = any temperature; "Iced" / "Hot"
  kind: "ingredient" | "packaging";
  source?: "bom" | "rule";
};

type MenuItem = {
  id: string;
  name: string;
  category: string;
  sellingPrice: number;
  cogs: number; // all-in worst case
  cogsPercent: number;
  ingredientCost: number;
  hasIcedHotSplit: boolean;
  ingredientCount: number;
  packagingCount: number;
  ingredients: Ingredient[];
};

// Collapse the flat BOM line list into display rows: one row per
// (source, product, channel), with Hot/Iced quantities stacked so a recipe that
// differs by temperature stays on a single readable line. Ingredients sort
// before packaging — mirrors the Menu & BOM read-only view.
type CardRow = {
  product: string;
  sku: string;
  uom: string;
  kind: "ingredient" | "packaging";
  serviceMode: ServiceMode;
  source: "bom" | "rule";
  parts: { modifier: string | null; qty: number }[];
};

const modOrder = (m?: string | null) => (m === "Iced" ? 0 : m === "Hot" ? 1 : 2);

function buildRows(ingredients: Ingredient[]): CardRow[] {
  const groups = new Map<string, Ingredient[]>();
  for (const ing of ingredients) {
    const k = `${ing.source ?? "bom"}|${ing.productId}|${ing.serviceMode}`;
    const arr = groups.get(k);
    if (arr) arr.push(ing);
    else groups.set(k, [ing]);
  }
  const rows: CardRow[] = [...groups.values()].map((lines) => {
    const f = lines[0];
    const parts = [...lines]
      .sort((a, b) => modOrder(a.modifier) - modOrder(b.modifier))
      .map((l) => ({ modifier: l.modifier ?? null, qty: l.qty }));
    return {
      product: f.product,
      sku: f.sku,
      uom: f.uom,
      kind: f.kind,
      serviceMode: f.serviceMode,
      source: f.source ?? "bom",
      parts,
    };
  });
  return rows.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "ingredient" ? -1 : 1));
}

// One BOM line on a card: name on the left, quantity (Hot/Iced stacked) on the
// right. Packaging shows its channel; rule-applied packaging is tagged.
function LineRow({ row, showChannel }: { row: CardRow; showChannel: boolean }) {
  const split = row.parts.some((p) => p.modifier);
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <div className="min-w-0 flex items-center gap-1.5">
        <span className="truncate text-gray-800">{row.product}</span>
        {row.source === "rule" && (
          <Badge variant="outline" className="border-gray-200 bg-gray-50 text-[9px] text-gray-500">
            via rule
          </Badge>
        )}
      </div>
      <div className="shrink-0 text-right">
        {split ? (
          <div className="flex flex-col items-end gap-0.5">
            {row.parts.map((p, i) => (
              <span key={i} className="whitespace-nowrap tabular-nums">
                {p.modifier && (
                  <span className={`mr-1 text-[10px] font-semibold ${p.modifier === "Iced" ? "text-sky-600" : "text-orange-600"}`}>
                    {p.modifier}
                  </span>
                )}
                <span className="font-medium text-gray-900">{p.qty}</span>
                <span className="ml-0.5 text-gray-400">{row.uom}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="whitespace-nowrap tabular-nums">
            <span className="font-medium text-gray-900">{row.parts[0]?.qty ?? 0}</span>
            <span className="ml-0.5 text-gray-400">{row.uom}</span>
          </span>
        )}
        {showChannel && row.kind === "packaging" && row.serviceMode !== "ALL" && (
          <span className="ml-1 text-[10px] text-gray-400">({SERVICE_MODE_LABEL[row.serviceMode]})</span>
        )}
      </div>
    </div>
  );
}

function RecipeCard({ menu, showCosts }: { menu: MenuItem; showCosts: boolean }) {
  const rows = buildRows(menu.ingredients);
  const ingredientRows = rows.filter((r) => r.kind === "ingredient");
  const packagingRows = rows.filter((r) => r.kind === "packaging");

  return (
    <div className="recipe-card flex flex-col break-inside-avoid overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* Header band — espresso fill, cream text */}
      <div className="rc-head bg-[#160800] px-4 py-3 text-[#F5F1EA]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#D2965C]">
              {menu.category || "Uncategorised"}
            </p>
            <h3 className="mt-0.5 truncate text-base font-bold leading-tight">{menu.name}</h3>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] uppercase tracking-wide text-[#F5F1EA]/60">Sells at</p>
            <p className="text-sm font-bold">RM {menu.sellingPrice.toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* Body — ingredients then packaging */}
      <div className="flex-1 px-4 py-3 text-xs">
        {ingredientRows.length === 0 && packagingRows.length === 0 ? (
          <p className="py-3 text-center text-gray-400">No recipe yet</p>
        ) : (
          <>
            {ingredientRows.length > 0 && (
              <>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Ingredients</p>
                <div className="divide-y divide-gray-100">
                  {ingredientRows.map((r, i) => (
                    <LineRow key={i} row={r} showChannel={false} />
                  ))}
                </div>
              </>
            )}
            {packagingRows.length > 0 && (
              <>
                <p className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wide text-amber-600">Packaging</p>
                <div className="divide-y divide-gray-100">
                  {packagingRows.map((r, i) => (
                    <LineRow key={i} row={r} showChannel />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Cost summary footer */}
      {showCosts && (menu.ingredientCost > 0 || menu.cogs > 0) && (
        <div className="border-t border-gray-100 bg-gray-50/70 px-4 py-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Ingredient cost</span>
            <span className="font-medium tabular-nums text-gray-700">{formatRM(menu.ingredientCost)}</span>
          </div>
          {menu.cogs > 0 && (
            <div className="mt-0.5 flex items-center justify-between">
              <span className="text-gray-500">
                All-in COGS{menu.packagingCount > 0 ? " (incl. packaging)" : ""}
              </span>
              <span className="tabular-nums">
                <span className="font-semibold text-gray-900">{formatRM(menu.cogs)}</span>
                {menu.cogsPercent > 0 && (
                  <span className={`ml-1 font-medium ${menu.cogsPercent > 40 ? "text-red-600" : menu.cogsPercent > 30 ? "text-amber-600" : "text-green-600"}`}>
                    {menu.cogsPercent.toFixed(0)}%
                  </span>
                )}
              </span>
            </div>
          )}
          {menu.hasIcedHotSplit && (
            <p className="mt-0.5 text-[9px] text-gray-400">Worst case across Hot/Iced × dine-in/takeaway — see Menu &amp; BOM for the full breakdown.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function RecipeCardsPage() {
  const { data: menus = [], isLoading: loading } = useFetch<MenuItem[]>("/api/inventory/menus");
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string[]>([]);
  const [onlyWithRecipe, setOnlyWithRecipe] = useState(true);
  const [showCosts, setShowCosts] = useState(true);

  const categories = [...new Set(menus.map((m) => m.category).filter(Boolean))].sort();
  const toggleCat = (c: string) =>
    setCatFilter((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const filtered = menus
    .filter((m) => {
      const matchSearch = m.name.toLowerCase().includes(search.toLowerCase());
      const matchCat = catFilter.length === 0 || catFilter.includes(m.category);
      const matchRecipe = !onlyWithRecipe || m.ingredientCount > 0;
      return matchSearch && matchCat && matchRecipe;
    })
    .sort((a, b) =>
      a.category === b.category ? a.name.localeCompare(b.name) : a.category.localeCompare(b.category),
    );

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 print:p-0">
      {/* Print rules: A4 portrait, 2-up cards, espresso header forced to print. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  body { background: #fff !important; }
  .recipe-card { box-shadow: none !important; border-color: #d1d5db !important; }
  .rc-head, .rc-head * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .rc-grid { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 10mm !important; }
}`,
        }}
      />

      {/* Header + controls (hidden when printing) */}
      <div className="print:hidden">
        <div className="flex items-center gap-2">
          <Link href="/inventory/menus" className="text-gray-400 hover:text-terracotta">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h2 className="text-xl font-semibold text-gray-900">Recipe Cards</h2>
        </div>
        <p className="mt-0.5 text-sm text-gray-500">
          Printable Bill of Materials — one card per menu item. {filtered.length} of {menus.length} shown.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input placeholder="Search menu items..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>

            <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={onlyWithRecipe} onChange={(e) => setOnlyWithRecipe(e.target.checked)} className="accent-terracotta" />
              Only items with a recipe
            </label>
            <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={showCosts} onChange={(e) => setShowCosts(e.target.checked)} className="accent-terracotta" />
              Show costs
            </label>

            <button
              onClick={() => window.print()}
              className="ml-auto flex items-center gap-2 rounded-xl bg-[#160800] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2d1100]"
            >
              <Printer className="h-4 w-4" /> Print all
            </button>
          </div>

          {/* Category filter */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setCatFilter([])}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${catFilter.length === 0 ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500 hover:border-gray-300"}`}
            >
              All
            </button>
            {categories.map((c) => {
              const active = catFilter.includes(c);
              return (
                <button
                  key={c}
                  onClick={() => toggleCat(c)}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors ${active ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500 hover:border-gray-300"}`}
                >
                  {c}
                  {active && <X className="h-3 w-3" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Card grid */}
      {filtered.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-2 text-gray-400">
          <Coffee className="h-8 w-8" />
          <p className="text-sm">No menu items match your filters.</p>
        </div>
      ) : (
        <div className="rc-grid mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 print:mt-0">
          {filtered.map((menu) => (
            <RecipeCard key={menu.id} menu={menu} showCosts={showCosts} />
          ))}
        </div>
      )}
    </div>
  );
}
