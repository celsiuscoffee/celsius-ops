"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState, useMemo } from "react";
import { Calculator, Plus, Save, Trash2, Loader2, X, Search } from "lucide-react";
import { SettingsNav } from "../_nav";
import type { PayrollItemCatalogEntry } from "@/lib/hr/types";

const CATEGORIES: PayrollItemCatalogEntry["category"][] = ["Remuneration", "Allowances", "Deductions", "Benefits in Kind", "Other perquisites", "Tax Relief"];
const ITEM_TYPES: { v: PayrollItemCatalogEntry["item_type"]; l: string }[] = [
  { v: "fixed_remuneration", l: "Fixed remuneration" },
  { v: "additional_remuneration", l: "Additional remuneration" },
  { v: "deduct_from_gross", l: "Deduct from Gross Pay" },
  { v: "deduct_after_net", l: "Deduct after Net Pay" },
  { v: "not_a_remuneration", l: "Not a remuneration" },
];
const EA_FIELDS = ["B.1(a)", "B.1(b)", "B.1(c)", "B.2", "B.3", "D.2", "F", ""];

const BLANK: Partial<PayrollItemCatalogEntry> = {
  code: "",
  name: "",
  category: "Allowances",
  item_type: "fixed_remuneration",
  ea_form_field: null,
  pcb_taxable: true,
  epf_contributing: true,
  socso_contributing: true,
  eis_contributing: true,
  hrdf_contributing: false,
  is_bik: false,
  sort_order: 100,
  is_active: true,
};

export default function PayrollItemsPage() {
  const { data, mutate } = useFetch<{ items: PayrollItemCatalogEntry[] }>("/api/hr/payroll-items");
  const items = data?.items || [];
  const [editing, setEditing] = useState<Partial<PayrollItemCatalogEntry> | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [filterCat, setFilterCat] = useState<string>("all");

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (filterCat !== "all" && i.category !== filterCat) return false;
      if (filter && !(i.name + i.code).toLowerCase().includes(filter.toLowerCase())) return false;
      return true;
    });
  }, [items, filter, filterCat]);

  const grouped = useMemo(() => {
    const m = new Map<string, PayrollItemCatalogEntry[]>();
    for (const it of filtered) {
      const list = m.get(it.category) || [];
      list.push(it);
      m.set(it.category, list);
    }
    return m;
  }, [filtered]);

  const save = async () => {
    if (!editing?.code || !editing?.name) return;
    setSaving(true);
    try {
      const method = editing.id ? "PATCH" : "POST";
      await fetch("/api/hr/payroll-items", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      mutate();
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this payroll item? It will no longer be available in payroll runs.")) return;
    setDeleting(id);
    try {
      await fetch(`/api/hr/payroll-items?id=${id}`, { method: "DELETE" });
      mutate();
    } finally {
      setDeleting(null);
    }
  };

  const toggleActive = async (item: PayrollItemCatalogEntry) => {
    await fetch("/api/hr/payroll-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, is_active: !item.is_active }),
    });
    mutate();
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold">HR Settings</h1>
        <p className="text-sm text-muted-foreground">Configure how leave, payroll, and scheduling work for your team</p>
      </div>
      <SettingsNav />

      <div className="rounded-xl border bg-card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <Calculator className="h-5 w-5 text-terracotta" />
            Payroll Items Catalog ({items.length})
          </h2>
          <button
            onClick={() => setEditing({ ...BLANK })}
            className="flex items-center gap-1 rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white hover:bg-terracotta-dark"
          >
            <Plus className="h-4 w-4" /> New Item
          </button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
            <input placeholder="Search code or name…" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-full rounded-lg border bg-background pl-8 pr-3 py-2 text-sm" />
          </div>
          <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} className="rounded-lg border bg-background px-3 py-2 text-sm">
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="space-y-4">
          {CATEGORIES.filter((c) => grouped.has(c)).map((cat) => (
            <div key={cat}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{cat}</h3>
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-xs text-gray-500">
                      <th className="px-3 py-2 text-left">Code</th>
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-left">EA Field</th>
                      <th className="px-3 py-2 text-center">PCB</th>
                      <th className="px-3 py-2 text-center">EPF</th>
                      <th className="px-3 py-2 text-center">SOCSO</th>
                      <th className="px-3 py-2 text-center">EIS</th>
                      <th className="px-3 py-2 text-center">Active</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(grouped.get(cat) || []).map((i) => (
                      <tr key={i.id} className="border-t hover:bg-gray-50/50">
                        <td className="px-3 py-2 font-mono text-xs">{i.code}</td>
                        <td className="px-3 py-2 font-medium">{i.name}</td>
                        <td className="px-3 py-2 text-xs text-gray-600">{i.item_type.replace(/_/g, " ")}</td>
                        <td className="px-3 py-2 font-mono text-xs">{i.ea_form_field || "—"}</td>
                        <td className="px-3 py-2 text-center">{i.pcb_taxable ? "✓" : "—"}</td>
                        <td className="px-3 py-2 text-center">{i.epf_contributing ? "✓" : "—"}</td>
                        <td className="px-3 py-2 text-center">{i.socso_contributing ? "✓" : "—"}</td>
                        <td className="px-3 py-2 text-center">{i.eis_contributing ? "✓" : "—"}</td>
                        <td className="px-3 py-2 text-center">
                          <button onClick={() => toggleActive(i)} className={"rounded px-1.5 py-0.5 text-[10px] " + (i.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                            {i.is_active ? "ON" : "OFF"}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => setEditing(i)} className="mr-1 rounded px-2 py-1 text-xs hover:bg-gray-100">Edit</button>
                          <button onClick={() => remove(i.id)} disabled={deleting === i.id} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
                            {deleting === i.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">No items match</div>}
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{editing.id ? "Edit Item" : "New Payroll Item"}</h3>
              <button onClick={() => setEditing(null)} className="rounded p-1 hover:bg-gray-100"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Code</span>
                  <input value={editing.code || ""} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} disabled={!!editing.id} className="w-full rounded border px-3 py-2 font-mono text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Name</span>
                  <input value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Category</span>
                  <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value as PayrollItemCatalogEntry["category"] })} className="w-full rounded border px-3 py-2 text-sm">
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Item type</span>
                  <select value={editing.item_type} onChange={(e) => setEditing({ ...editing, item_type: e.target.value as PayrollItemCatalogEntry["item_type"] })} className="w-full rounded border px-3 py-2 text-sm">
                    {ITEM_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">EA Form Field</span>
                  <select value={editing.ea_form_field || ""} onChange={(e) => setEditing({ ...editing, ea_form_field: e.target.value || null })} className="w-full rounded border px-3 py-2 text-sm">
                    {EA_FIELDS.map((f) => <option key={f} value={f}>{f || "— (none)"}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Sort order</span>
                  <input type="number" value={editing.sort_order ?? 100} onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })} className="w-full rounded border px-3 py-2 text-sm" />
                </label>
              </div>

              <div className="rounded-lg border p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">STATUTORY CONTRIBUTIONS</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Chk label="PCB Taxable" v={editing.pcb_taxable} on={(v) => setEditing({ ...editing, pcb_taxable: v })} />
                  <Chk label="EPF" v={editing.epf_contributing} on={(v) => setEditing({ ...editing, epf_contributing: v })} />
                  <Chk label="SOCSO" v={editing.socso_contributing} on={(v) => setEditing({ ...editing, socso_contributing: v })} />
                  <Chk label="EIS" v={editing.eis_contributing} on={(v) => setEditing({ ...editing, eis_contributing: v })} />
                  <Chk label="HRDF" v={editing.hrdf_contributing} on={(v) => setEditing({ ...editing, hrdf_contributing: v })} />
                  <Chk label="Benefit in Kind" v={editing.is_bik} on={(v) => setEditing({ ...editing, is_bik: v })} />
                </div>
              </div>

              <Chk label="Active" v={editing.is_active ?? true} on={(v) => setEditing({ ...editing, is_active: v })} />

              <div className="flex justify-end gap-2 border-t pt-4">
                <button onClick={() => setEditing(null)} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
                <button onClick={save} disabled={saving || !editing.code || !editing.name} className="flex items-center gap-1 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Chk({ label, v, on }: { label: string; v: boolean | undefined; on: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={!!v} onChange={(e) => on(e.target.checked)} />
      {label}
    </label>
  );
}
