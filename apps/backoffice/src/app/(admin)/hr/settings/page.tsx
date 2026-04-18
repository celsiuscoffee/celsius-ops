"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { CalendarClock, Plus, Trash2, Loader2, Sparkles, Bot } from "lucide-react";
import { SettingsNav } from "./_nav";

type Holiday = {
  id: string;
  date: string;
  name: string;
  year: number;
  is_national: boolean;
  state: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function HRSettingsPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const { data, mutate } = useFetch<{ holidays: Holiday[] }>(`/api/hr/holidays?year=${year}`);
  const [newHoliday, setNewHoliday] = useState({ date: "", name: "" });
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Leave balance init
  const [initingBalances, setInitingBalances] = useState(false);
  const [balanceResult, setBalanceResult] = useState<string | null>(null);

  const holidays = data?.holidays || [];

  const handleAdd = async () => {
    if (!newHoliday.date || !newHoliday.name) return;
    setAdding(true);
    try {
      const res = await fetch("/api/hr/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newHoliday),
      });
      if (res.ok) {
        setNewHoliday({ date: "", name: "" });
        mutate();
      }
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await fetch(`/api/hr/holidays?id=${id}`, { method: "DELETE" });
      mutate();
    } finally {
      setDeleting(null);
    }
  };

  const handleInitBalances = async () => {
    setInitingBalances(true);
    setBalanceResult(null);
    try {
      const res = await fetch("/api/hr/leave-balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "init_all", year }),
      });
      const data = await res.json();
      if (res.ok) {
        setBalanceResult(`Initialized ${data.initialized} balance records for ${data.employees} employees (${year})`);
      } else {
        setBalanceResult(`Error: ${data.error}`);
      }
    } finally {
      setInitingBalances(false);
    }
  };

  // Group holidays by month
  const byMonth = new Map<number, Holiday[]>();
  holidays.forEach((h) => {
    const m = parseInt(h.date.slice(5, 7));
    const list = byMonth.get(m) || [];
    list.push(h);
    byMonth.set(m, list);
  });

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold">HR Settings</h1>
        <p className="text-sm text-muted-foreground">Configure how leave, payroll, and scheduling work for your team</p>
      </div>
      <SettingsNav />

      {/* Leave Balances Init */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <Bot className="h-5 w-5 text-terracotta" />
          Initialize Leave Balances
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Give every employee their default leave entitlement for the year (annual, sick, emergency, etc.).
          Part-timers get pro-rated entitlement. Re-run safely — existing balances are preserved.
        </p>
        <div className="flex items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Year</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-lg border bg-background px-3 py-2 text-sm">
              <option value={2025}>2025</option>
              <option value={2026}>2026</option>
              <option value={2027}>2027</option>
            </select>
          </label>
          <button
            onClick={handleInitBalances}
            disabled={initingBalances}
            className="flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
          >
            {initingBalances ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Initialize for {year}
          </button>
        </div>
        {balanceResult && (
          <p className="mt-3 text-sm text-green-600">{balanceResult}</p>
        )}
      </div>

      {/* Public Holidays */}
      <div className="rounded-xl border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <CalendarClock className="h-5 w-5 text-terracotta" />
            Public Holidays — {year}
          </h2>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-lg border bg-background px-3 py-1.5 text-sm">
            <option value={2025}>2025</option>
            <option value={2026}>2026</option>
            <option value={2027}>2027</option>
          </select>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">
          These dates trigger <strong>2x</strong> pay for working hours and <strong>3x</strong> for overtime.
          The AI attendance processor automatically applies PH rates when staff clock in on these dates.
        </p>

        {/* Add new */}
        <div className="mb-4 flex items-end gap-2">
          <label className="block flex-1">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Date</span>
            <input
              type="date"
              value={newHoliday.date}
              onChange={(e) => setNewHoliday((h) => ({ ...h, date: e.target.value }))}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block flex-[2]">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Name</span>
            <input
              type="text"
              value={newHoliday.name}
              onChange={(e) => setNewHoliday((h) => ({ ...h, name: e.target.value }))}
              placeholder="e.g. Chinese New Year"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
          </label>
          <button
            onClick={handleAdd}
            disabled={adding || !newHoliday.date || !newHoliday.name}
            className="flex items-center gap-1 rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add
          </button>
        </div>

        {/* List grouped by month */}
        <div className="space-y-4">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
            const list = byMonth.get(month) || [];
            if (list.length === 0) return null;
            return (
              <div key={month}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {MONTHS[month - 1]}
                </h3>
                <div className="space-y-1">
                  {list.map((h) => {
                    const d = new Date(h.date + "T00:00:00");
                    const day = d.getDate();
                    const dayName = d.toLocaleDateString("en-MY", { weekday: "short" });
                    return (
                      <div key={h.id} className="flex items-center gap-3 rounded-lg border border-gray-100 bg-white p-3">
                        <div className="flex h-10 w-10 flex-col items-center justify-center rounded-lg bg-red-50 text-red-600">
                          <span className="text-[10px] font-bold">{dayName.toUpperCase()}</span>
                          <span className="text-sm font-bold leading-tight">{day}</span>
                        </div>
                        <div className="flex-1">
                          <p className="font-medium">{h.name}</p>
                          <p className="text-xs text-muted-foreground">{h.date}</p>
                        </div>
                        <button
                          onClick={() => handleDelete(h.id)}
                          disabled={deleting === h.id}
                          className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        >
                          {deleting === h.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {holidays.length === 0 && (
            <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
              No public holidays configured for {year}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
