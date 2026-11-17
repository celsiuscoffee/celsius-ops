"use client";

import { useState } from "react";
import { formatRM } from "@celsius/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFetch } from "@/lib/use-fetch";
import { KeyNumber } from "@/components/ui/key-number";
import { Plus, Search, Pencil, Trash2, Loader2, X, Check, ArrowLeft } from "lucide-react";

type Scope = "ALL" | "CATEGORY" | "ITEMS";
type Channel = "ALL" | "DINE_IN" | "TAKEAWAY" | "GRAB" | "DELIVERY";

const SCOPE_LABEL: Record<Scope, string> = {
  ALL: "All menu items",
  CATEGORY: "Category",
  ITEMS: "Specific items",
};
const CHANNEL_LABEL: Record<Channel, string> = {
  ALL: "All",
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  GRAB: "Grab",
  DELIVERY: "Delivery",
};
const CHANNEL_BADGE: Record<Channel, string> = {
  ALL: "bg-sunken text-text-2",
  DINE_IN: "bg-info-soft text-info-text",
  TAKEAWAY: "bg-warn-soft text-warn-text",
  GRAB: "bg-ok-soft text-ok-text",
  DELIVERY: "bg-info-soft text-info-text",
};

type Rule = {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  baseUom: string;
  quantity: number;
  scope: Scope;
  category: string | null;
  menuIds: string[];
  channel: Channel;
  modifier: string | null; // null = any temperature; "Iced" / "Hot"
  perOrder: boolean;
  isActive: boolean;
  notes: string | null;
  unitCost: number;
  lineCost: number;
  matchedMenuCount: number;
};

type ProductOption = { id: string; name: string; sku: string; baseUom: string; itemType: string };
type MenuLite = { id: string; name: string; category: string };

type PickedItem = { id: string; name: string; sku: string };

type Form = {
  // One or more packaging items (Add can fan out into a rule per item). Edit
  // keeps exactly one.
  items: PickedItem[];
  quantity: string;
  scope: Scope;
  // One or more categories when scope = CATEGORY (Add can fan out per category).
  categories: string[];
  menuIds: string[];
  channel: Channel;
  modifier: string; // "" = any; "Iced" / "Hot"
  perOrder: boolean;
  isActive: boolean;
  notes: string;
};

const emptyForm: Form = {
  items: [], quantity: "1",
  scope: "ALL", categories: [], menuIds: [], channel: "ALL",
  modifier: "", perOrder: false, isActive: true, notes: "",
};

export default function PackagingPage() {
  const { data: rules = [], isLoading: loading, mutate: reload } = useFetch<Rule[]>("/api/inventory/packaging-rules");
  const { data: products = [] } = useFetch<ProductOption[]>("/api/inventory/products");
  const { data: menus = [] } = useFetch<MenuLite[]>("/api/inventory/menus");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [menuSearch, setMenuSearch] = useState("");

  const categories = [...new Set(menus.map((m) => m.category).filter(Boolean))].sort();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((p) => ({ ...p, [k]: v }));

  const closeForm = () => { setDialogOpen(false); setEditingId(null); setForm(emptyForm); };
  const openAdd = () => { setForm(emptyForm); setEditingId(null); setProductSearch(""); setMenuSearch(""); setDialogOpen(true); window.scrollTo(0, 0); };
  const openEdit = (r: Rule) => {
    setForm({
      items: [{ id: r.productId, name: r.productName, sku: r.productSku }],
      quantity: String(r.quantity), scope: r.scope, categories: r.category ? [r.category] : [],
      menuIds: r.menuIds, channel: r.channel, modifier: r.modifier ?? "",
      perOrder: r.perOrder, isActive: r.isActive,
      notes: r.notes ?? "",
    });
    setEditingId(r.id); setProductSearch(""); setMenuSearch(""); setDialogOpen(true); window.scrollTo(0, 0);
  };

  // How many rules a submit will create: one per (item × category) for Add.
  const targetCount = form.scope === "CATEGORY" ? Math.max(form.categories.length, 1) : 1;
  const createCount = form.items.length * targetCount;

  const save = async () => {
    if (!form.items.length) return;
    setSaving(true);
    try {
      const common = {
        quantity: parseFloat(form.quantity) || 1,
        scope: form.scope,
        menuIds: form.menuIds,
        channel: form.channel,
        modifier: form.modifier,
        perOrder: form.perOrder,
        isActive: form.isActive,
        notes: form.notes,
      };
      const url = editingId ? `/api/inventory/packaging-rules/${editingId}` : "/api/inventory/packaging-rules";
      const body = editingId
        ? { ...common, productId: form.items[0].id, category: form.categories[0] ?? "" }
        : { ...common, productIds: form.items.map((i) => i.id), categories: form.categories };
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) { alert("Failed to save packaging rule."); return; }
      closeForm();
      reload();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this packaging rule?")) return;
    const res = await fetch(`/api/inventory/packaging-rules/${id}`, { method: "DELETE" });
    if (!res.ok) { alert("Failed to delete."); return; }
    reload();
  };

  const toggleActive = async (r: Rule) => {
    await fetch(`/api/inventory/packaging-rules/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !r.isActive }),
    });
    reload();
  };

  const productResults = productSearch.trim().length >= 2
    ? products.filter((p) =>
        !form.items.some((i) => i.id === p.id) &&
        (p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
         p.sku.toLowerCase().includes(productSearch.toLowerCase()))
      ).slice(0, 8)
    : [];

  const menuResults = menuSearch.trim().length >= 1
    ? menus.filter((m) =>
        !form.menuIds.includes(m.id) &&
        m.name.toLowerCase().includes(menuSearch.toLowerCase())
      ).slice(0, 8)
    : [];

  const active = rules.filter((r) => r.isActive);
  const noCost = rules.filter((r) => r.lineCost <= 0).length;
  // Packaging cost per item sold, by category (active per-item lines only).
  const perCat = new Map<string, number>();
  for (const r of active) if (r.scope === "CATEGORY" && !r.perOrder) perCat.set(r.category || "Uncategorised", (perCat.get(r.category || "Uncategorised") ?? 0) + r.lineCost);
  const allItems = active.filter((r) => r.scope === "ALL" && !r.perOrder).reduce((n, r) => n + r.lineCost, 0);
  const top = [...perCat.entries()].sort((x, y) => y[1] - x[1])[0];
  const perOrder = active.filter((r) => r.perOrder).reduce((n, r) => n + r.lineCost, 0);

  if (dialogOpen) {
    // Add / edit: a full page (multi-field form), not a modal.
    return (
      <div className="max-w-[960px] px-4 pt-6 pb-10 md:px-8">
        <button onClick={closeForm} className="inline-flex items-center gap-1.5 text-sm text-text-2 hover:text-text"><ArrowLeft className="h-4 w-4" /> All packaging rules</button>
        <h1 className="mt-3 text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">{editingId ? "Edit packaging rule" : "Add packaging rule"}</h1>
        <p className="mt-0.5 text-sm text-text-2">Which packaging goes out, how many, on which channel, and for which drinks or food.</p>
          <div className="mt-5 grid gap-5">
            {/* Packaging item(s) */}
            <div>
              <label className="text-sm font-medium text-text-2">
                {editingId ? "Packaging item" : "Packaging item(s)"}
              </label>
              {form.items.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {form.items.map((it) => (
                    <span key={it.id} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-sunken px-2.5 py-1 text-sm text-text-2">
                      {it.name} <code className="text-xs text-text-3">{it.sku}</code>
                      <button onClick={() => set("items", form.items.filter((x) => x.id !== it.id))} className="text-text-3 hover:text-danger-text"><X className="h-3.5 w-3.5" /></button>
                    </span>
                  ))}
                </div>
              )}
              {/* Add mode keeps the search open so you can pick several; Edit caps at one. */}
              {(!editingId || form.items.length === 0) && (
                <div className="relative mt-1.5">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
                  <input
                    className="h-10 w-full rounded-ctl border border-line bg-surface pl-8 pr-3 text-sm text-text"
                    placeholder="Search a product (cup, lid, straw, bag)…"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                  />
                  {productResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-md border border-line bg-surface shadow-lg">
                      {productResults.map((p) => (
                        <button key={p.id} onClick={() => {
                            const picked = { id: p.id, name: p.name, sku: p.sku };
                            set("items", editingId ? [picked] : [...form.items, picked]);
                            setProductSearch("");
                          }}
                          className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[13px] hover:bg-sunken">
                          <span className="font-medium text-text-2">{p.name}</span>
                          <span className="text-text-3">{p.sku} · {p.baseUom}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {!editingId && form.items.length > 0 && (
                <p className="mt-1 text-[11px] text-text-3">A separate rule is created for each item — e.g. cup + lid + straw.</p>
              )}
            </div>

            {/* Qty + channel + per */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="text-sm font-medium text-text-2">Quantity</label>
                <Input type="number" step="any" min="0" className="mt-1.5 h-10" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium text-text-2">Channel</label>
                <select className="mt-1.5 h-10 w-full rounded-ctl border border-line bg-surface px-3 text-sm text-text" value={form.channel} onChange={(e) => set("channel", e.target.value as Channel)}>
                  {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-text-2">Charge</label>
                <select className="mt-1.5 h-10 w-full rounded-ctl border border-line bg-surface px-3 text-sm text-text" value={form.perOrder ? "order" : "item"} onChange={(e) => set("perOrder", e.target.value === "order")}>
                  <option value="item">Per item sold</option>
                  <option value="order">Per order</option>
                </select>
              </div>
            </div>

            {/* When (temperature) */}
            <div>
              <label className="text-sm font-medium text-text-2">When (temperature)</label>
              <div className="mt-1.5 flex gap-1.5">
                {[{ v: "", label: "Any" }, { v: "Iced", label: "Iced" }, { v: "Hot", label: "Hot" }].map((o) => (
                  <button key={o.v} onClick={() => set("modifier", o.v)}
                    className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${form.modifier === o.v ? "border-text bg-raised font-semibold text-text" : "border-line text-text-2 hover:border-line-2"}`}>
                    {o.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-text-3">Matches the Iced / Hot modifier on the sale. “Any” applies to both.</p>
            </div>

            {/* Scope */}
            <div>
              <label className="text-sm font-medium text-text-2">Applies to</label>
              <div className="mt-1.5 flex gap-1.5">
                {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => (
                  <button key={s} onClick={() => set("scope", s)}
                    className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${form.scope === s ? "border-text bg-raised font-semibold text-text" : "border-line text-text-2 hover:border-line-2"}`}>
                    {SCOPE_LABEL[s]}
                  </button>
                ))}
              </div>

              {form.scope === "CATEGORY" && (
                <div className="mt-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    {categories.map((c) => {
                      const active = form.categories.includes(c);
                      return (
                        <button key={c} onClick={() => {
                            if (editingId) set("categories", active ? [] : [c]); // Edit = single category
                            else set("categories", active ? form.categories.filter((x) => x !== c) : [...form.categories, c]);
                          }}
                          className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[13px] transition-colors ${active ? "border-text bg-raised font-semibold text-text" : "border-line text-text-2 hover:border-line-2"}`}>
                          {c}{active && <Check className="h-3 w-3" />}
                        </button>
                      );
                    })}
                  </div>
                  {!editingId && (
                    <p className="mt-1 text-[11px] text-text-3">Select one or more categories — a rule is created for each.</p>
                  )}
                </div>
              )}

              {form.scope === "ITEMS" && (
                <div className="mt-2.5">
                  {form.menuIds.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {form.menuIds.map((id) => {
                        const m = menus.find((x) => x.id === id);
                        return (
                          <span key={id} className="inline-flex items-center gap-1 rounded-full border border-line bg-sunken px-2 py-0.5 text-xs text-text-2">
                            {m?.name ?? id}
                            <button onClick={() => set("menuIds", form.menuIds.filter((x) => x !== id))} className="text-text-3 hover:text-danger-text"><X className="h-3 w-3" /></button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
                    <input className="h-10 w-full rounded-ctl border border-line bg-surface pl-8 pr-3 text-sm text-text" placeholder="Search menu items to add…" value={menuSearch} onChange={(e) => setMenuSearch(e.target.value)} />
                    {menuResults.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full rounded-md border border-line bg-surface shadow-lg">
                        {menuResults.map((m) => (
                          <button key={m.id} onClick={() => { set("menuIds", [...form.menuIds, m.id]); setMenuSearch(""); }}
                            className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[13px] hover:bg-sunken">
                            <span className="font-medium text-text-2">{m.name}</span>
                            <span className="text-text-3">{m.category}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="text-sm font-medium text-text-2">Notes <span className="text-text-3">(optional)</span></label>
              <Input className="mt-1.5 h-10" placeholder="e.g. cold drinks only" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            </div>
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={closeForm}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.items.length} className="bg-ink text-on-ink hover:bg-ink-hover disabled:opacity-50">
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
              {editingId ? "Save changes" : `Add ${createCount} ${createCount === 1 ? "rule" : "rules"}`}
            </Button>
          </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] px-4 pt-6 pb-10 md:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Packaging</h1>
          <p className="mt-0.5 text-sm text-text-2">What each cup, lid, straw and bag adds to the cost of what we sell.</p>
        </div>
        <Button onClick={openAdd} className="bg-ink text-on-ink hover:bg-ink-hover">
          <Plus className="mr-1.5 h-4 w-4" /> Add packaging rule
        </Button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KeyNumber label="Rules on" value={loading ? null : String(active.length)} note={<>of <b className="font-semibold text-text-2">{rules.length}</b> rules</>} />
        <KeyNumber label="Costliest category" value={loading ? null : top ? formatRM(top[1] + allItems) : "–"} word={!top}
          note={top ? <><b className="font-semibold text-text-2">{top[0]}</b>, per item sold</> : "no category rules yet"} />
        <KeyNumber label="Per order" value={loading ? null : formatRM(perOrder)} note="bags and other per-order packaging" />
        <KeyNumber label="No cost yet" value={loading ? null : String(noCost)} tone={noCost > 0 ? "warn" : undefined}
          note={noCost > 0 ? "these add nothing to cost until priced" : "every rule has a cost"} />
      </div>

      {/* Packaging BOM — grouped by scope (category / all / specific items) */}
      {loading ? (
        <div className="mt-4 flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-text" /></div>
      ) : rules.length === 0 ? (
        <div className="mt-4 rounded-card border border-line bg-surface px-4 py-12 text-center text-sm text-text-3">
          No packaging rules yet. Use Add packaging rule to start — e.g. add a plastic cup to the <em>Drinks</em> category on the <em>Takeaway</em> channel.
        </div>
      ) : (
        (() => {
          const cats = new Map<string, Rule[]>();
          const allRules: Rule[] = [];
          const itemRules: Rule[] = [];
          for (const r of rules) {
            if (r.scope === "CATEGORY") {
              const k = r.category || "Uncategorised";
              if (!cats.has(k)) cats.set(k, []);
              cats.get(k)!.push(r);
            } else if (r.scope === "ALL") allRules.push(r);
            else itemRules.push(r);
          }
          const groups: { label: string; meta: string; rules: Rule[] }[] = [];
          for (const k of [...cats.keys()].sort()) {
            const rs = cats.get(k)!;
            groups.push({ label: k, meta: `${rs[0].matchedMenuCount} menu item${rs[0].matchedMenuCount === 1 ? "" : "s"}`, rules: rs });
          }
          if (allRules.length) groups.push({ label: "All menu items", meta: `${allRules[0].matchedMenuCount} items`, rules: allRules });
          if (itemRules.length) groups.push({ label: "Specific items", meta: "hand-picked", rules: itemRules });

          return groups.map((g) => {
            const perItemTotal = g.rules.filter((r) => r.isActive && !r.perOrder).reduce((s, r) => s + r.lineCost, 0);
            return (
              <div key={g.label} className="mt-4 overflow-hidden rounded-card border border-line bg-surface">
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-text">{g.label}</p>
                    <p className="text-[12px] text-text-3">{g.meta} · {g.rules.length} packaging {g.rules.length === 1 ? "line" : "lines"}</p>
                  </div>
                  {perItemTotal > 0 && (
                    <div className="text-right">
                      <p className="text-[12px] text-text-3">Per item sold</p>
                      <p className="font-mono text-sm font-semibold text-text">{formatRM(perItemTotal)}</p>
                    </div>
                  )}
                </div>
                <div>
                  {g.rules.map((r) => (
                    <div key={r.id} className={`flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 ${!r.isActive ? "opacity-60" : ""}`}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-text">{r.productName} <span className="font-normal text-text-3">×{r.quantity} {r.perOrder ? "per order" : "per item"}</span></p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-text-3">
                          <span className={`rounded-full px-2 py-0.5 ${CHANNEL_BADGE[r.channel]}`}>{CHANNEL_LABEL[r.channel] === "All" ? "All channels" : CHANNEL_LABEL[r.channel]}</span>
                          {r.modifier && <span className={`rounded-full px-2 py-0.5 ${r.modifier === "Iced" ? "bg-info-soft text-info-text" : "bg-warn-soft text-warn-text"}`}>{r.modifier}</span>}
                          {r.scope === "ITEMS" && <span>{r.menuIds.length} {r.menuIds.length === 1 ? "item" : "items"}</span>}
                          <span>{r.productSku}</span>
                        </p>
                      </div>
                      <span className="shrink-0 font-mono text-sm font-semibold text-text">{r.lineCost > 0 ? formatRM(r.lineCost) : <span className="text-warn-text" title="This packaging item has no cost yet">No cost</span>}</span>
                      <button onClick={() => toggleActive(r)} aria-label={r.isActive ? `Switch off ${r.productName}` : `Switch on ${r.productName}`}
                        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${r.isActive ? "bg-ok-text" : "bg-line-2"}`}>
                        <span className={`mt-0.5 inline-block h-5 w-5 rounded-full bg-surface shadow transition-transform ${r.isActive ? "translate-x-5.5" : "translate-x-0.5"}`} />
                      </button>
                      <button onClick={() => openEdit(r)} aria-label={`Edit ${r.productName}`} className="flex h-9 w-9 items-center justify-center rounded-ctl text-text-3 hover:bg-sunken hover:text-text"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => remove(r.id)} aria-label={`Delete ${r.productName}`} className="flex h-9 w-9 items-center justify-center rounded-ctl text-text-3 hover:bg-danger-soft hover:text-danger-text"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                </div>
              </div>
            );
          });
        })()
      )}

    </div>
  );
}
