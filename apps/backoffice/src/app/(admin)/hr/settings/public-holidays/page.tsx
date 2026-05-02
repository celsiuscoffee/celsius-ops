"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Loader2, Plus, Save, Trash2, CalendarDays } from "lucide-react";
import { useConfirm, toast } from "@celsius/ui";
import { SettingsNav } from "../_nav";

type Holiday = {
  id: string;
  date: string;
  name: string;
  year: number;
  is_national: boolean;
  state: string | null;
};

const STATES = [
  "", // null = nationwide
  "Johor", "Kedah", "Kelantan", "Kuala Lumpur", "Labuan", "Melaka",
  "Negeri Sembilan", "Pahang", "Perak", "Perlis", "Penang", "Putrajaya",
  "Sabah", "Sarawak", "Selangor", "Terengganu",
];

export default function PublicHolidaysPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const { data, mutate } = useFetch<{ holidays: Holiday[] }>(`/api/hr/holidays?year=${year}`);
  const holidays = data?.holidays || [];
  const { confirm, ConfirmDialog } = useConfirm();

  const [showAdd, setShowAdd] = useState(false);
  const [date, setDate] = useState(`${year}-01-01`);
  const [name, setName] = useState("");
  const [state, setState] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => {
    setShowAdd(false);
    setName("");
    setState("");
    setErr(null);
  };

  const handleAdd = async () => {
    if (!date || !name) {
      setErr("Date and name required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/hr/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          name,
          is_national: !state,
          state: state || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed");
      toast.success("Holiday added");
      mutate();
      reset();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: "Remove this holiday?", confirmLabel: "Remove", destructive: true }))) return;
    const res = await fetch(`/api/hr/holidays?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Holiday removed");
      mutate();
    }
  };

  const grouped = new Map<string, Holiday[]>();
  for (const h of holidays) {
    const month = h.date.slice(0, 7);
    const list = grouped.get(month) || [];
    list.push(h);
    grouped.set(month, list);
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <ConfirmDialog />
      <SettingsNav />

      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <CalendarDays className="h-6 w-6 text-terracotta" />
          Public Holidays
        </h1>
        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-lg border bg-background px-3 py-1.5 text-sm"
          >
            {[year - 1, year, year + 1, year + 2].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          {!showAdd && (
            <button
              onClick={() => { setDate(`${year}-01-01`); setShowAdd(true); }}
              className="flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-sm font-medium text-white hover:bg-terracotta-dark"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          )}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Public holidays drive OT pay (3x rate on PH), leave calc (PH falling on
        weekday counts), and the schedule grid colouring. Add nationwide holidays
        without a state; state-specific (e.g. Selangor's Sultan birthday) with the
        state set.
      </p>

      {showAdd && (
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">Add Holiday</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Name</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hari Raya Aidilfitri" className="w-full rounded border px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">State (leave blank for nationwide)</span>
              <select value={state} onChange={(e) => setState(e.target.value)} className="w-full rounded border bg-background px-3 py-2 text-sm">
                {STATES.map((s) => <option key={s} value={s}>{s || "Nationwide"}</option>)}
              </select>
            </label>
          </div>
          {err && <p className="mt-3 text-xs text-red-600">{err}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={reset} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50">Cancel</button>
            <button
              onClick={handleAdd}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-terracotta px-3 py-1.5 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </button>
          </div>
        </div>
      )}

      {holidays.length === 0 ? (
        <p className="rounded-lg border bg-muted/10 p-12 text-center text-sm text-muted-foreground">
          No public holidays configured for {year}. Add the nationwide ones first
          (Awal Tahun, Thaipusam, Labour Day, Wesak, Agong's Birthday, Hari Raya, Merdeka, Malaysia Day, Deepavali, Christmas).
        </p>
      ) : (
        <div className="space-y-4">
          {Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([month, list]) => (
            <div key={month} className="rounded-xl border bg-card">
              <p className="border-b px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-MY", { month: "long", year: "numeric", timeZone: "UTC" })}
              </p>
              <ul className="divide-y">
                {list.map((h) => (
                  <li key={h.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="font-mono text-xs text-gray-500 w-24">{h.date}</span>
                    <span className="flex-1 font-medium">{h.name}</span>
                    {h.is_national ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Nationwide</span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">{h.state}</span>
                    )}
                    <button
                      onClick={() => handleDelete(h.id)}
                      className="rounded border border-red-200 bg-red-50 p-1 text-red-600 hover:bg-red-100"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
