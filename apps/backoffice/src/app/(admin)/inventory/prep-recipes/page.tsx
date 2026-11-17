"use client";

import { useMemo, useState } from "react";
import { formatRM } from "@celsius/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFetch } from "@/lib/use-fetch";
import { KeyNumber } from "@/components/ui/key-number";
import { Plus, Search, Pencil, Trash2, Loader2, X, ArrowLeft, ChevronDown } from "lucide-react";

/**
 * Prep recipes — the prep sub-BOM (raw → prepped). Celsius has no central
 * kitchen: prep happens at the outlets.
 *
 * Each row is one prepped product, the raw inputs it consumes, and how much a
 * batch yields. Beyond data entry the page's job is the cost check: computed
 * cost per unit vs the prepped item's listed price (`transferPrice` from the
 * API), so a stale or mis-keyed price shows up instead of quietly mis-valuing
 * stock.
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
  prepMinutes: number | null;
  minutesPerUnit: number | null;
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
  prepMinutes: string;
  isActive: boolean;
  lines: FormLine[];
};

const emptyForm: Form = {
  outputProductId: "", outputName: "", yieldQuantity: "", yieldUom: "",
  prepNote: "", prepMinutes: "", isActive: true, lines: [],
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
  const [expanded, setExpanded] = useState<string | null>(null);

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
    setOutputSearch(""); setInputSearch(""); setDialogOpen(true); window.scrollTo(0, 0);
  };

  const openEdit = (r: Recipe) => {
    setForm({
      outputProductId: r.outputProductId,
      outputName: r.outputProductName,
      yieldQuantity: String(r.yieldQuantity),
      yieldUom: r.yieldUom,
      prepNote: r.prepNote ?? "",
      prepMinutes: r.prepMinutes != null ? String(r.prepMinutes) : "",
      isActive: r.isActive,
      lines: r.items.map((i) => ({
        productId: i.productId, name: i.productName,
        uom: i.uom || i.baseUom, quantityUsed: String(i.quantityUsed),
      })),
    });
    setEditingId(r.id); setError(null);
    setOutputSearch(""); setInputSearch(""); setDialogOpen(true); window.scrollTo(0, 0);
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
        // "" means not timed — the API stores null, never zero.
        prepMinutes: form.prepMinutes.trim() === "" ? null : Number(form.prepMinutes),
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

  const active = recipes.filter((r) => r.isActive);
  const drifting = recipes.filter((r) => r.variancePct != null && Math.abs(r.variancePct) > VARIANCE_WARN_PCT).length;
  const unpriced = recipes.filter((r) => r.anyCostMissing).length;
  const untimed = recipes.filter((r) => r.prepMinutes == null).length;

  if (dialogOpen) {
    // Add / edit: a full page (dynamic input rows), not a modal.
    return (
      <div className="max-w-[960px] px-4 pt-6 pb-10 md:px-8">
        <button onClick={() => setDialogOpen(false)} className="inline-flex items-center gap-1.5 text-sm text-text-2 hover:text-text"><ArrowLeft className="h-4 w-4" /> All prep recipes</button>
        <h1 className="mt-3 text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">{editingId ? "Edit prep recipe" : "New prep recipe"}</h1>
        <p className="mt-0.5 text-sm text-text-2">What one batch uses, what it makes, and how long it takes one person.</p>
          <div className="mt-5 space-y-5">
            <div>
              <label className="mb-1 block text-[13px] font-medium text-text-2">Prepped item (output)</label>
              {form.outputProductId ? (
                <div className="flex items-center justify-between rounded-md border border-line px-3 py-2">
                  <span className="text-sm text-text">{form.outputName}</span>
                  {!editingId && (
                    <button onClick={() => { set("outputProductId", ""); set("outputName", ""); }}>
                      <X className="h-3.5 w-3.5 text-text-3" />
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
                    <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-line">
                      {outputChoices.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => {
                            set("outputProductId", p.id); set("outputName", p.name);
                            if (!form.yieldUom) set("yieldUom", p.baseUom);
                            setOutputSearch("");
                          }}
                          className="block w-full px-3 py-2.5 text-left text-sm hover:bg-sunken"
                        >
                          {p.name} <span className="text-xs text-text-3">{p.sku}</span>
                        </button>
                      ))}
                      {outputChoices.length === 0 && (
                        <p className="px-3 py-2 text-xs text-text-2">
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
                <label className="mb-1 block text-[13px] font-medium text-text-2">Batch yields</label>
                <Input
                  type="number"
                  value={form.yieldQuantity}
                  onChange={(e) => set("yieldQuantity", e.target.value)}
                  placeholder="10"
                />
              </div>
              <div>
                <label className="mb-1 block text-[13px] font-medium text-text-2">Unit</label>
                <Input
                  value={form.yieldUom}
                  onChange={(e) => set("yieldUom", e.target.value)}
                  placeholder="pcs"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[13px] font-medium text-text-2">
                Prep time — one person, one batch (minutes)
              </label>
              <Input
                type="number"
                value={form.prepMinutes}
                onChange={(e) => set("prepMinutes", e.target.value)}
                placeholder="e.g. 45"
              />
              <p className="mt-1 text-[11px] text-text-3">
                Hands-on minutes for ONE person to finish the whole batch. Leave blank if not timed
                yet — the prep hours report counts untimed recipes separately instead of assuming
                they are free.
                {form.prepMinutes.trim() !== "" && parseFloat(form.yieldQuantity) > 0 && (
                  <> That is{" "}
                    <span className="font-medium text-text-2">
                      {(Number(form.prepMinutes) / parseFloat(form.yieldQuantity)).toFixed(2)} min
                    </span>{" "}
                    per {form.yieldUom || "unit"}.
                  </>
                )}
              </p>
            </div>

            <div>
              <label className="mb-1 block text-[13px] font-medium text-text-2">Raw inputs</label>
              {form.lines.length > 0 && (
                <div className="mb-2 space-y-1.5">
                  {form.lines.map((l) => (
                    <div key={l.productId} className="flex items-center gap-2">
                      <span className="flex-1 truncate text-sm text-text">{l.name}</span>
                      <Input
                        type="number"
                        value={l.quantityUsed}
                        onChange={(e) => setLineQty(l.productId, e.target.value)}
                        placeholder="qty"
                        className="w-24"
                      />
                      <span className="w-10 text-xs text-text-2">{l.uom}</span>
                      <button onClick={() => removeLine(l.productId)} aria-label={`Remove ${l.name}`} className="flex h-9 w-9 items-center justify-center rounded-ctl hover:bg-sunken">
                        <X className="h-4 w-4 text-text-3" />
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
                <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-line">
                  {inputChoices.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addLine(p)}
                      className="block w-full px-3 py-2.5 text-left text-sm hover:bg-sunken"
                    >
                      {p.name} <span className="text-xs text-text-3">{p.baseUom}</span>
                    </button>
                  ))}
                  {inputChoices.length === 0 && (
                    <p className="px-3 py-2 text-xs text-text-2">No match.</p>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-[13px] font-medium text-text-2">Prep note (optional)</label>
              <Input
                value={form.prepNote}
                onChange={(e) => set("prepNote", e.target.value)}
                placeholder="Marinate overnight, grill 8 min each side"
              />
            </div>

            {previewCost.batch > 0 && (
              <div className="rounded-md bg-sunken p-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-text-2">Batch cost</span>
                  <span className="text-text">{formatRM(previewCost.batch)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-2">Per {form.yieldUom || "unit"}</span>
                  <span className="font-medium text-text">
                    {formatRM(previewCost.perUnit, { decimals: 4 })}
                  </span>
                </div>
                {previewCost.missing && (
                  <p className="mt-1 text-[11px] text-warn-text">
                    Some inputs have no supplier price — batch cost is understated.
                  </p>
                )}
              </div>
            )}

            {error && (
              <p className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger-text">{error}</p>
            )}

            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={save} disabled={!canSave || saving} className="bg-ink text-on-ink hover:bg-ink-hover">
                {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                {editingId ? "Save changes" : "Create recipe"}
              </Button>
            </div>
          </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] space-y-5 px-4 pt-6 pb-10 md:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Prep recipes</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-text-2">What the outlets make from raw stock before it goes into a drink or dish, what a batch costs, and whether its price still matches.</p>
        </div>
        <Button onClick={openAdd} className="shrink-0 bg-ink text-on-ink hover:bg-ink-hover">
          <Plus className="mr-1.5 h-4 w-4" /> Add recipe
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KeyNumber label="Recipes in use" value={loading ? null : String(active.length)} note={<>of <b className="font-semibold text-text-2">{recipes.length}</b> recipes</>} />
        <KeyNumber label="Price off by over 10%" value={loading ? null : String(drifting)} tone={drifting > 0 ? "warn" : undefined}
          note={drifting > 0 ? "listed price and raw cost disagree" : "prices match raw cost"} />
        <KeyNumber label="Inputs not priced" value={loading ? null : String(unpriced)} tone={unpriced > 0 ? "warn" : undefined}
          note={unpriced > 0 ? "batch cost is understated" : "every input has a price"} />
        <KeyNumber label="Not timed" value={loading ? null : String(untimed)} note="prep hours unknown for these" />
      </div>

      <div className="relative sm:max-w-xs">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
        <Input value={listSearch} onChange={(e) => setListSearch(e.target.value)} placeholder="Search prepped item…" className="pl-9" />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-text-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading recipes…</div>
      ) : visible.length === 0 ? (
        <div className="rounded-card border border-line bg-surface px-4 py-12 text-center">
          <p className="text-sm font-medium text-text-2">No prep recipes yet</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-text-3">Until a prepped item has a recipe, its raw inputs never come off stock and show up as unexplained usage.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          {visible.map((r) => {
            const drift = r.variancePct != null && Math.abs(r.variancePct) > VARIANCE_WARN_PCT;
            const open = expanded === r.id;
            return (
              <div key={r.id} className={`border-b border-line last:border-b-0 ${!r.isActive ? "opacity-60" : ""}`}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <button onClick={() => setExpanded(open ? null : r.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open}>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-text-3 transition-transform ${open ? "rotate-180" : ""}`} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-text">{r.outputProductName}{!r.isActive && <span className="font-normal text-text-3"> · not in use</span>}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-text-3">
                        Batch makes {r.yieldQuantity} {r.yieldUom} · <span className="font-mono">{formatRM(r.costPerUnit, { decimals: 4 })}</span> per {r.outputBaseUom}
                        {r.prepMinutes != null ? ` · ${r.prepMinutes} min a batch` : " · not timed"}
                      </span>
                    </span>
                  </button>
                  {r.anyCostMissing && <span className="hidden shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-[12px] text-warn-text sm:inline">Input not priced</span>}
                  {drift && <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-[12px] text-warn-text">{r.variancePct! > 0 ? "+" : ""}{r.variancePct}%</span>}
                  <button onClick={() => openEdit(r)} aria-label={`Edit ${r.outputProductName}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl text-text-3 hover:bg-sunken hover:text-text"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => remove(r)} aria-label={`Delete ${r.outputProductName}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl text-text-3 hover:bg-danger-soft hover:text-danger-text"><Trash2 className="h-4 w-4" /></button>
                </div>
                {open && (
                  // Full-width inline expansion, not a drawer.
                  <div className="grid gap-3 px-4 pb-4 md:grid-cols-2">
                    <div className="rounded-ctl bg-sunken p-3">
                      <p className="mb-1.5 text-[12px] font-medium text-text-2">Raw inputs</p>
                      <ul className="space-y-1">
                        {r.items.map((i) => (
                          <li key={i.id} className="flex justify-between gap-3 text-[13px] text-text-2">
                            <span className="truncate">{i.productName}<span className="text-text-3"> · {i.quantityUsed} {i.uom || i.baseUom}</span></span>
                            <span className={`font-mono ${i.costMissing ? "text-warn-text" : "text-text-2"}`}>{i.costMissing ? "no price" : formatRM(i.lineCost)}</span>
                          </li>
                        ))}
                      </ul>
                      {r.prepNote && <p className="mt-2 text-[12px] text-text-3">{r.prepNote}</p>}
                    </div>
                    <div className="rounded-ctl bg-sunken p-3">
                      <p className="mb-1.5 text-[12px] font-medium text-text-2">Cost check</p>
                      {/* Per-base-unit figures need 4dp: a gram-based prep item costs ~RM0.03/g. */}
                      <dl className="space-y-1 text-[13px]">
                        <div className="flex justify-between"><dt className="text-text-2">Batch cost</dt><dd className="font-mono text-text">{formatRM(r.batchCost)}</dd></div>
                        <div className="flex justify-between"><dt className="text-text-2">Raw cost per {r.outputBaseUom}</dt><dd className="font-mono font-medium text-text">{formatRM(r.costPerUnit, { decimals: 4 })}</dd></div>
                        <div className="flex justify-between"><dt className="text-text-2">Listed price per {r.outputBaseUom}</dt><dd className="font-mono text-text">{r.transferPrice != null ? formatRM(r.transferPrice, { decimals: 4 }) : "–"}</dd></div>
                        {r.variance != null && (
                          <div className="flex justify-between border-t border-line pt-1">
                            <dt className="text-text-2">Difference</dt>
                            <dd className={`font-mono ${drift ? "font-medium text-warn-text" : "text-text-2"}`}>{r.variance > 0 ? "+" : ""}{formatRM(r.variance, { decimals: 4 })}{r.variancePct != null && ` (${r.variancePct > 0 ? "+" : ""}${r.variancePct}%)`}</dd>
                          </div>
                        )}
                      </dl>
                      {drift && <p className="mt-1.5 text-[12px] text-warn-text">The listed price is {r.variancePct! > 0 ? "below" : "above"} the raw cost, so this stock is valued {r.variancePct! > 0 ? "too low" : "too high"}.</p>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
