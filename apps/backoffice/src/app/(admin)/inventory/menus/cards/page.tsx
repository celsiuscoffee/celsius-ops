"use client";

import { formatRM } from "@celsius/shared";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Coffee, Search, Loader2, Printer, ArrowLeft, X, Flame, Snowflake } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

/**
 * Recipe Cards — barista build cards for every menu item's Bill of Materials.
 *
 * Modelled on the coffee-chain "build card" template (Starbucks beverage
 * routine cards et al.): the recipe reads as a numbered build, and where it
 * differs by temperature the Hot and Iced builds sit side by side — driven by
 * the BOM's per-line Hot/Iced modifier. Packaging is pulled out to a "Serve in"
 * line. Costs are off by default (a clean prep card) and toggle on for costing.
 *
 * Same data as the Menu & BOM table (/api/inventory/menus) so builds + COGS
 * never drift. There is no size dimension in the catalogue (each drink is one
 * SKU), so the card deliberately does NOT fake Short/Tall/Grande columns.
 */

type ServiceMode = "ALL" | "DINE_IN" | "TAKEAWAY";
const SERVICE_MODE_LABEL: Record<ServiceMode, string> = {
  ALL: "Dine-in & takeaway",
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

// ── Build order ───────────────────────────────────────────────────────────
// A barista builds a drink in a rough order: pull the base (espresso/tea), add
// powders/sauces, then flavouring syrups, then milk/water, ice, and finally
// toppings. We infer that order from the ingredient name so the card reads like
// a build sequence rather than an arbitrary list. Unknowns sit in the middle.
const BUILD_ORDER: { test: RegExp; rank: number }[] = [
  { test: /espresso|coffee|bean|ristretto|\bshot|brew/i, rank: 0 },
  { test: /matcha|\btea\b|chai/i, rank: 1 },
  { test: /choc|mocha|powder|sauce|puree|jam/i, rank: 2 },
  { test: /syrup|monin|vanilla|caramel|hazelnut|berr|lychee|flavou?r/i, rank: 3 },
  { test: /milk|dairy|cream|foam|water|soda|tonic/i, rank: 4 },
  { test: /\bice\b/i, rank: 6 },
  { test: /top|drizzle|sprinkle|cinnamon|whip|garnish|dust|salt/i, rank: 7 },
];
const buildRank = (name: string) => BUILD_ORDER.find((b) => b.test.test(name))?.rank ?? 5;

type Step = { name: string; qty: number; uom: string; rank: number };

// Resolve the build steps for one temperature. temp === null builds the single
// (non-split) recipe. For a temperature, a line tagged with that temperature
// wins; otherwise the "both" (null modifier) line applies; if neither, the
// ingredient simply isn't part of that build.
function buildSteps(ingredients: Ingredient[], temp: "Hot" | "Iced" | null): Step[] {
  const byProduct = new Map<string, Ingredient[]>();
  for (const ing of ingredients) {
    const arr = byProduct.get(ing.productId);
    if (arr) arr.push(ing);
    else byProduct.set(ing.productId, [ing]);
  }
  const steps: Step[] = [];
  for (const lines of byProduct.values()) {
    const both = lines.find((l) => !l.modifier);
    const qty =
      temp === null ? both?.qty : (lines.find((l) => l.modifier === temp)?.qty ?? both?.qty);
    if (qty == null) continue;
    const f = lines[0];
    steps.push({ name: f.product, qty, uom: f.uom, rank: buildRank(f.product) });
  }
  return steps.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}

// Packaging collapses to one "serve in" line per (product, channel).
type PkgRow = { name: string; serviceMode: ServiceMode };
function buildPackaging(packaging: Ingredient[]): PkgRow[] {
  const seen = new Map<string, PkgRow>();
  for (const p of packaging) {
    const k = `${p.productId}|${p.serviceMode}`;
    if (!seen.has(k)) seen.set(k, { name: p.product, serviceMode: p.serviceMode });
  }
  return [...seen.values()];
}

// One numbered build step: sequence chip · ingredient · measure.
function StepRow({ n, step }: { n: number; step: Step }) {
  return (
    <li className="flex items-baseline gap-2 py-[3px]">
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#160800]/5 text-[9px] font-bold text-[#160800]/60">
        {n}
      </span>
      <span className="min-w-0 flex-1 truncate text-gray-800">{step.name}</span>
      <span className="shrink-0 whitespace-nowrap tabular-nums font-semibold text-gray-900">
        {step.qty}
        <span className="ml-0.5 text-[10px] font-normal text-gray-400">{step.uom}</span>
      </span>
    </li>
  );
}

function BuildColumn({
  title,
  icon,
  accent,
  steps,
}: {
  title?: string;
  icon?: ReactNode;
  accent?: string;
  steps: Step[];
}) {
  return (
    <div className="min-w-0">
      {title && (
        <p className={`mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide ${accent ?? "text-gray-400"}`}>
          {icon}
          {title}
        </p>
      )}
      {steps.length === 0 ? (
        <p className="py-1 text-[11px] text-gray-400">No items</p>
      ) : (
        <ol className="divide-y divide-gray-100">
          {steps.map((s, i) => (
            <StepRow key={i} n={i + 1} step={s} />
          ))}
        </ol>
      )}
    </div>
  );
}

function RecipeCard({ menu, showCosts }: { menu: MenuItem; showCosts: boolean }) {
  const ingredients = menu.ingredients.filter((i) => i.kind === "ingredient");
  const packaging = menu.ingredients.filter((i) => i.kind === "packaging");
  const hasTempSplit = ingredients.some((i) => i.modifier != null);
  const hotSteps = hasTempSplit ? buildSteps(ingredients, "Hot") : [];
  const icedSteps = hasTempSplit ? buildSteps(ingredients, "Iced") : [];
  const singleSteps = hasTempSplit ? [] : buildSteps(ingredients, null);
  const pkgRows = buildPackaging(packaging);
  const empty = ingredients.length === 0 && packaging.length === 0;

  return (
    <div className="recipe-card flex break-inside-avoid flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* Header band — espresso fill, cream text */}
      <div className="rc-head flex items-start justify-between gap-3 bg-[#160800] px-4 py-3 text-[#F5F1EA]">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#D2965C]">
            {menu.category || "Uncategorised"}
          </p>
          <h3 className="mt-0.5 truncate text-base font-bold leading-tight">{menu.name}</h3>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[9px] uppercase tracking-wide text-[#F5F1EA]/55">Sells at</p>
          <p className="text-sm font-bold">RM {menu.sellingPrice.toFixed(2)}</p>
        </div>
      </div>

      {/* Build */}
      <div className="flex-1 px-4 py-3 text-xs">
        {empty ? (
          <p className="py-3 text-center text-gray-400">No recipe yet</p>
        ) : hasTempSplit ? (
          <div className="grid grid-cols-2 gap-x-4 divide-x divide-gray-100">
            <BuildColumn
              title="Hot build"
              accent="text-orange-600"
              icon={<Flame className="h-3 w-3" />}
              steps={hotSteps}
            />
            <div className="pl-4">
              <BuildColumn
                title="Iced build"
                accent="text-sky-600"
                icon={<Snowflake className="h-3 w-3" />}
                steps={icedSteps}
              />
            </div>
          </div>
        ) : (
          <BuildColumn title="Build" steps={singleSteps} />
        )}
      </div>

      {/* Serve in (packaging) */}
      {pkgRows.length > 0 && (
        <div className="border-t border-gray-100 px-4 py-2 text-[11px]">
          <p className="mb-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-600">Serve in</p>
          <ul className="space-y-0.5">
            {pkgRows.map((p, i) => (
              <li key={i} className="flex items-baseline justify-between gap-2">
                <span className="truncate text-gray-700">{p.name}</span>
                {p.serviceMode !== "ALL" && (
                  <span className="shrink-0 text-[10px] text-gray-400">{SERVICE_MODE_LABEL[p.serviceMode]}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Cost summary (off by default — toggle on for costing) */}
      {showCosts && (menu.ingredientCost > 0 || menu.cogs > 0) && (
        <div className="border-t border-gray-100 bg-gray-50/70 px-4 py-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Ingredient cost</span>
            <span className="font-medium tabular-nums text-gray-700">{formatRM(menu.ingredientCost)}</span>
          </div>
          {menu.cogs > 0 && (
            <div className="mt-0.5 flex items-center justify-between">
              <span className="text-gray-500">All-in COGS{menu.packagingCount > 0 ? " (incl. packaging)" : ""}</span>
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
            <p className="mt-0.5 text-[9px] text-gray-400">Worst case across Hot/Iced × dine-in/takeaway — full breakdown on Menu &amp; BOM.</p>
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
  // Barista-prep card by default: build steps + Hot/Iced + packaging, no costs.
  // Toggle on for a costing view (ingredient cost + all-in COGS%).
  const [showCosts, setShowCosts] = useState(false);

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
          Barista build cards from the Bill of Materials — Hot &amp; Iced builds side by side. {filtered.length} of {menus.length} shown.
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
