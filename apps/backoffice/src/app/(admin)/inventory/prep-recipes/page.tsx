"use client";

import { useMemo, useState } from "react";
import { formatRM } from "@celsius/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useFetch } from "@/lib/use-fetch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Search, Pencil, Trash2, ChefHat, Loader2, X, AlertTriangle } from "lucide-react";

/**
 * Prep recipes — the central-kitchen sub-BOM.
 *
 * Each row is one prepped product (e.g. "Grilled Chicken"), the raw inputs it
 * consumes, and how much a batch yields. The page's real job beyond data entry
 * is the cost check: computed cost-per-unit vs Central Preparation's list
 * price, so a stale or mis-keyed transfer price shows up instead of quietly
 * mis-valuing stock.
 */

type RecipeItem = {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  baseUom: string;
  quantityUsed: number;
  uom: string;
  unitCost: number;
  lineCost: number;
  costMissing: boolean;
};

type Recipe = {
  id: string;
  outputProductId: string;
  outputProductName: string;
  outputProductSku: string;
  outputBaseUom: string;
  yieldQuantity: number;
  yieldUom: string;
  prepNote: string | null;
  isActive: boolean;
  items: RecipeItem[];
  batchCost: number;
  costPerUnit: number;
  transferPrice: number | null;
  variance: number | null;
  variancePct: number | null;
  anyCostMissing: boolean;
};

type ProductOption = {
  id: string; name: string; sku: string; baseUom: string; itemType: string;
  packages: { id: string; conversionFactor: number }[];
  suppliers: { name: string; price: number; productPackageId: string | null }[];
};

/**
 * Cheapest cost per BASE unit for a product, from the data the products API
 * already returns. Mirrors the server's buildCostMap (price ÷ package
 * conversion, cheapest wins) so the dialog's live preview agrees with the
 * saved row's cost. Returns null when nothing is priced.
 */
function costPerBaseUnit(p: ProductOption | undefined): number | null {
  if (!p) return null;
  let best: number | null = null;
  for (const s of p.suppliers) {
    if (!(s.price > 0)) continue;
    const conv = s.productPackageId
      ? p.packages.find((pk) => pk.id === s.productPackageId)?.conversionFactor ?? 0
      : 0;
    if (!(conv > 0)) continue;
    const perBase = s.price / conv;
    if (best == null || perBase < best) best = perBase;
  }
  return best;
}

type FormLine = { productId: string; name: string; uom: string; quantityUsed: string };
type Form = {
  outputProductId: string;
  outputName: string;
  yieldQuantity: string;
  yieldUom: string;
  prepNote: string;
  isActive: boolean;
  lines: FormLine[];
};

const emptyForm: Form = {
  outputProductId: "", outputName: "", yieldQuantity: "", yieldUom: "",
  prepNote: "", isActive: true, lines: [],
};

// Beyond this the transfer price and the real raw cost have drifted enough to
// mis-value stock — worth surfacing rather than leaving buried in a report.
const VARIANCE_WARN_PCT = 10;

export default function PrepRecipesPage() {
  const { data: recipes = [], isLoading: loading, mutate: reload } =
    useFetch<Recipe[]>("/api/inventory/prep-recipes");
  const { data: products = [] } = useFetch<ProductOption[]>("/api/inventory/products");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputSearch, setOutputSearch] = useState("");
  const [inputSearch, setInputSearch] = useState("");
  const [listSearch, setListSearch] = useState("");

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((p) => ({ ...p, [k]: v }));

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // Products that already have a recipe can't take a second one (unique in the
  // DB) — hide them from the output picker unless we're editing that very row.
  const takenOutputIds = useMemo(
    () => new Set(recipes.filter((r) => r.id !== editingId).map((r) => r.outputProductId)),
    [recipes, editingId],
  );

  const openAdd = () => {
    setForm(emptyForm); setEditingId(null); setError(null);
    setOutputSearch(""); setInputSearch(""); setDialogOpen(true);
  };

  const openEdit = (r: Recipe) => {
    setForm({
      outputProductId: r.outputProductId,
      outputName: r.outputProductName,
      yieldQuantity: String(r.yieldQuantity),
      yieldUom: r.yieldUom,
      prepNote: r.prepNote ?? "",
      isActive: r.isActive,
      lines: r.items.map((i) => ({
        productId: i.productId, name: i.productName,
        uom: i.uom || i.baseUom, quantityUsed: String(i.quantityUsed),
      })),
    });
    setEditingId(r.id); setError(null);
    setOutputSearch(""); setInputSearch(""); setDialogOpen(true);
  };

  const addLine = (p: ProductOption) => {
    if (form.lines.some((l) => l.productId === p.id)) return; // unique per recipe
    set("lines", [...form.lines, { productId: p.id, name: p.name, uom: p.baseUom, quantityUsed: "" }]);
    setInputSearch("");
  };
  const removeLine = (productId: string) =>
    set("lines", form.lines.filter((l) => l.productId !== productId));
  const setLineQty = (productId: string, qty: string) =>
    set("lines", form.lines.map((l) => (l.productId === productId ? { ...l, quantityUsed: qty } : l)));

  // Live batch cost as the form is filled, so a wrong yield or quantity is
  // obvious before saving rather than after.
  const previewCost = useMemo(() => {
    const y = parseFloat(form.yieldQuantity);
    let batch = 0;
    let missing = false;
    for (const l of form.lines) {
      const q = parseFloat(l.quantityUsed);
      const unit = costPerBaseUnit(productById.get(l.productId));
      if (unit == null) missing = true;
      if (Number.isFinite(q) && unit != null) batch += q * unit;
    }
    return { batch, perUnit: y > 0 ? batch / y : 0, missing };
  }, [form.lines, form.yieldQuantity, productById]);

  const canSave =
    !!form.outputProductId &&
    parseFloat(form.yieldQuantity) > 0 &&
    form.lines.length > 0 &&
    form.lines.every((l) => parseFloat(l.quantityUsed) > 0);

  const save = async () => {
    if (!canSave) return;
    setSaving(true); setError(null);
    try {
      const payload = {
        outputProductId: form.outputProductId,
        yieldQuantity: parseFloat(form.yieldQuantity),
        yieldUom: form.yieldUom || productById.get(form.outputProductId)?.baseUom || "",
        prepNote: form.prepNote,
        isActive: form.isActive,
        items: form.lines.map((l) => ({
          productId: l.productId,
          quantityUsed: parseFloat(l.quantityUsed),
          uom: l.uom,
        })),
      };
      const res = await fetch(
        editingId ? `/api/inventory/prep-recipes/${editingId}` : "/api/inventory/prep-recipes",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Could not save the recipe");
        return;
      }
      setDialogOpen(false);
      reload();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: Recipe) => {
    if (!confirm(`Delete the prep recipe for ${r.outputProductName}? Its input lines go too.`)) return;
    const res = await fetch(`/api/inventory/prep-recipes/${r.id}`, { method: "DELETE" });
    if (res.ok) reload();
  };

  const visible = recipes.filter((r) =>
    !listSearch || r.outputProductName.toLowerCase().includes(listSearch.toLowerCase()),
  );

  const outputChoices = products
    .filter((p) => !takenOutputIds.has(p.id))
    .filter((p) => !outputSearch || p.name.toLowerCase().includes(outputSearch.toLowerCase()))
    .slice(0, 8);

  const inputChoices = products
    .filter((p) => p.id !== form.outputProductId && !form.lines.some((l) => l.productId === p.id))
    .filter((p) => !inputSearch || p.name.toLowerCase().includes(inputSearch.toLowerCase()))
    .slice(0, 8);

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">
            <ChefHat className="h-5 w-5 text-terracotta" /> Prep Recipes
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            What Central Preparation turns raw stock into — 10kg raw chicken → 10 pcs Grilled
            Chicken. Outlet menus consume the prepped item; this is the missing half that depletes
            the raw stock behind it and checks the transfer price against real raw cost.
          </p>
        </div>
        <Button onClick={openAdd} className="shrink-0">
          <Plus className="mr-1 h-4 w-4" /> Add recipe
        </Button>
      </div>

      <div className="relative max-w-xs">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          value={listSearch}
          onChange={(e) => setListSearch(e.target.value)}
          placeholder="Search prepped item…"
          className="pl-8"
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading recipes…
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 py-14 text-center">
          <ChefHat className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-2 text-sm font-medium text-gray-700">No prep recipes yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-gray-500">
            Until a prepped item has a recipe, its raw inputs never deplete in theory and show up
            as pure variance in the consumption report.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => {
            const drift = r.variancePct != null && Math.abs(r.variancePct) > VARIANCE_WARN_PCT;
            return (
              <div key={r.id} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900">{r.outputProductName}</span>
                      <Badge className="border-gray-200 bg-gray-50 text-gray-600">
                        yields {r.yieldQuantity} {r.yieldUom}
                      </Badge>
                      {!r.isActive && (
                        <Badge className="border-gray-200 bg-gray-100 text-gray-500">Inactive</Badge>
                      )}
                      {r.anyCostMissing && (
                        <Badge className="border-amber-200 bg-amber-50 text-amber-700">
                          <AlertTriangle className="mr-1 inline h-3 w-3" />
                          Input not priced
                        </Badge>
                      )}
                    </div>
                    {r.prepNote && <p className="mt-1 text-xs text-gray-500">{r.prepNote}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(r)}>
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </Button>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-md bg-gray-50 p-3">
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                      Raw inputs
                    </p>
                    <ul className="space-y-1">
                      {r.items.map((i) => (
                        <li key={i.id} className="flex justify-between gap-3 text-xs text-gray-700">
                          <span className="truncate">
                            {i.productName}
                            <span className="text-gray-400"> · {i.quantityUsed} {i.uom || i.baseUom}</span>
                          </span>
                          <span className={i.costMissing ? "text-amber-600" : "text-gray-500"}>
                            {i.costMissing ? "no price" : formatRM(i.lineCost)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-md bg-gray-50 p-3">
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                      Cost check
                    </p>
                    <dl className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <dt className="text-gray-500">Batch cost</dt>
                        <dd className="text-gray-800">{formatRM(r.batchCost)}</dd>
                      </div>
                      {/* Per-BASE-unit figures need 4dp: a gram-based prep item
                          costs ~RM0.03/g, which 2dp rounds into uselessness. */}
                      <div className="flex justify-between">
                        <dt className="text-gray-500">Computed / {r.outputBaseUom}</dt>
                        <dd className="font-medium text-gray-900">{formatRM(r.costPerUnit, { decimals: 4 })}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-gray-500">Central Prep price</dt>
                        <dd className="text-gray-800">
                          {r.transferPrice != null ? formatRM(r.transferPrice, { decimals: 4 }) : "—"}
                        </dd>
                      </div>
                      {r.variance != null && (
                        <div className="flex justify-between border-t border-gray-200 pt-1">
                          <dt className="text-gray-500">Difference</dt>
                          <dd className={drift ? "font-medium text-amber-700" : "text-gray-600"}>
                            {r.variance > 0 ? "+" : ""}{formatRM(r.variance, { decimals: 4 })}
                            {r.variancePct != null && ` (${r.variancePct > 0 ? "+" : ""}${r.variancePct}%)`}
                          </dd>
                        </div>
                      )}
                    </dl>
                    {drift && (
                      <p className="mt-1.5 text-[11px] text-amber-700">
                        Transfer price is {r.variancePct! > 0 ? "below" : "above"} computed raw cost —
                        stock is valued {r.variancePct! > 0 ? "lean" : "rich"}.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit prep recipe" : "New prep recipe"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Prepped item (output)</label>
              {form.outputProductId ? (
                <div className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2">
                  <span className="text-sm text-gray-800">{form.outputName}</span>
                  {!editingId && (
                    <button onClick={() => { set("outputProductId", ""); set("outputName", ""); }}>
                      <X className="h-3.5 w-3.5 text-gray-400" />
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <Input
                    value={outputSearch}
                    onChange={(e) => setOutputSearch(e.target.value)}
                    placeholder="Search the prepped product…"
                  />
                  {outputSearch && (
                    <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-gray-200">
                      {outputChoices.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => {
                            set("outputProductId", p.id); set("outputName", p.name);
                            if (!form.yieldUom) set("yieldUom", p.baseUom);
                            setOutputSearch("");
                          }}
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                        >
                          {p.name} <span className="text-xs text-gray-400">{p.sku}</span>
                        </button>
                      ))}
                      {outputChoices.length === 0 && (
                        <p className="px-3 py-2 text-xs text-gray-500">
                          No match — items with a recipe already are hidden.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Batch yields</label>
                <Input
                  type="number"
                  value={form.yieldQuantity}
                  onChange={(e) => set("yieldQuantity", e.target.value)}
                  placeholder="10"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Unit</label>
                <Input
                  value={form.yieldUom}
                  onChange={(e) => set("yieldUom", e.target.value)}
                  placeholder="pcs"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Raw inputs</label>
              {form.lines.length > 0 && (
                <div className="mb-2 space-y-1.5">
                  {form.lines.map((l) => (
                    <div key={l.productId} className="flex items-center gap-2">
                      <span className="flex-1 truncate text-sm text-gray-800">{l.name}</span>
                      <Input
                        type="number"
                        value={l.quantityUsed}
                        onChange={(e) => setLineQty(l.productId, e.target.value)}
                        placeholder="qty"
                        className="w-24"
                      />
                      <span className="w-10 text-xs text-gray-500">{l.uom}</span>
                      <button onClick={() => removeLine(l.productId)}>
                        <X className="h-3.5 w-3.5 text-gray-400" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <Input
                value={inputSearch}
                onChange={(e) => setInputSearch(e.target.value)}
                placeholder="Add a raw input…"
              />
              {inputSearch && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-gray-200">
                  {inputChoices.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addLine(p)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                    >
                      {p.name} <span className="text-xs text-gray-400">{p.baseUom}</span>
                    </button>
                  ))}
                  {inputChoices.length === 0 && (
                    <p className="px-3 py-2 text-xs text-gray-500">No match.</p>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Prep note (optional)</label>
              <Input
                value={form.prepNote}
                onChange={(e) => set("prepNote", e.target.value)}
                placeholder="Marinate overnight, grill 8 min each side"
              />
            </div>

            {previewCost.batch > 0 && (
              <div className="rounded-md bg-gray-50 p-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">Batch cost</span>
                  <span className="text-gray-800">{formatRM(previewCost.batch)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Per {form.yieldUom || "unit"}</span>
                  <span className="font-medium text-gray-900">
                    {formatRM(previewCost.perUnit, { decimals: 4 })}
                  </span>
                </div>
                {previewCost.missing && (
                  <p className="mt-1 text-[11px] text-amber-700">
                    Some inputs have no supplier price — batch cost is understated.
                  </p>
                )}
              </div>
            )}

            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={save} disabled={!canSave || saving}>
                {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                {editingId ? "Save changes" : "Create recipe"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
