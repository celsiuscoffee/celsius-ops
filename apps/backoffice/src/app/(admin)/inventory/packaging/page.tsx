"use client";

import { useState } from "react";
import { formatRM } from "@celsius/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useFetch } from "@/lib/use-fetch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Search, Pencil, Trash2, Package, Loader2, X, Check } from "lucide-react";

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
  ALL: "border-gray-200 bg-gray-50 text-gray-600",
  DINE_IN: "border-blue-200 bg-blue-50 text-blue-600",
  TAKEAWAY: "border-amber-200 bg-amber-50 text-amber-700",
  GRAB: "border-green-200 bg-green-50 text-green-700",
  DELIVERY: "border-purple-200 bg-purple-50 text-purple-700",
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
  perOrder: boolean;
  isActive: boolean;
  notes: string | null;
  unitCost: number;
  lineCost: number;
  matchedMenuCount: number;
};

type ProductOption = { id: string; name: string; sku: string; baseUom: string; itemType: string };
type MenuLite = { id: string; name: string; category: string };

type Form = {
  productId: string;
  productName: string;
  productSku: string;
  quantity: string;
  scope: Scope;
  category: string;
  menuIds: string[];
  channel: Channel;
  perOrder: boolean;
  isActive: boolean;
  notes: string;
};

const emptyForm: Form = {
  productId: "", productName: "", productSku: "", quantity: "1",
  scope: "ALL", category: "", menuIds: [], channel: "ALL",
  perOrder: false, isActive: true, notes: "",
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

  const openAdd = () => { setForm(emptyForm); setEditingId(null); setProductSearch(""); setMenuSearch(""); setDialogOpen(true); };
  const openEdit = (r: Rule) => {
    setForm({
      productId: r.productId, productName: r.productName, productSku: r.productSku,
      quantity: String(r.quantity), scope: r.scope, category: r.category ?? "",
      menuIds: r.menuIds, channel: r.channel, perOrder: r.perOrder, isActive: r.isActive,
      notes: r.notes ?? "",
    });
    setEditingId(r.id); setProductSearch(""); setMenuSearch(""); setDialogOpen(true);
  };

  const save = async () => {
    if (!form.productId) return;
    setSaving(true);
    try {
      const url = editingId ? `/api/inventory/packaging-rules/${editingId}` : "/api/inventory/packaging-rules";
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: form.productId,
          quantity: parseFloat(form.quantity) || 1,
          scope: form.scope,
          category: form.category,
          menuIds: form.menuIds,
          channel: form.channel,
          perOrder: form.perOrder,
          isActive: form.isActive,
          notes: form.notes,
        }),
      });
      if (!res.ok) { alert("Failed to save packaging rule."); return; }
      setDialogOpen(false);
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
        p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.sku.toLowerCase().includes(productSearch.toLowerCase())
      ).slice(0, 8)
    : [];

  const menuResults = menuSearch.trim().length >= 1
    ? menus.filter((m) =>
        !form.menuIds.includes(m.id) &&
        m.name.toLowerCase().includes(menuSearch.toLowerCase())
      ).slice(0, 8)
    : [];

  const scopeSummary = (r: Rule) =>
    r.scope === "ALL" ? "All menu items"
    : r.scope === "CATEGORY" ? `Category: ${r.category || "—"}`
    : `${r.menuIds.length} item${r.menuIds.length === 1 ? "" : "s"}`;

  return (
    <div className="p-3 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Packaging</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Rules that add packaging cost to menus by scope &amp; channel — e.g. <em>iced cup + lid on drinks (takeaway)</em>, <em>straw on all drinks</em>, <em>a paper bag per Grab order</em>.
          </p>
        </div>
        <Button onClick={openAdd} className="bg-terracotta hover:bg-terracotta-dark">
          <Plus className="mr-1.5 h-4 w-4" /> Add Packaging Rule
        </Button>
      </div>

      {/* Table */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50 text-left">
              <th className="px-4 py-3 font-medium text-gray-500">Packaging Item</th>
              <th className="px-4 py-3 font-medium text-gray-500">Applies to</th>
              <th className="px-4 py-3 font-medium text-gray-500">Channel</th>
              <th className="px-4 py-3 font-medium text-gray-500">Per</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Qty</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Cost / use</th>
              <th className="px-4 py-3 font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="px-4 py-12 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-terracotta" /></td></tr>
            )}
            {!loading && rules.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-gray-400">No packaging rules yet. Click “Add Packaging Rule”.</td></tr>
            )}
            {!loading && rules.map((r) => (
              <tr key={r.id} className={`border-b border-gray-50 hover:bg-gray-50/50 ${!r.isActive ? "opacity-50" : ""}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100"><Package className="h-4 w-4 text-gray-400" /></div>
                    <div>
                      <p className="font-medium text-gray-900">{r.productName}</p>
                      <code className="text-[11px] text-gray-400">{r.productSku}</code>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">{scopeSummary(r)}</td>
                <td className="px-4 py-3"><Badge variant="outline" className={`text-xs ${CHANNEL_BADGE[r.channel]}`}>{CHANNEL_LABEL[r.channel]}</Badge></td>
                <td className="px-4 py-3 text-gray-600">{r.perOrder ? "Per order" : "Per item"}</td>
                <td className="px-4 py-3 text-right text-gray-700">{r.quantity}</td>
                <td className="px-4 py-3 text-right font-medium text-gray-900">
                  {r.lineCost > 0 ? formatRM(r.lineCost) : <span className="text-gray-300">—</span>}
                  {!r.perOrder && r.matchedMenuCount > 0 && (
                    <p className="text-[11px] font-normal text-gray-400">× {r.matchedMenuCount} items</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => toggleActive(r)} className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${r.isActive ? "border-green-200 bg-green-50 text-green-700" : "border-gray-200 bg-gray-50 text-gray-400"}`}>
                    {r.isActive ? "Active" : "Off"}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => openEdit(r)} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-terracotta"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => remove(r.id)} className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { setEditingId(null); setForm(emptyForm); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>{editingId ? "Edit Packaging Rule" : "Add Packaging Rule"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-5 py-3 overflow-y-auto flex-1 min-h-0">
            {/* Packaging item */}
            <div>
              <label className="text-sm font-medium text-gray-700">Packaging item</label>
              {form.productId ? (
                <div className="mt-1.5 flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                  <span className="text-sm text-gray-700">{form.productName} <code className="ml-1 text-xs text-gray-400">{form.productSku}</code></span>
                  <button onClick={() => { set("productId", ""); set("productName", ""); set("productSku", ""); }} className="text-gray-400 hover:text-red-500"><X className="h-4 w-4" /></button>
                </div>
              ) : (
                <div className="relative mt-1.5">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    className="w-full rounded-md border border-gray-200 py-2 pl-8 pr-3 text-sm"
                    placeholder="Search a product (cup, lid, straw, bag)…"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                  />
                  {productResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg">
                      {productResults.map((p) => (
                        <button key={p.id} onClick={() => { set("productId", p.id); set("productName", p.name); set("productSku", p.sku); setProductSearch(""); }}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-gray-50">
                          <span className="font-medium text-gray-700">{p.name}</span>
                          <span className="text-gray-400">{p.sku} · {p.baseUom}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Qty + channel + per */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Quantity</label>
                <Input type="number" step="any" min="0" className="mt-1.5 h-10" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Channel</label>
                <select className="mt-1.5 h-10 w-full rounded-md border border-gray-200 px-3 text-sm" value={form.channel} onChange={(e) => set("channel", e.target.value as Channel)}>
                  {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Charge</label>
                <select className="mt-1.5 h-10 w-full rounded-md border border-gray-200 px-3 text-sm" value={form.perOrder ? "order" : "item"} onChange={(e) => set("perOrder", e.target.value === "order")}>
                  <option value="item">Per item sold</option>
                  <option value="order">Per order</option>
                </select>
              </div>
            </div>

            {/* Scope */}
            <div>
              <label className="text-sm font-medium text-gray-700">Applies to</label>
              <div className="mt-1.5 flex gap-1.5">
                {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => (
                  <button key={s} onClick={() => set("scope", s)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${form.scope === s ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500 hover:border-gray-300"}`}>
                    {SCOPE_LABEL[s]}
                  </button>
                ))}
              </div>

              {form.scope === "CATEGORY" && (
                <select className="mt-2.5 h-10 w-full rounded-md border border-gray-200 px-3 text-sm" value={form.category} onChange={(e) => set("category", e.target.value)}>
                  <option value="">Select category…</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}

              {form.scope === "ITEMS" && (
                <div className="mt-2.5">
                  {form.menuIds.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {form.menuIds.map((id) => {
                        const m = menus.find((x) => x.id === id);
                        return (
                          <span key={id} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-600">
                            {m?.name ?? id}
                            <button onClick={() => set("menuIds", form.menuIds.filter((x) => x !== id))} className="text-gray-400 hover:text-red-500"><X className="h-3 w-3" /></button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input className="w-full rounded-md border border-gray-200 py-2 pl-8 pr-3 text-sm" placeholder="Search menu items to add…" value={menuSearch} onChange={(e) => setMenuSearch(e.target.value)} />
                    {menuResults.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg">
                        {menuResults.map((m) => (
                          <button key={m.id} onClick={() => { set("menuIds", [...form.menuIds, m.id]); setMenuSearch(""); }}
                            className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-gray-50">
                            <span className="font-medium text-gray-700">{m.name}</span>
                            <span className="text-gray-400">{m.category}</span>
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
              <label className="text-sm font-medium text-gray-700">Notes <span className="text-gray-400">(optional)</span></label>
              <Input className="mt-1.5 h-10" placeholder="e.g. cold drinks only" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            </div>
          </div>

          <div className="flex-shrink-0 border-t pt-4">
            <Button onClick={save} disabled={saving || !form.productId} className="h-11 w-full bg-terracotta text-base hover:bg-terracotta-dark disabled:opacity-50">
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
              {editingId ? "Save Changes" : "Add Rule"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
