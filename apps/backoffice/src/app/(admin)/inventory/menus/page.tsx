"use client";

import { formatRM } from "@celsius/shared";

import { useState, Fragment } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Pencil, ChevronDown, Coffee, Search, Loader2, Trash2, X, Check, ArrowUp, ArrowDown, ChevronsUpDown, Printer } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

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
  source?: "bom" | "rule"; // "rule" = applied from a Packaging rule (read-only)
};

type Cell = { pkg: number; cogs: number; cogsPercent: number };
type CostMatrix = {
  hot: { dineIn: Cell; takeaway: Cell };
  iced: { dineIn: Cell; takeaway: Cell };
};

type MenuItem = {
  id: string;
  name: string;
  category: string;
  sellingPrice: number;
  cogs: number; // all-in worst case — headline
  cogsPercent: number;
  ingredientCost: number;
  matrix: CostMatrix; // COGS by temperature × channel
  hasIcedHotSplit: boolean;
  ingredientCount: number;
  packagingCount: number;
  ingredients: Ingredient[];
};

type ProductOption = {
  id: string;
  name: string;
  sku: string;
  baseUom: string;
  itemType: string; // INGREDIENT | PERISHABLE | PACKAGING
};

// One editor row = one ingredient (per channel). By default a single quantity
// applies to both temperatures; "split" reveals separate Iced / Hot quantities
// so the same ingredient stays on ONE row instead of two — e.g. Monin Caramel
// 17ml Iced / 12ml Hot reads as a single line. On save a row expands back to the
// underlying BOM lines (one "Both" line, or an Iced + Hot pair).
type EditRow = {
  key: string; // stable per-row id
  productId: string;
  productName: string;
  sku: string;
  uom: string;
  serviceMode: ServiceMode;
  kind: "ingredient" | "packaging";
  split: boolean; // false = one qty for both temps; true = separate Iced / Hot
  bothQty: number; // used when !split
  icedQty: number; // used when split (0 / blank = not used on Iced)
  hotQty: number; // used when split (0 / blank = not used on Hot)
};

// Stable id for an edit row.
const rowKey = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `row-${Math.random().toString(36).slice(2)}-${Date.now()}`;

type SortKey = "name" | "category" | "sellingPrice" | "cogs" | "cogsPercent" | "ingredientCount";

// One all-in COGS figure with its ingredients-vs-packaging split. The packaging
// sub-line shows how much of the cost is packaging and its share of COGS (the
// rest is ingredients) so the two are easy to compare at a glance.
const CogsCell = ({ c }: { c: Cell }) => {
  const pkgShare = c.cogs > 0 ? Math.round((c.pkg / c.cogs) * 100) : 0;
  return (
    <div className="leading-tight">
      <div className="font-bold text-gray-900">
        RM {c.cogs.toFixed(2)}
        {c.cogsPercent > 0 && <span className="ml-1 text-[10px] font-normal text-gray-400">{c.cogsPercent.toFixed(0)}%</span>}
      </div>
      {c.pkg > 0 && (
        <div className="text-[10px] font-normal text-amber-600">
          pkg RM {c.pkg.toFixed(2)} · {pkgShare}%
        </div>
      )}
    </div>
  );
};

export default function MenusPage() {
  const { data: menus = [], isLoading: loading, mutate: loadMenus } = useFetch<MenuItem[]>("/api/inventory/menus");
  const { data: products = [] } = useFetch<ProductOption[]>("/api/inventory/products");
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string[]>([]); // empty = All categories
  const [statusFilter, setStatusFilter] = useState<"all" | "recipe" | "norecipe" | "high">("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Editing state
  const [editingMenuId, setEditingMenuId] = useState<string | null>(null);
  const [editRows, setEditRows] = useState<EditRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [addSearch, setAddSearch] = useState("");

  const categories = [...new Set(menus.map((m) => m.category).filter(Boolean))].sort();

  const toggleCat = (c: string) => {
    setCatFilter((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  };

  const filtered = menus.filter((m) => {
    const matchSearch = m.name.toLowerCase().includes(search.toLowerCase());
    const matchCat = catFilter.length === 0 || catFilter.includes(m.category);
    const matchStatus =
      statusFilter === "all" ||
      (statusFilter === "recipe" && m.ingredientCount > 0) ||
      (statusFilter === "norecipe" && m.ingredientCount === 0) ||
      (statusFilter === "high" && m.cogsPercent > 40);
    return matchSearch && matchCat && matchStatus;
  });

  const sorted = [...filtered].sort((a, b) => {
    let cmp: number;
    if (sortKey === "name" || sortKey === "category") {
      cmp = String(a[sortKey]).localeCompare(String(b[sortKey]));
    } else {
      cmp = (a[sortKey] as number) - (b[sortKey] as number);
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Numeric columns are most useful highest-first; text ascending.
      setSortDir(key === "name" || key === "category" ? "asc" : "desc");
    }
  };

  const highCogsCount = menus.filter((m) => m.cogsPercent > 40).length;
  const noRecipeCount = menus.filter((m) => m.ingredientCount === 0).length;

  // ── Edit helpers ────────────────────────────────────────────────────────

  const startEditing = (menu: MenuItem) => {
    setEditingMenuId(menu.id);
    setExpandedId(menu.id);
    // Rule-applied packaging is managed on the Packaging page — only the menu's
    // own BOM lines are editable here. Collapse the lines into one row per
    // (product, channel): a temperature-specific pair (Iced + Hot, or a lone
    // Iced/Hot) becomes a single split row; a plain "Both" line stays unsplit.
    const own = menu.ingredients.filter((ing) => ing.source !== "rule");
    const groups = new Map<string, Ingredient[]>();
    for (const ing of own) {
      const k = `${ing.productId}|${ing.serviceMode}`;
      const arr = groups.get(k);
      if (arr) arr.push(ing);
      else groups.set(k, [ing]);
    }
    const rows: EditRow[] = [];
    for (const lines of groups.values()) {
      const first = lines[0];
      const both = lines.find((l) => !l.modifier);
      const iced = lines.find((l) => l.modifier === "Iced");
      const hot = lines.find((l) => l.modifier === "Hot");
      const base = {
        key: rowKey(),
        productId: first.productId,
        productName: first.product,
        sku: first.sku,
        uom: first.uom,
        serviceMode: first.serviceMode,
        kind: first.kind,
      };
      if (iced || hot) {
        // Differs by temperature — show as a split row. A lone "Both" line in
        // the same group (unusual) seeds whichever side is missing.
        rows.push({
          ...base,
          split: true,
          bothQty: 0,
          icedQty: iced?.qty ?? both?.qty ?? 0,
          hotQty: hot?.qty ?? both?.qty ?? 0,
        });
      } else {
        rows.push({ ...base, split: false, bothQty: both?.qty ?? 0, icedQty: 0, hotQty: 0 });
      }
    }
    setEditRows(rows);
    setAddSearch("");
  };

  const cancelEditing = () => {
    setEditingMenuId(null);
    setEditRows([]);
    setAddSearch("");
  };

  const patchRow = (key: string, patch: Partial<EditRow>) =>
    setEditRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const updateRowQty = (key: string, field: "bothQty" | "icedQty" | "hotQty", value: string) => {
    const num = value === "" ? 0 : parseFloat(value);
    if (isNaN(num)) return;
    patchRow(key, { [field]: num });
  };

  const updateRowChannel = (key: string, mode: ServiceMode) => patchRow(key, { serviceMode: mode });

  // Toggle the Hot/Iced split. Splitting seeds both sides from the single qty;
  // merging collapses back to one qty (prefers the Iced side, then Hot).
  const toggleSplit = (key: string) =>
    setEditRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        if (r.split) {
          return { ...r, split: false, bothQty: r.icedQty || r.hotQty || 0 };
        }
        return { ...r, split: true, icedQty: r.bothQty, hotQty: r.bothQty };
      })
    );

  const removeRow = (key: string) => setEditRows((prev) => prev.filter((r) => r.key !== key));

  const addIngredient = (product: ProductOption) => {
    setEditRows((prev) => [
      ...prev,
      {
        key: rowKey(),
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        uom: product.baseUom,
        serviceMode: "ALL",
        kind: product.itemType === "PACKAGING" ? "packaging" : "ingredient",
        split: false,
        bothQty: 0,
        icedQty: 0,
        hotQty: 0,
      },
    ]);
    setAddSearch("");
  };

  // Expand each row back into BOM lines. Unsplit → one "Both" line. Split →
  // an Iced and/or Hot line, but if both sides are equal it collapses to a
  // single "Both" line (no redundant duplicate). Zero / blank sides are dropped.
  const rowsToLines = (rows: EditRow[]) => {
    const lines: { productId: string; quantityUsed: number; uom: string; serviceMode: ServiceMode; modifier: string }[] = [];
    for (const r of rows) {
      const base = { productId: r.productId, uom: r.uom, serviceMode: r.serviceMode };
      if (!r.split) {
        if (r.bothQty > 0) lines.push({ ...base, quantityUsed: r.bothQty, modifier: "" });
        continue;
      }
      if (r.icedQty > 0 && r.icedQty === r.hotQty) {
        lines.push({ ...base, quantityUsed: r.icedQty, modifier: "" });
        continue;
      }
      if (r.icedQty > 0) lines.push({ ...base, quantityUsed: r.icedQty, modifier: "Iced" });
      if (r.hotQty > 0) lines.push({ ...base, quantityUsed: r.hotQty, modifier: "Hot" });
    }
    return lines;
  };

  const saveIngredients = async () => {
    if (!editingMenuId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/inventory/menus/${editingMenuId}/ingredients`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredients: rowsToLines(editRows) }),
      });
      if (res.ok) {
        cancelEditing();
        loadMenus();
      }
    } finally {
      setSaving(false);
    }
  };

  // Product search results for adding. A product can appear on more than one
  // row (one per temperature), so already-added products are not filtered out.
  const addSearchResults = addSearch.trim().length >= 2
    ? products
        .filter((p) =>
          p.name.toLowerCase().includes(addSearch.toLowerCase()) ||
          p.sku.toLowerCase().includes(addSearch.toLowerCase())
        )
        .slice(0, 8)
    : [];

  // Sortable column header
  const SortHeader = ({ label, sortKey: key, align = "left" }: { label: string; sortKey: SortKey; align?: "left" | "right" }) => {
    const active = sortKey === key;
    return (
      <th className={`px-4 py-3 font-medium text-gray-500 ${align === "right" ? "text-right" : "text-left"}`}>
        <button
          onClick={() => toggleSort(key)}
          className={`inline-flex items-center gap-1 transition-colors hover:text-gray-900 ${align === "right" ? "flex-row-reverse" : ""} ${active ? "text-gray-900" : ""}`}
        >
          {label}
          {active ? (
            sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
          ) : (
            <ChevronsUpDown className="h-3 w-3 text-gray-300" />
          )}
        </button>
      </th>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Menu & Recipes (BOM)</h2>
          <p className="mt-0.5 text-sm text-gray-500">{menus.length} menu items · ingredient + packaging costing (dine-in / takeaway)</p>
        </div>
        <Link
          href="/inventory/menus/cards"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:border-terracotta hover:text-terracotta"
        >
          <Printer className="h-4 w-4" /> Recipe cards
        </Link>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input placeholder="Search menu items..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          {/* Quick status filters */}
          <div className="flex flex-wrap gap-1.5">
            {([
              { key: "all", label: "All" },
              { key: "recipe", label: "Has recipe" },
              { key: "norecipe", label: `No recipe${noRecipeCount ? ` · ${noRecipeCount}` : ""}` },
              { key: "high", label: `High COGS${highCogsCount ? ` · ${highCogsCount}` : ""}` },
            ] as const).map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  statusFilter === f.key
                    ? f.key === "high"
                      ? "border-red-300 bg-red-50 text-red-600"
                      : "border-terracotta bg-terracotta/5 text-terracotta-dark"
                    : "border-gray-200 text-gray-500 hover:border-gray-300"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {/* Category filter — multi-select; wraps instead of overflowing */}
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
        <p className="text-xs text-gray-400">
          Showing {sorted.length} of {menus.length} items
          {(search || catFilter.length > 0 || statusFilter !== "all") && (
            <button
              onClick={() => { setSearch(""); setCatFilter([]); setStatusFilter("all"); }}
              className="ml-2 text-terracotta hover:underline"
            >
              Clear filters
            </button>
          )}
        </p>
      </div>

      {/* Summary — reflects the current filter */}
      {(() => {
        const isFiltered = search !== "" || catFilter.length > 0 || statusFilter !== "all";
        const withCogs = sorted.filter((m) => m.cogs > 0);
        const avgCogs = withCogs.length > 0 ? withCogs.reduce((s, m) => s + m.cogsPercent, 0) / withCogs.length : 0;
        const mapped = sorted.filter((m) => m.ingredientCount > 0).length;
        return (
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="px-4 py-3">
              <p className="text-xs text-gray-500">{isFiltered ? "Items in View" : "Total Menu Items"}</p>
              <p className="text-xl font-bold text-gray-900">{sorted.length}</p>
              <p className="text-xs text-gray-400">{mapped} with recipes</p>
            </Card>
            <Card className="px-4 py-3">
              <p className="text-xs text-gray-500">Ingredients Mapped</p>
              <p className="text-xl font-bold text-gray-900">{sorted.reduce((a, m) => a + m.ingredientCount, 0)}</p>
              <p className="text-xs text-gray-400">across {mapped} {mapped === 1 ? 'item' : 'items'}</p>
            </Card>
            <Card className="px-4 py-3">
              <p className="text-xs text-gray-500">Avg COGS %</p>
              <p className={`text-xl font-bold ${avgCogs > 40 ? "text-red-600" : avgCogs > 30 ? "text-amber-600" : "text-green-600"}`}>
                {avgCogs > 0 ? `${avgCogs.toFixed(1)}%` : "—"}
              </p>
              <p className="text-xs text-gray-400">{withCogs.length} {withCogs.length === 1 ? 'item' : 'items'} costed</p>
            </Card>
            <Card className="px-4 py-3">
              <p className="text-xs text-gray-500">No Recipe Yet</p>
              <p className="text-xl font-bold text-gray-900">{sorted.length - mapped}</p>
              <p className="text-xs text-gray-400">need ingredients</p>
            </Card>
          </div>
        );
      })()}

      {/* Menu table with expandable ingredients */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="w-8 px-3 py-3"></th>
              <SortHeader label="Menu Item" sortKey="name" />
              <SortHeader label="Category" sortKey="category" />
              <SortHeader label="Selling Price" sortKey="sellingPrice" align="right" />
              <SortHeader label="All-in Cost" sortKey="cogs" align="right" />
              <SortHeader label="COGS %" sortKey="cogsPercent" align="right" />
              <SortHeader label="Ingredients" sortKey="ingredientCount" />
              <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">
                  No menu items match your filters.
                </td>
              </tr>
            )}
            {sorted.map((menu) => {
              const isEditing = editingMenuId === menu.id;
              return (
                <Fragment key={menu.id}>
                  <tr className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer" onClick={() => { if (!isEditing) setExpandedId(expandedId === menu.id ? null : menu.id); }}>
                    <td className="px-3 py-3">
                      <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${expandedId === menu.id ? "rotate-180" : ""}`} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Coffee className="h-4 w-4 text-gray-400" />
                        <p className="font-medium text-gray-900">{menu.name}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3"><Badge variant="outline" className="text-[10px]">{menu.category}</Badge></td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">RM {menu.sellingPrice.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {menu.cogs > 0 ? `${formatRM(menu.cogs)}` : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {menu.cogsPercent > 0 ? (
                        <span className={`text-xs font-medium ${menu.cogsPercent > 40 ? "text-red-600" : menu.cogsPercent > 30 ? "text-amber-600" : "text-green-600"}`}>
                          {menu.cogsPercent.toFixed(1)}%
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{menu.ingredientCount} {menu.ingredientCount === 1 ? 'item' : 'items'}</td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500" onClick={cancelEditing} disabled={saving}>
                            <X className="mr-1 h-3 w-3" />Cancel
                          </Button>
                          <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-xs" onClick={saveIngredients} disabled={saving}>
                            {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
                            Save
                          </Button>
                        </div>
                      ) : (
                        <button
                          className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-terracotta"
                          onClick={() => startEditing(menu)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedId === menu.id && (
                    <tr>
                      <td colSpan={8} className="bg-gray-50 px-8 py-3">
                        <p className="mb-2 text-xs font-semibold text-gray-500 uppercase">Recipe / Bill of Materials</p>

                        {isEditing ? (
                          /* ── Editing mode ── */
                          <div>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-gray-400">
                                  <th className="pb-1 text-left font-medium">Item</th>
                                  <th className="pb-1 text-left font-medium w-20">SKU</th>
                                  <th className="pb-1 w-32 text-right font-medium">Qty</th>
                                  <th className="pb-1 w-16 text-center font-medium">UOM</th>
                                  <th className="pb-1 w-24 text-center font-medium">Hot / Iced</th>
                                  <th className="pb-1 w-28 text-center font-medium">Channel</th>
                                  <th className="pb-1 w-8"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {editRows.map((r) => (
                                  <tr key={r.key} className="border-t border-gray-200/50">
                                    <td className="py-1.5 text-gray-700">
                                      <span className="inline-flex items-center gap-1.5">
                                        {r.productName}
                                        {r.kind === "packaging" && (
                                          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[9px] text-amber-700">
                                            Packaging
                                          </Badge>
                                        )}
                                      </span>
                                    </td>
                                    <td className="py-1.5"><code className="text-gray-500">{r.sku}</code></td>
                                    <td className="py-1.5 text-right">
                                      {r.split ? (
                                        <div className="flex flex-col items-end gap-1">
                                          <div className="flex items-center justify-end gap-1.5">
                                            <span className="w-7 text-right text-[9px] font-semibold text-sky-600">Iced</span>
                                            <input
                                              type="number" step="any" min="0"
                                              value={r.icedQty}
                                              onChange={(e) => updateRowQty(r.key, "icedQty", e.target.value)}
                                              className="w-20 rounded border border-sky-200 px-2 py-1 text-right text-xs"
                                            />
                                          </div>
                                          <div className="flex items-center justify-end gap-1.5">
                                            <span className="w-7 text-right text-[9px] font-semibold text-orange-600">Hot</span>
                                            <input
                                              type="number" step="any" min="0"
                                              value={r.hotQty}
                                              onChange={(e) => updateRowQty(r.key, "hotQty", e.target.value)}
                                              className="w-20 rounded border border-orange-200 px-2 py-1 text-right text-xs"
                                            />
                                          </div>
                                        </div>
                                      ) : (
                                        <input
                                          type="number" step="any" min="0"
                                          value={r.bothQty}
                                          onChange={(e) => updateRowQty(r.key, "bothQty", e.target.value)}
                                          className="w-24 rounded border border-gray-200 px-2 py-1 text-right text-xs"
                                        />
                                      )}
                                    </td>
                                    <td className="py-1.5 text-center text-xs text-gray-500">
                                      {r.uom}
                                    </td>
                                    <td className="py-1.5 text-center">
                                      <button
                                        onClick={() => toggleSplit(r.key)}
                                        title={r.split ? "Use one quantity for both temperatures" : "Set different quantities for Hot and Iced"}
                                        className={`rounded border px-2 py-1 text-[10px] font-medium transition-colors ${
                                          r.split
                                            ? "border-terracotta bg-terracotta/5 text-terracotta-dark hover:bg-terracotta/10"
                                            : "border-gray-200 text-gray-500 hover:border-gray-300"
                                        }`}
                                      >
                                        {r.split ? "Merge" : "Split"}
                                      </button>
                                    </td>
                                    <td className="py-1.5 text-center">
                                      <select
                                        value={r.serviceMode}
                                        onChange={(e) => updateRowChannel(r.key, e.target.value as ServiceMode)}
                                        className="rounded border border-gray-200 px-1.5 py-1 text-xs text-gray-600"
                                      >
                                        <option value="ALL">Both</option>
                                        <option value="DINE_IN">Dine-in</option>
                                        <option value="TAKEAWAY">Takeaway</option>
                                      </select>
                                    </td>
                                    <td className="py-1.5 text-center">
                                      <button onClick={() => removeRow(r.key)} className="text-red-400 hover:text-red-600">
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                                {editRows.length === 0 && (
                                  <tr>
                                    <td colSpan={7} className="py-4 text-center text-gray-400">
                                      No items yet. Search below to add ingredients or packaging.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>

                            {/* Add ingredient search */}
                            <div className="mt-3 relative">
                              <div className="relative">
                                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                                <input
                                  type="text"
                                  placeholder="Search product to add..."
                                  value={addSearch}
                                  onChange={(e) => setAddSearch(e.target.value)}
                                  className="w-full rounded border border-dashed border-gray-300 py-1.5 pl-7 pr-3 text-xs text-gray-700 placeholder:text-gray-400 focus:border-terracotta focus:outline-none"
                                />
                              </div>
                              {addSearchResults.length > 0 && (
                                <div className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg">
                                  {addSearchResults.map((product) => (
                                    <button
                                      key={product.id}
                                      onClick={() => addIngredient(product)}
                                      className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-gray-50"
                                    >
                                      <span className="flex items-center gap-1.5 font-medium text-gray-700">
                                        {product.name}
                                        {product.itemType === "PACKAGING" && (
                                          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[9px] text-amber-700">
                                            Packaging
                                          </Badge>
                                        )}
                                      </span>
                                      <span className="text-gray-400">{product.sku} &middot; {product.baseUom}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Auto-applied packaging (cup / lid / straw etc.) comes from
                                shared Packaging rules, not this recipe — show it read-only so
                                it's clear it's already costed and where to change it. */}
                            {(() => {
                              const rulePkg = menu.ingredients.filter((ing) => ing.source === "rule");
                              if (rulePkg.length === 0) return null;
                              return (
                                <div className="mt-3 rounded-md border border-dashed border-amber-200 bg-amber-50/40 px-3 py-2">
                                  <div className="flex items-center justify-between">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                                      Auto-applied packaging
                                    </p>
                                    <Link href="/inventory/packaging" className="text-[11px] font-medium text-terracotta hover:underline">
                                      Manage rules →
                                    </Link>
                                  </div>
                                  <p className="mt-0.5 text-[11px] text-gray-500">
                                    Added automatically by Packaging rules and already included in the all-in cost. Edit these on the Packaging page.
                                  </p>
                                  <ul className="mt-1.5 space-y-0.5">
                                    {rulePkg.map((ing, i) => (
                                      <li key={i} className="flex items-center gap-1.5 text-[11px] text-gray-600">
                                        <span className="font-medium text-gray-700">{ing.product}</span>
                                        <span className="text-gray-400">{ing.qty} {ing.uom}</span>
                                        <Badge variant="outline" className="border-gray-200 bg-white text-[9px] text-gray-500">
                                          {SERVICE_MODE_LABEL[ing.serviceMode]}
                                        </Badge>
                                        {ing.modifier && (
                                          <Badge variant="outline" className={`text-[9px] ${ing.modifier === "Iced" ? "border-sky-200 bg-sky-50 text-sky-600" : "border-orange-200 bg-orange-50 text-orange-600"}`}>
                                            {ing.modifier}
                                          </Badge>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              );
                            })()}
                          </div>
                        ) : (
                          /* ── Read-only mode ── */
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-gray-400">
                                <th className="pb-1 text-left font-medium">Item</th>
                                <th className="pb-1 text-left font-medium">SKU</th>
                                <th className="pb-1 text-right font-medium">Qty</th>
                                <th className="pb-1 text-left font-medium">UOM</th>
                                <th className="pb-1 text-center font-medium">Channel</th>
                                <th className="pb-1 text-right font-medium">Unit Cost</th>
                                <th className="pb-1 text-right font-medium">Cost</th>
                              </tr>
                            </thead>
                            <tbody>
                              {/* Same ingredient on Hot + Iced is shown on ONE row (quantities
                                  stacked) so the recipe is easy to read; ingredients first,
                                  then packaging. */}
                              {(() => {
                                const groups = new Map<string, Ingredient[]>();
                                for (const ing of menu.ingredients) {
                                  const k = `${ing.source ?? "bom"}|${ing.productId}|${ing.serviceMode}`;
                                  const arr = groups.get(k);
                                  if (arr) arr.push(ing);
                                  else groups.set(k, [ing]);
                                }
                                const modOrder = (m?: string | null) => (m === "Iced" ? 0 : m === "Hot" ? 1 : 2);
                                const rows = [...groups.values()].sort((a, b) =>
                                  a[0].kind === b[0].kind ? 0 : a[0].kind === "ingredient" ? -1 : 1
                                );
                                return rows.map((lines, i) => {
                                  const f = lines[0];
                                  const parts = [...lines].sort((a, b) => modOrder(a.modifier) - modOrder(b.modifier));
                                  const tempSplit = parts.some((p) => p.modifier);
                                  return (
                                    <tr key={i} className="border-t border-gray-200/50 align-top">
                                      <td className="py-1.5 text-gray-700">
                                        <span className="inline-flex items-center gap-1.5">
                                          {f.product}
                                          {f.kind === "packaging" && (
                                            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[9px] text-amber-700">
                                              Packaging
                                            </Badge>
                                          )}
                                          {f.source === "rule" && (
                                            <Badge variant="outline" className="border-gray-200 bg-gray-50 text-[9px] text-gray-500">
                                              via rule
                                            </Badge>
                                          )}
                                        </span>
                                      </td>
                                      <td className="py-1.5"><code className="text-gray-500">{f.sku}</code></td>
                                      <td className="py-1.5 text-right text-gray-700">
                                        {tempSplit ? (
                                          <div className="flex flex-col items-end gap-0.5">
                                            {parts.map((p, j) => (
                                              <span key={j} className="inline-flex items-center gap-1">
                                                {p.modifier && (
                                                  <span className={`text-[9px] font-semibold ${p.modifier === "Iced" ? "text-sky-600" : "text-orange-600"}`}>
                                                    {p.modifier}
                                                  </span>
                                                )}
                                                <span>{p.qty}</span>
                                              </span>
                                            ))}
                                          </div>
                                        ) : (
                                          f.qty
                                        )}
                                      </td>
                                      <td className="py-1.5 text-gray-500">{f.uom}</td>
                                      <td className="py-1.5 text-center text-gray-500">
                                        {f.kind === "packaging" ? SERVICE_MODE_LABEL[f.serviceMode] : "—"}
                                      </td>
                                      <td className="py-1.5 text-right text-gray-500">
                                        {f.unitCost > 0 ? `RM ${f.unitCost.toFixed(4)}` : "—"}
                                      </td>
                                      <td className="py-1.5 text-right font-medium text-gray-700">
                                        {tempSplit ? (
                                          <div className="flex flex-col items-end gap-0.5">
                                            {parts.map((p, j) => (
                                              <span key={j}>{p.cost > 0 ? formatRM(p.cost) : "—"}</span>
                                            ))}
                                          </div>
                                        ) : (
                                          f.cost > 0 ? `${formatRM(f.cost)}` : "—"
                                        )}
                                      </td>
                                    </tr>
                                  );
                                });
                              })()}
                              {menu.ingredients.length === 0 && (
                                <tr>
                                  <td colSpan={7} className="py-4 text-center text-gray-400">
                                    No recipe yet. Click the pencil icon to add ingredients or packaging.
                                  </td>
                                </tr>
                              )}
                              {menu.ingredients.length > 0 && (
                                <>
                                  <tr className="border-t border-gray-300">
                                    <td colSpan={6} className="py-1.5 text-right font-medium text-gray-500">Ingredient cost</td>
                                    <td className="py-1.5 text-right font-medium text-gray-700">RM {menu.ingredientCost.toFixed(2)}</td>
                                  </tr>
                                  {menu.packagingCount > 0 ? (
                                    <>
                                      <tr className="border-t border-gray-200">
                                        <td colSpan={5} className="py-1 text-right text-[10px] uppercase tracking-wide text-gray-400">All-in COGS (incl. packaging)</td>
                                        <td className="py-1 text-right text-[10px] uppercase tracking-wide text-gray-400">Dine-in</td>
                                        <td className="py-1 text-right text-[10px] uppercase tracking-wide text-gray-400">Takeaway</td>
                                      </tr>
                                      {(menu.hasIcedHotSplit
                                        ? ([["Iced", menu.matrix.iced], ["Hot", menu.matrix.hot]] as const)
                                        : ([["", menu.matrix.iced]] as const)
                                      ).map(([label, row]) => (
                                        <tr key={label || "all"}>
                                          <td colSpan={5} className="py-1.5 text-right align-top font-semibold text-gray-600">
                                            {label ? <span className={label === "Iced" ? "text-sky-600" : "text-orange-600"}>{label} drink</span> : "Total"}
                                          </td>
                                          <td className="py-1.5 text-right align-top"><CogsCell c={row.dineIn} /></td>
                                          <td className="py-1.5 text-right align-top"><CogsCell c={row.takeaway} /></td>
                                        </tr>
                                      ))}
                                    </>
                                  ) : (
                                    <tr className="border-t border-gray-200">
                                      <td colSpan={6} className="py-1.5 text-right align-top font-semibold text-gray-600">Total COGS</td>
                                      <td className="py-1.5 text-right align-top"><CogsCell c={menu.matrix.iced.takeaway} /></td>
                                    </tr>
                                  )}
                                </>
                              )}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
