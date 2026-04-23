"use client";

import { useState, Fragment } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Pencil, ChevronDown, Coffee, Search, Loader2, Trash2, X, Check, RefreshCw } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type Ingredient = { product: string; productId: string; sku: string; qty: number; uom: string; unitCost: number; cost: number };

type MenuItem = {
  id: string;
  name: string;
  category: string;
  sellingPrice: number;
  cogs: number;
  cogsPercent: number;
  ingredientCount: number;
  ingredients: Ingredient[];
};

type ProductOption = {
  id: string;
  name: string;
  sku: string;
  baseUom: string;
};

type EditIngredient = {
  productId: string;
  productName: string;
  sku: string;
  quantityUsed: number;
  uom: string;
};

export default function MenusPage() {
  const { data: menus = [], isLoading: loading, mutate: loadMenus } = useFetch<MenuItem[]>("/api/inventory/menus");
  const { data: products = [] } = useFetch<ProductOption[]>("/api/inventory/products");
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("All");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Editing state
  const [editingMenuId, setEditingMenuId] = useState<string | null>(null);
  const [editIngredients, setEditIngredients] = useState<EditIngredient[]>([]);
  const [saving, setSaving] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ created: number; updated: number } | null>(null);

  const categories = ["All", ...new Set(menus.map((m) => m.category).filter(Boolean))];

  const filtered = menus.filter((m) => {
    const matchSearch = m.name.toLowerCase().includes(search.toLowerCase());
    const matchCat = catFilter === "All" || m.category === catFilter;
    return matchSearch && matchCat;
  });

  // ── Edit helpers ────────────────────────────────────────────────────────

  const startEditing = (menu: MenuItem) => {
    setEditingMenuId(menu.id);
    setExpandedId(menu.id);
    setEditIngredients(
      menu.ingredients.map((ing) => ({
        productId: ing.productId,
        productName: ing.product,
        sku: ing.sku,
        quantityUsed: ing.qty,
        uom: ing.uom,
      }))
    );
    setAddSearch("");
  };

  const cancelEditing = () => {
    setEditingMenuId(null);
    setEditIngredients([]);
    setAddSearch("");
  };

  const updateIngredientQty = (productId: string, value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return;
    setEditIngredients((prev) =>
      prev.map((ing) =>
        ing.productId === productId ? { ...ing, quantityUsed: num } : ing
      )
    );
  };

  const removeIngredient = (productId: string) => {
    setEditIngredients((prev) => prev.filter((ing) => ing.productId !== productId));
  };

  const addIngredient = (product: ProductOption) => {
    if (editIngredients.some((ing) => ing.productId === product.id)) return;
    setEditIngredients((prev) => [
      ...prev,
      { productId: product.id, productName: product.name, sku: product.sku, quantityUsed: 0, uom: product.baseUom },
    ]);
    setAddSearch("");
  };

  const saveIngredients = async () => {
    if (!editingMenuId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/inventory/menus/${editingMenuId}/ingredients`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredients: editIngredients.map((ing) => ({
            productId: ing.productId,
            quantityUsed: ing.quantityUsed,
            uom: ing.uom,
          })),
        }),
      });
      if (res.ok) {
        cancelEditing();
        loadMenus();
      }
    } finally {
      setSaving(false);
    }
  };

  // Product search results for adding
  const addSearchResults = addSearch.trim().length >= 2
    ? products
        .filter((p) =>
          !editIngredients.some((ing) => ing.productId === p.id) &&
          (p.name.toLowerCase().includes(addSearch.toLowerCase()) ||
           p.sku.toLowerCase().includes(addSearch.toLowerCase()))
        )
        .slice(0, 8)
    : [];

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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Menu & Recipes (BOM)</h2>
          <p className="mt-0.5 text-sm text-gray-500">{menus.length} menu items with ingredient costing</p>
        </div>
        <Button
          onClick={async () => {
            setSyncing(true);
            setSyncResult(null);
            try {
              const res = await fetch("/api/inventory/storehub/sync-products", { method: "POST" });
              const data = await res.json();
              if (res.ok) {
                setSyncResult({ created: data.created, updated: data.updated });
                loadMenus();
              }
            } finally {
              setSyncing(false);
            }
          }}
          disabled={syncing}
          variant="outline"
          className="gap-1.5"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing..." : "Sync from StoreHub"}
        </Button>
      </div>
      {syncResult && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
          <Check className="h-3.5 w-3.5" />
          Synced — {syncResult.created} new, {syncResult.updated} updated
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Search menu items..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1.5">
          {categories.map((c) => (
            <button key={c} onClick={() => setCatFilter(c)} className={`rounded-full border px-3 py-1 text-xs transition-colors ${catFilter === c ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500"}`}>{c}</button>
          ))}
        </div>
      </div>

      {/* Menu table with expandable ingredients */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="w-8 px-3 py-3"></th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Menu Item</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Category</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Selling Price</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Product Cost</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">COGS %</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Ingredients</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((menu) => {
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
                      {menu.cogs > 0 ? `RM ${menu.cogs.toFixed(2)}` : <span className="text-gray-300">—</span>}
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
                                  <th className="pb-1 text-left font-medium">Ingredient</th>
                                  <th className="pb-1 text-left font-medium w-20">SKU</th>
                                  <th className="pb-1 w-28 text-right font-medium">Qty</th>
                                  <th className="pb-1 w-20 text-center font-medium">UOM</th>
                                  <th className="pb-1 w-8"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {editIngredients.map((ing) => (
                                  <tr key={ing.productId} className="border-t border-gray-200/50">
                                    <td className="py-1.5 text-gray-700">{ing.productName}</td>
                                    <td className="py-1.5"><code className="text-gray-500">{ing.sku}</code></td>
                                    <td className="py-1.5 text-right">
                                      <input
                                        type="number"
                                        step="any"
                                        min="0"
                                        value={ing.quantityUsed}
                                        onChange={(e) => updateIngredientQty(ing.productId, e.target.value)}
                                        className="w-24 rounded border border-gray-200 px-2 py-1 text-right text-xs"
                                      />
                                    </td>
                                    <td className="py-1.5 text-center text-xs text-gray-500">
                                      {ing.uom}
                                    </td>
                                    <td className="py-1.5 text-center">
                                      <button onClick={() => removeIngredient(ing.productId)} className="text-red-400 hover:text-red-600">
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                                {editIngredients.length === 0 && (
                                  <tr>
                                    <td colSpan={5} className="py-4 text-center text-gray-400">
                                      No ingredients yet. Search below to add products.
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
                                      <span className="font-medium text-gray-700">{product.name}</span>
                                      <span className="text-gray-400">{product.sku} &middot; {product.baseUom}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          /* ── Read-only mode ── */
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-gray-400">
                                <th className="pb-1 text-left font-medium">Ingredient</th>
                                <th className="pb-1 text-left font-medium">SKU</th>
                                <th className="pb-1 text-right font-medium">Qty</th>
                                <th className="pb-1 text-left font-medium">UOM</th>
                                <th className="pb-1 text-right font-medium">Unit Cost</th>
                                <th className="pb-1 text-right font-medium">Cost</th>
                              </tr>
                            </thead>
                            <tbody>
                              {menu.ingredients.map((ing, i) => (
                                <tr key={i} className="border-t border-gray-200/50">
                                  <td className="py-1.5 text-gray-700">{ing.product}</td>
                                  <td className="py-1.5"><code className="text-gray-500">{ing.sku}</code></td>
                                  <td className="py-1.5 text-right text-gray-700">{ing.qty}</td>
                                  <td className="py-1.5 text-gray-500">{ing.uom}</td>
                                  <td className="py-1.5 text-right text-gray-500">
                                    {ing.unitCost > 0 ? `RM ${ing.unitCost.toFixed(4)}` : "—"}
                                  </td>
                                  <td className="py-1.5 text-right font-medium text-gray-700">
                                    {ing.cost > 0 ? `RM ${ing.cost.toFixed(2)}` : "—"}
                                  </td>
                                </tr>
                              ))}
                              {menu.ingredients.length === 0 && (
                                <tr>
                                  <td colSpan={6} className="py-4 text-center text-gray-400">
                                    No ingredients mapped. Click the pencil icon to add.
                                  </td>
                                </tr>
                              )}
                              {menu.ingredients.length > 0 && (
                                <tr className="border-t border-gray-300">
                                  <td colSpan={5} className="py-1.5 text-right font-semibold text-gray-600">Total Product Cost</td>
                                  <td className="py-1.5 text-right font-bold text-gray-900">RM {menu.cogs.toFixed(2)}</td>
                                </tr>
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

      {/* Summary */}
      {(() => {
        const withCogs = menus.filter((m) => m.cogs > 0);
        const avgCogs = withCogs.length > 0 ? withCogs.reduce((s, m) => s + m.cogsPercent, 0) / withCogs.length : 0;
        const mapped = menus.filter((m) => m.ingredientCount > 0).length;
        return (
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="px-4 py-3">
              <p className="text-xs text-gray-500">Total Menu Items</p>
              <p className="text-xl font-bold text-gray-900">{menus.length}</p>
              <p className="text-xs text-gray-400">{mapped} with recipes</p>
            </Card>
            <Card className="px-4 py-3">
              <p className="text-xs text-gray-500">Ingredients Mapped</p>
              <p className="text-xl font-bold text-gray-900">{menus.reduce((a, m) => a + m.ingredientCount, 0)}</p>
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
              <p className="text-xl font-bold text-gray-900">{menus.length - mapped}</p>
              <p className="text-xs text-gray-400">need ingredients</p>
            </Card>
          </div>
        );
      })()}
    </div>
  );
}
