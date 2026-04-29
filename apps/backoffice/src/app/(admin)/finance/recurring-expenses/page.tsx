"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, Pencil, X } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type Outlet = { id: string; name: string; code: string };
type RecurringExpense = {
  id: string;
  name: string;
  category: "RENT" | "UTILITY" | "SAAS" | "PAYROLL_SUPPORT" | "OTHER";
  amount: number;
  cadence: "MONTHLY" | "QUARTERLY" | "YEARLY";
  nextDueDate: string;
  outletId: string | null;
  outlet: Outlet | null;
  isActive: boolean;
  notes: string | null;
};

const CATEGORY_LABELS: Record<RecurringExpense["category"], string> = {
  RENT: "Rent",
  UTILITY: "Utility",
  SAAS: "SaaS / Subscription",
  PAYROLL_SUPPORT: "Payroll support",
  OTHER: "Other",
};

const CADENCE_LABELS: Record<RecurringExpense["cadence"], string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
};

const CATEGORY_COLOR: Record<RecurringExpense["category"], string> = {
  RENT: "bg-blue-100 text-blue-700",
  UTILITY: "bg-emerald-100 text-emerald-700",
  SAAS: "bg-purple-100 text-purple-700",
  PAYROLL_SUPPORT: "bg-orange-100 text-orange-700",
  OTHER: "bg-gray-100 text-gray-700",
};

type FormState = {
  id?: string;
  name: string;
  category: RecurringExpense["category"];
  amount: string;
  cadence: RecurringExpense["cadence"];
  nextDueDate: string;
  outletId: string;
  notes: string;
  isActive: boolean;
};

const empty: FormState = {
  name: "",
  category: "OTHER",
  amount: "",
  cadence: "MONTHLY",
  nextDueDate: new Date().toISOString().split("T")[0],
  outletId: "",
  notes: "",
  isActive: true,
};

export default function RecurringExpensesPage() {
  const { data, isLoading, mutate } = useFetch<RecurringExpense[]>("/api/finance/recurring-expenses?includeInactive=1");
  const { data: outlets } = useFetch<Outlet[]>("/api/settings/outlets");
  const [form, setForm] = useState<FormState>(empty);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const items = data ?? [];

  const openAdd = () => { setForm(empty); setEditing(true); setError(""); };
  const openEdit = (it: RecurringExpense) => {
    setForm({
      id: it.id,
      name: it.name,
      category: it.category,
      amount: String(it.amount),
      cadence: it.cadence,
      nextDueDate: it.nextDueDate.slice(0, 10),
      outletId: it.outletId ?? "",
      notes: it.notes ?? "",
      isActive: it.isActive,
    });
    setEditing(true); setError("");
  };

  const save = async () => {
    if (!form.name || !form.amount) { setError("Name and amount required"); return; }
    setSaving(true); setError("");
    const url = form.id ? `/api/finance/recurring-expenses/${form.id}` : "/api/finance/recurring-expenses";
    const method = form.id ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        category: form.category,
        amount: parseFloat(form.amount),
        cadence: form.cadence,
        nextDueDate: form.nextDueDate,
        outletId: form.outletId || null,
        notes: form.notes || null,
        isActive: form.isActive,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error || "Save failed");
      return;
    }
    setEditing(false);
    mutate();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this recurring expense?")) return;
    await fetch(`/api/finance/recurring-expenses/${id}`, { method: "DELETE" });
    mutate();
  };

  return (
    <div className="p-3 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Recurring Expenses</h2>
          <p className="mt-0.5 text-xs sm:text-sm text-gray-500">
            Predictable cash outflows that don&apos;t flow through the Invoice or Payroll systems — rent, utilities, SaaS, etc.
          </p>
        </div>
        <Button onClick={openAdd} className="bg-terracotta hover:bg-terracotta-dark w-full sm:w-auto">
          <Plus className="mr-1.5 h-4 w-4" /> Add Expense
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
      ) : items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <p className="text-sm text-gray-500">No recurring expenses yet.</p>
          <p className="mt-1 text-xs text-gray-400">Add one to start projecting it in the cashflow.</p>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b bg-gray-50/50 text-left text-gray-500">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Cadence</th>
                <th className="px-4 py-3 font-medium">Next Due</th>
                <th className="px-4 py-3 font-medium">Outlet</th>
                <th className="px-4 py-3 text-right font-medium">Amount (RM)</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((it) => (
                <tr key={it.id} className={`hover:bg-gray-50 ${!it.isActive ? "opacity-60" : ""}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">{it.name}{it.notes && <p className="mt-0.5 text-[11px] text-gray-400 italic">{it.notes}</p>}</td>
                  <td className="px-4 py-3"><Badge className={`text-[10px] ${CATEGORY_COLOR[it.category]}`}>{CATEGORY_LABELS[it.category]}</Badge></td>
                  <td className="px-4 py-3 text-xs text-gray-600">{CADENCE_LABELS[it.cadence]}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{it.nextDueDate.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{it.outlet?.name ?? <span className="text-gray-400">HQ</span>}</td>
                  <td className="px-4 py-3 text-right font-mono">RM {it.amount.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    {it.isActive
                      ? <Badge className="bg-green-100 text-green-700 text-[10px]">Active</Badge>
                      : <Badge className="bg-gray-100 text-gray-500 text-[10px]">Inactive</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openEdit(it)} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => remove(it.id)} className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit dialog */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={() => setEditing(false)}>
          <div className="relative w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-t-xl sm:rounded-xl bg-white p-4 sm:p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">{form.id ? "Edit" : "Add"} Recurring Expense</h3>
              <button onClick={() => setEditing(false)} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Name</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Putrajaya rent" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Category</label>
                  <select className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as RecurringExpense["category"] })}>
                    {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Cadence</label>
                  <select className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm" value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value as RecurringExpense["cadence"] })}>
                    {Object.entries(CADENCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Amount (RM)</label>
                  <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Next Due Date</label>
                  <input type="date" value={form.nextDueDate} onChange={(e) => setForm({ ...form, nextDueDate: e.target.value })} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Outlet (optional)</label>
                <select className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm" value={form.outletId} onChange={(e) => setForm({ ...form, outletId: e.target.value })}>
                  <option value="">HQ-level (no outlet)</option>
                  {(outlets ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Notes</label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes for finance" />
              </div>
              {form.id && (
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                  Active (deactivate to stop projecting)
                </label>
              )}
              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>

            <div className="mt-4 flex gap-2">
              <button onClick={() => setEditing(false)} className="flex-1 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={save} disabled={saving} className="flex-1 rounded-md bg-terracotta px-3 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50">
                {saving ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
