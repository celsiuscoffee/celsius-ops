"use client";

// Outgoing payables — what cash is committed to leave, and when.
//
// The counterpart of the Incoming settlements panel: unpaid invoices land on
// their due dates, recurring expenses (rent, utilities, SaaS, payroll support)
// fire on theirs, and anything already late sits in a standing Overdue block
// so it can't hide behind the date filter. Days are expandable to the exact
// payee list, and the category chips cut the view to one kind of spend.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";
import { Loader2, ArrowUpFromLine, AlertTriangle, ChevronDown, ChevronRight, ArrowRight } from "lucide-react";
import { DateRangePicker } from "@/components/date-range-picker";

type Category = "ingredients" | "asset" | "maintenance" | "rent" | "utilities" | "software" | "payroll" | "other";

type Item = {
  id: string;
  source: "invoice" | "recurring";
  dueDate: string | null;
  payee: string;
  ref: string | null;
  category: Category;
  outletId: string | null;
  amount: number;
  status: string;
  overdue: boolean;
};

type Forecast = {
  from: string;
  to: string;
  items: Item[];
  overdue: { total: number; count: number; items: Item[] };
  byDate: { date: string; total: number; count: number; byCategory: Partial<Record<Category, number>> }[];
  byCategory: { category: Category; total: number }[];
  total: number;
  invoiceTotal: number;
  recurringTotal: number;
};

const CATEGORY_LABEL: Record<Category, string> = {
  ingredients: "Ingredients", asset: "Asset", maintenance: "Maintenance",
  rent: "Rent", utilities: "Utilities", software: "Software",
  payroll: "Payroll", other: "Other",
};
const CATEGORY_DOT: Record<Category, string> = {
  ingredients: "bg-amber-500", asset: "bg-teal-500", maintenance: "bg-orange-500",
  rent: "bg-violet-500", utilities: "bg-sky-500", software: "bg-blue-500",
  payroll: "bg-rose-500", other: "bg-gray-400",
};

const RM0 = (n: number) => `RM${Math.round(n).toLocaleString("en-MY")}`;
const RM2 = (n: number) => `RM${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function dayLabel(d: string, todayStr: string): { dow: string; date: string; isToday: boolean } {
  const dt = new Date(`${d}T00:00:00Z`);
  return {
    dow: DOW[dt.getUTCDay()],
    date: `${dt.getUTCDate()} ${dt.toLocaleString("en-MY", { month: "short", timeZone: "UTC" })}`,
    isToday: d === todayStr,
  };
}
function todayMytStr() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}
function addDaysStr(s: string, n: number): string {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function fmtDueShort(d: string | null): string {
  if (!d) return "no due date";
  const dt = new Date(`${d}T00:00:00Z`);
  return `${dt.getUTCDate()} ${dt.toLocaleString("en-MY", { month: "short", timeZone: "UTC" })}`;
}

const PRESETS = [7, 14, 28] as const;

export default function PayablesPanel() {
  // Window: a day-count preset from today, or a custom [from, to] range.
  const [days, setDays] = useState<number>(7);
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]); // empty = all
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [overdueOpen, setOverdueOpen] = useState(false);

  const query = custom ? `from=${custom.from}&to=${custom.to}` : `days=${days}`;
  const { data, isLoading } = useFetch<{ forecast: Forecast }>(`/api/finance/cashflow/payables?${query}`);
  const f = data?.forecast;
  const todayStr = todayMytStr();

  const toggleCategory = (c: Category) =>
    setCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  // Category filter cuts items client-side; day buckets recompute from the
  // filtered set so bars, totals and chips always agree.
  const filtered = useMemo(() => {
    if (!f) return null;
    const active = categories.length > 0;
    const items = active ? f.items.filter((i) => categories.includes(i.category)) : f.items;
    const overdueItems = active ? f.overdue.items.filter((i) => categories.includes(i.category)) : f.overdue.items;
    const byDate = new Map<string, { total: number; byCategory: Partial<Record<Category, number>>; items: Item[] }>();
    for (const it of items) {
      if (!it.dueDate) continue;
      const e = byDate.get(it.dueDate) ?? { total: 0, byCategory: {}, items: [] };
      e.total += it.amount;
      e.byCategory[it.category] = (e.byCategory[it.category] ?? 0) + it.amount;
      e.items.push(it);
      byDate.set(it.dueDate, e);
    }
    return {
      days: [...byDate.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
      total: items.reduce((s, i) => s + i.amount, 0),
      invoiceTotal: items.filter((i) => i.source === "invoice").reduce((s, i) => s + i.amount, 0),
      recurringTotal: items.filter((i) => i.source === "recurring").reduce((s, i) => s + i.amount, 0),
      overdueTotal: overdueItems.reduce((s, i) => s + i.amount, 0),
      overdueItems,
    };
  }, [f, categories]);

  const maxDay = useMemo(
    () => (filtered && filtered.days.length ? Math.max(...filtered.days.map((d) => d.total), 1) : 1),
    [filtered],
  );

  const windowLabel = custom
    ? `${fmtDueShort(custom.from)} – ${fmtDueShort(custom.to)}`
    : `next ${days}d`;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <ArrowUpFromLine className="h-4 w-4 text-red-600" />
            Outgoing payables
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Committed cash leaving per day — unpaid invoices on their due dates plus recurring expenses (rent, utilities, payroll support) on theirs.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex rounded-md border border-gray-200 p-0.5">
            {PRESETS.map((d) => (
              <button
                key={d}
                onClick={() => { setDays(d); setCustom(null); }}
                className={`rounded px-2 py-1 text-xs ${!custom && days === d ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"}`}
              >
                {d}d
              </button>
            ))}
          </div>
          <DateRangePicker
            start={custom?.from ?? todayStr}
            end={custom?.to ?? addDaysStr(todayStr, days - 1)}
            onChange={(s, e) => setCustom({ from: s, to: e })}
            size="xs"
          />
        </div>
      </div>

      {isLoading || !f || !filtered ? (
        <div className="py-10 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-gray-400" /></div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
            <div className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="text-[11px] text-gray-500">Due {windowLabel}</p>
              <p className="mt-0.5 text-lg font-bold text-gray-900">{RM0(filtered.total)}</p>
            </div>
            <div className="rounded-lg bg-red-50 px-3 py-2">
              <p className="text-[11px] text-red-700">Overdue</p>
              <p className="mt-0.5 text-lg font-bold text-red-700">{RM0(filtered.overdueTotal)}</p>
              <p className="text-[10px] text-red-600/70">{filtered.overdueItems.length} invoice{filtered.overdueItems.length === 1 ? "" : "s"} past due or undated</p>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="text-[11px] text-gray-500">Invoices / recurring</p>
              <p className="mt-0.5 text-lg font-bold text-gray-700">
                {RM0(filtered.invoiceTotal)} <span className="text-xs font-normal text-gray-400">/</span> {RM0(filtered.recurringTotal)}
              </p>
              <p className="text-[10px] text-gray-400">committed vs scheduled</p>
            </div>
          </div>

          {/* Category filter chips — click to cut the whole panel to one or
              more kinds of spend; click again to release. */}
          <div className="mt-3 flex flex-wrap gap-1">
            {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => {
              const active = categories.includes(c);
              const inData = f.items.some((i) => i.category === c) || f.overdue.items.some((i) => i.category === c);
              if (!inData) return null;
              return (
                <button
                  key={c}
                  onClick={() => toggleCategory(c)}
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${active ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${CATEGORY_DOT[c]}`} />
                  {CATEGORY_LABEL[c]}
                </button>
              );
            })}
            {categories.length > 0 && (
              <button onClick={() => setCategories([])} className="rounded-full px-2 py-0.5 text-[11px] text-blue-600 hover:underline">
                Clear
              </button>
            )}
          </div>

          {/* Standing overdue block — always relative to today, so late money
              stays visible whatever window is selected. */}
          {filtered.overdueItems.length > 0 && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50/60">
              <button
                onClick={() => setOverdueOpen((v) => !v)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left"
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-600" />
                <span className="flex-1 text-xs font-medium text-red-800">
                  {RM0(filtered.overdueTotal)} already payable — {filtered.overdueItems.length} invoice{filtered.overdueItems.length === 1 ? "" : "s"} past due or without a due date
                </span>
                {overdueOpen ? <ChevronDown className="h-3.5 w-3.5 text-red-400" /> : <ChevronRight className="h-3.5 w-3.5 text-red-400" />}
              </button>
              {overdueOpen && (
                <div className="border-t border-red-100 px-3 py-1.5">
                  {filtered.overdueItems.map((it) => (
                    <div key={it.id} className="flex items-center gap-2 py-1 text-xs">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${CATEGORY_DOT[it.category]}`} />
                      <span className="flex-1 truncate text-gray-700">
                        {it.payee}
                        {it.ref && <span className="ml-1 text-gray-400">{it.ref}</span>}
                      </span>
                      <span className="shrink-0 text-[10px] text-red-600">{it.dueDate ? `due ${fmtDueShort(it.dueDate)}` : "no due date"}</span>
                      <span className="w-20 shrink-0 text-right font-semibold tabular-nums text-gray-900">{RM2(it.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {filtered.days.length === 0 ? (
            <p className="mt-4 py-6 text-center text-xs text-gray-400">
              Nothing due in this window{categories.length > 0 ? " for the selected categories" : ""}.
            </p>
          ) : (
            <div className="mt-3 space-y-1">
              {filtered.days.map((d) => {
                const l = dayLabel(d.date, todayStr);
                const open = openDay === d.date;
                return (
                  <div key={d.date} className="rounded-md px-1.5 py-1 hover:bg-gray-50">
                    <button
                      onClick={() => setOpenDay(open ? null : d.date)}
                      className="flex w-full items-center gap-2 text-left"
                      title="Click for the payee breakdown"
                    >
                      <div className="w-20 shrink-0 text-xs">
                        <span className={`font-medium ${l.isToday ? "text-red-700" : "text-gray-700"}`}>{l.dow}</span>{" "}
                        <span className="text-gray-400">{l.date}</span>
                      </div>
                      <div className="relative h-4 flex-1 overflow-hidden rounded bg-gray-100">
                        <div className="absolute inset-y-0 left-0 bg-red-400/80" style={{ width: `${(d.total / maxDay) * 100}%` }} />
                      </div>
                      <div className="w-20 shrink-0 text-right text-xs font-semibold tabular-nums text-gray-900">{RM0(d.total)}</div>
                    </button>
                    <div className="ml-20 flex flex-wrap gap-x-3 gap-y-0.5 pl-2 pt-0.5">
                      {(Object.keys(CATEGORY_LABEL) as Category[])
                        .filter((c) => (d.byCategory[c] ?? 0) > 0)
                        .map((c) => (
                          <span key={c} className="flex items-center gap-1 text-[10px] text-gray-500">
                            <span className={`h-1.5 w-1.5 rounded-full ${CATEGORY_DOT[c]}`} />
                            {CATEGORY_LABEL[c]} <span className="tabular-nums text-gray-700">{RM0(d.byCategory[c]!)}</span>
                          </span>
                        ))}
                    </div>
                    {open && (
                      <div className="ml-20 mt-1 border-l-2 border-gray-100 pl-2">
                        {d.items
                          .slice()
                          .sort((a, b) => b.amount - a.amount)
                          .map((it) => (
                            <div key={it.id} className="flex items-center gap-2 py-0.5 text-xs">
                              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${CATEGORY_DOT[it.category]}`} />
                              <span className="flex-1 truncate text-gray-700">
                                {it.payee}
                                {it.ref && <span className="ml-1 text-gray-400">{it.ref}</span>}
                              </span>
                              <span className="shrink-0 rounded bg-gray-100 px-1 py-px text-[9px] uppercase tracking-wide text-gray-500">
                                {it.source === "recurring" ? "recurring" : it.status.toLowerCase().replace(/_/g, " ")}
                              </span>
                              <span className="w-20 shrink-0 text-right tabular-nums text-gray-700">{RM2(it.amount)}</span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-2">
            <p className="text-[11px] text-gray-400">
              Click a day for its payee list. Recurring rows are the same entries the weekly projection fires.
            </p>
            <Link href="/inventory/invoices" className="inline-flex shrink-0 items-center gap-1 text-[11px] text-blue-600 hover:underline">
              Unpaid invoice list <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
