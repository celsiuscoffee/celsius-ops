"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Download, ArrowUpDown, ArrowUp, ArrowDown, Info, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { toast } from "@celsius/ui";
import { ReportsTabs } from "../_ReportsTabs";

/**
 * Sales Reports — StoreHub-style "Reports 2.0" on our own data (POS-native +
 * pickup + StoreHub archive, cutover-routed; see /api/sales/reports). One
 * toolbar (report · date range · outlet · group-by · filters · download)
 * drives eight reports. Money arrives in RM already converted; this page
 * formats, filters/searches, sorts, paginates, charts and exports.
 */

type ColKind = "text" | "rm" | "int" | "pct";
type Column = { key: string; label: string; kind: ColKind; tip?: string };
type Row = Record<string, string | number>;
type ReportData = {
  report: string;
  columns: Column[];
  rows: Row[];
  total: Row | null;
  chart?: { label: string; value: number }[];
  note?: string;
  from: string;
  to: string;
  groupBy: string;
  outletId: string;
  outletName: string;
  availableOutlets?: { id: string; name: string }[];
  generatedAt: string;
};

const REPORTS = [
  { id: "over-time", label: "Sales over time" },
  { id: "channel", label: "By Channel" },
  { id: "product", label: "By Product" },
  { id: "category", label: "By Category" },
  { id: "sku", label: "By SKU" },
  { id: "payment", label: "By Payment" },
  { id: "promotion", label: "Promotions" },
  { id: "shift", label: "Shifts" },
] as const;
type ReportId = (typeof REPORTS)[number]["id"];

const GROUPS = [
  { id: "day", label: "Daily" },
  { id: "week", label: "Weekly" },
  { id: "month", label: "Monthly" },
] as const;

const PAGE_SIZE = 50;

const fmtRM = (v: number) =>
  `RM ${v.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtInt = (v: number) => v.toLocaleString("en-MY");
const fmtPct = (v: number) => `${v.toFixed(2)}%`;
const fmtCell = (v: string | number, kind: ColKind) => {
  if (kind === "text") return String(v ?? "");
  const n = typeof v === "number" ? v : Number(v) || 0;
  if (kind === "rm") return fmtRM(n);
  if (kind === "pct") return fmtPct(n);
  return fmtInt(n);
};

const mytToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const addDaysStr = (d: string, n: number) => {
  const dt = new Date(`${d}T12:00:00+08:00`);
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
};
const startOfWeek = (d: string) => addDaysStr(d, -new Date(`${d}T12:00:00+08:00`).getDay());
const startOfMonth = (d: string) => `${d.slice(0, 7)}-01`;

export default function SalesReportsPage() {
  const today = mytToday();
  const [report, setReport] = useState<ReportId>("over-time");
  const [groupBy, setGroupBy] = useState<"day" | "week" | "month">("day");
  const [from, setFrom] = useState(addDaysStr(today, -6));
  const [to, setTo] = useState(today);
  const [outletId, setOutletId] = useState("all");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ report, from, to, outletId, groupBy });
      const res = await adminFetch(`/api/sales/reports?${qs.toString()}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Load failed");
      const json = (await res.json()) as ReportData;
      setData(json);
      setSort(null);
      setSearch("");
      setCategory("all");
      setPage(1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [report, from, to, outletId, groupBy]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = data?.columns ?? [];
  const firstTextKey = columns.find((c) => c.kind === "text")?.key;
  const hasCategory = columns.some((c) => c.key === "category");

  const categoryOptions = useMemo(() => {
    if (!hasCategory) return [];
    const set = new Set<string>();
    for (const r of data?.rows ?? []) {
      const v = String(r.category ?? "").trim();
      if (v) set.add(v);
    }
    return [...set].sort();
  }, [data, hasCategory]);

  // sort → filter (search + category) → the totals row reflects the filtered set.
  const sortedRows = useMemo(() => {
    const rows = data?.rows ?? [];
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const isText = col?.kind === "text";
    return [...rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      const cmp = isText ? String(av).localeCompare(String(bv)) : (Number(av) || 0) - (Number(bv) || 0);
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [data, sort, columns]);

  const filteredRows = useMemo(() => {
    let rows = sortedRows;
    const q = search.trim().toLowerCase();
    if (q) {
      const textKeys = columns.filter((c) => c.kind === "text").map((c) => c.key);
      rows = rows.filter((r) => textKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(q)));
    }
    if (hasCategory && category !== "all") rows = rows.filter((r) => String(r.category ?? "") === category);
    return rows;
  }, [sortedRows, search, category, columns, hasCategory]);

  const isFiltered = search.trim() !== "" || category !== "all";
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedRows = filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Totals: server total when unfiltered; when filtered, sum additive columns
  // only (rm/int) and blank ratios/averages (pct + avg) to avoid wrong math.
  const AVG_KEYS = new Set(["aov", "avgCost"]);
  const totalRow: Row | null = useMemo(() => {
    if (!data?.total) return null;
    if (!isFiltered) return data.total;
    const t: Row = {};
    columns.forEach((c, i) => {
      if (i === 0) t[c.key] = "Total";
      else if (c.kind === "rm" && !AVG_KEYS.has(c.key)) t[c.key] = filteredRows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
      else if (c.kind === "int") t[c.key] = filteredRows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
      else t[c.key] = "";
    });
    return t;
  }, [data, isFiltered, filteredRows, columns]);

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));

  const setPreset = (preset: "today" | "7d" | "week" | "month" | "30d") => {
    const t = mytToday();
    if (preset === "today") { setFrom(t); setTo(t); }
    else if (preset === "7d") { setFrom(addDaysStr(t, -6)); setTo(t); }
    else if (preset === "30d") { setFrom(addDaysStr(t, -29)); setTo(t); }
    else if (preset === "week") { setFrom(startOfWeek(t)); setTo(t); }
    else if (preset === "month") { setFrom(startOfMonth(t)); setTo(t); }
  };
  const presetActive = (preset: "today" | "7d" | "week" | "month" | "30d"): boolean => {
    const t = today;
    if (preset === "today") return from === t && to === t;
    if (preset === "7d") return from === addDaysStr(t, -6) && to === t;
    if (preset === "30d") return from === addDaysStr(t, -29) && to === t;
    if (preset === "week") return from === startOfWeek(t) && to === t;
    return from === startOfMonth(t) && to === t;
  };

  const downloadCsv = () => {
    if (!data) return;
    const esc = (v: string | number) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = columns.map((c) => esc(c.label)).join(",");
    const body = filteredRows.map((r) => columns.map((c) => esc(r[c.key])).join(",")).join("\n");
    const totalLine = totalRow ? "\n" + columns.map((c) => esc(totalRow[c.key])).join(",") : "";
    const csv = `${head}\n${body}${totalLine}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `celsius-${report}-${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-3 sm:p-6 space-y-5 max-w-6xl">
      <ReportsTabs />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#160800]">Sales Reports</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data?.outletName ?? "All outlets"}
            {data?.generatedAt && (
              <> · Data as of {new Date(data.generatedAt).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" })}</>
            )}
          </p>
        </div>
        <button
          onClick={downloadCsv}
          disabled={!data || loading}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-[#160800] hover:bg-gray-50 disabled:opacity-50"
        >
          <Download className="h-4 w-4" /> Download CSV
        </button>
      </div>

      {/* Report selector */}
      <div className="flex flex-wrap gap-1 bg-white rounded-xl p-1 w-fit border border-border/40">
        {REPORTS.map((r) => (
          <button
            key={r.id}
            onClick={() => setReport(r.id)}
            className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
              report === r.id ? "bg-[#160800] text-white shadow-sm" : "text-muted-foreground hover:text-[#160800]"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Toolbar: date range + presets + outlet + group-by */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1.5">
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="bg-transparent text-sm text-[#160800] outline-none" />
          <span className="text-gray-400">→</span>
          <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="bg-transparent text-sm text-[#160800] outline-none" />
        </div>

        <div className="flex gap-1">
          {([
            { id: "today", label: "Today" },
            { id: "7d", label: "7 days" },
            { id: "week", label: "This week" },
            { id: "month", label: "This month" },
            { id: "30d", label: "30 days" },
          ] as const).map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                presetActive(p.id) ? "bg-[#FBEBE8] text-[#A2492C]" : "text-muted-foreground hover:bg-gray-100"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {data?.availableOutlets && (
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-[#160800] outline-none">
            <option value="all">All outlets</option>
            {data.availableOutlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        )}

        {report === "over-time" && (
          <div className="flex gap-1 rounded-lg border border-gray-200 bg-white p-1">
            {GROUPS.map((g) => (
              <button
                key={g.id}
                onClick={() => setGroupBy(g.id)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  groupBy === g.id ? "bg-[#160800] text-white" : "text-muted-foreground hover:text-[#160800]"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Filters: search + category */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 min-w-[220px]">
          <Search className="h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search…"
            className="bg-transparent text-sm text-[#160800] outline-none w-full"
          />
        </div>
        {hasCategory && categoryOptions.length > 0 && (
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); setPage(1); }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-[#160800] outline-none"
          >
            <option value="all">All categories</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
        {isFiltered && (
          <button onClick={() => { setSearch(""); setCategory("all"); setPage(1); }} className="text-xs text-[#A2492C] hover:underline">
            Clear filters
          </button>
        )}
      </div>

      {data?.note && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{data.note}</span>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      )}

      {!loading && data && (
        <>
          {data.chart && data.chart.length > 0 && !isFiltered && <Chart data={data.chart} />}

          <div className="rounded-2xl border border-gray-200 bg-white overflow-auto max-h-[68vh]">
            <table className="w-full border-separate border-spacing-0">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 text-left text-xs font-medium text-gray-700">
                  {columns.map((c, i) => (
                    <th
                      key={c.key}
                      onClick={() => toggleSort(c.key)}
                      className={`cursor-pointer select-none px-4 py-3 whitespace-nowrap border-b border-gray-200 hover:text-[#160800] ${i === 0 ? "" : "text-right"}`}
                    >
                      <span className={`inline-flex items-center gap-1 ${i === 0 ? "" : "justify-end"}`}>
                        {c.label}
                        {c.tip && (
                          <span title={c.tip} aria-label={c.tip} className="cursor-help">
                            <Info className="h-3 w-3 text-gray-300" />
                          </span>
                        )}
                        <SortIcon active={sort?.key === c.key} dir={sort?.dir} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedRows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-gray-500">
                      {isFiltered ? "No rows match your filters." : "No data in this period."}
                    </td>
                  </tr>
                ) : (
                  pagedRows.map((r, ri) => (
                    <tr key={ri} className="hover:bg-gray-50">
                      {columns.map((c, ci) => (
                        <td
                          key={c.key}
                          className={`px-4 py-3 text-sm whitespace-nowrap border-b border-gray-100 ${ci === 0 ? "text-[#160800] font-medium" : "text-right text-[#160800]"}`}
                        >
                          {fmtCell(r[c.key], c.kind)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
              {totalRow && pagedRows.length > 0 && (
                <tfoot className="sticky bottom-0">
                  <tr className="bg-gray-100 font-semibold">
                    {columns.map((c, ci) => (
                      <td key={c.key} className={`px-4 py-3 text-sm whitespace-nowrap text-[#160800] border-t-2 border-gray-300 ${ci === 0 ? "" : "text-right"}`}>
                        {totalRow[c.key] === "" ? "" : fmtCell(totalRow[c.key], c.kind)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              {filteredRows.length === 0
                ? "0 rows"
                : `Showing ${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filteredRows.length)} of ${filteredRows.length}`}
              {isFiltered && data && ` (filtered from ${data.rows.length})`}
            </span>
            {pageCount > 1 && (
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1} className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 disabled:opacity-40 hover:bg-gray-50">
                  <ChevronLeft className="h-3.5 w-3.5" /> Prev
                </button>
                <span>Page {safePage} / {pageCount}</span>
                <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={safePage >= pageCount} className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 disabled:opacity-40 hover:bg-gray-50">
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SortIcon({ active, dir }: { active?: boolean; dir?: "asc" | "desc" }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 text-gray-300" />;
  return dir === "asc" ? <ArrowUp className="h-3 w-3 text-[#A2492C]" /> : <ArrowDown className="h-3 w-3 text-[#A2492C]" />;
}

function Chart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const bars = data.slice(0, 31);
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-end gap-1.5 h-44">
        {bars.map((d, i) => (
          <div key={i} className="group flex flex-1 flex-col items-center justify-end gap-1 min-w-0">
            <div className="text-[10px] font-medium text-[#160800] opacity-0 group-hover:opacity-100 whitespace-nowrap">
              {fmtRM(d.value)}
            </div>
            <div
              className="w-full max-w-[36px] rounded-t bg-[#A2492C]/85 hover:bg-[#A2492C] transition-colors"
              style={{ height: `${Math.max((d.value / max) * 100, 1)}%` }}
              title={`${d.label}: ${fmtRM(d.value)}`}
            />
            <div className="text-[9px] text-gray-500 truncate w-full text-center" title={d.label}>
              {d.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
