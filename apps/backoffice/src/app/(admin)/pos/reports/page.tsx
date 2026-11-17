"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Download, ArrowUpDown, ArrowUp, ArrowDown, Info, Search, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { toast } from "@celsius/ui";
import { useLatestRequest } from "@/lib/use-latest-request";
import { ReportsTabs } from "../_ReportsTabs";
import { KeyNumber } from "@/components/ui/key-number";
import { DateRangePicker } from "@/components/date-range-picker";

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
  { id: "channel", label: "By channel" },
  { id: "product", label: "By product" },
  { id: "category", label: "By category" },
  { id: "payment", label: "By payment" },
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
  const [categories, setCategories] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  const beginRequest = useLatestRequest();
  const load = useCallback(async () => {
    // Stale-response guard — Product/Category reports are heavy (full cost model
    // over all outlets), so switching report/outlet quickly could let an older
    // slow response overwrite the newer view. Only the latest request commits.
    const { signal, isCurrent } = beginRequest();
    setLoading(true);
    try {
      const qs = new URLSearchParams({ report, from, to, outletId, groupBy });
      const res = await adminFetch(`/api/sales/reports?${qs.toString()}`, { signal });
      if (!isCurrent()) return;
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Load failed");
      const json = (await res.json()) as ReportData;
      if (!isCurrent()) return;
      setData(json);
      setSort(null);
      setSearch("");
      setCategories([]);
      setPage(1);
    } catch (e) {
      if (!isCurrent()) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      toast.error(e instanceof Error ? e.message : "Failed to load report");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [report, from, to, outletId, groupBy, beginRequest]);

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
    if (hasCategory && categories.length > 0) rows = rows.filter((r) => categories.includes(String(r.category ?? "")));
    return rows;
  }, [sortedRows, search, categories, columns, hasCategory]);

  const isFiltered = search.trim() !== "" || categories.length > 0;
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

  // Key numbers: the period's totals for the first money and count columns of
  // whichever report is open (the API's total row; no new maths).
  const kpiCols = columns.filter((c) => c.kind !== "text").slice(0, 4);
  const rangeLabel = (d: string) => new Date(`${d}T12:00:00+08:00`).toLocaleDateString("en-MY", { day: "numeric", month: "short" });

  return (
    <div className="max-w-[1100px] space-y-5 px-4 pt-6 pb-10 md:px-8">
      <ReportsTabs />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Sales reports</h1>
          <p className="mt-0.5 text-sm text-text-2">
            What sold, through which channel and payment, for any outlet and dates.
            {data?.generatedAt && <span className="text-text-3"> Data as of {new Date(data.generatedAt).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kuala_Lumpur" })}.</span>}
          </p>
        </div>
        <button
          onClick={downloadCsv}
          disabled={!data || loading}
          className="inline-flex h-10 items-center gap-2 self-start rounded-ctl border border-line bg-surface px-4 text-sm font-medium text-text hover:bg-sunken disabled:opacity-50"
        >
          <Download className="h-4 w-4" /> Download CSV
        </button>
      </div>

      {/* Report selector */}
      <div className="flex gap-5 overflow-x-auto border-b border-line">
        {REPORTS.map((r) => (
          <button
            key={r.id}
            onClick={() => setReport(r.id)}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 pb-2.5 text-sm transition-colors ${
              report === r.id ? "border-text font-semibold text-text" : "border-transparent text-text-2 hover:text-text"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Toolbar: date range + presets + outlet + group-by */}
      <div className="flex flex-wrap items-center gap-2">
        <DateRangePicker start={from} end={to} onChange={(a, b) => { setFrom(a); setTo(b > today ? today : b); }} />

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
              className={`h-9 rounded-full border px-3 text-[13px] transition-colors ${
                presetActive(p.id) ? "border-text bg-raised font-semibold text-text" : "border-line text-text-2 hover:bg-sunken"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {data?.availableOutlets && (
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="h-10 rounded-ctl border border-line bg-surface px-3 text-sm text-text outline-none">
            <option value="all">All outlets</option>
            {data.availableOutlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        )}

        {report === "over-time" && (
          <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
            {GROUPS.map((g) => (
              <button
                key={g.id}
                onClick={() => setGroupBy(g.id)}
                className={`h-8 rounded-ctl px-3 text-[13px] font-medium transition-colors ${
                  groupBy === g.id ? "bg-ink text-on-ink" : "text-text-2 hover:text-text"
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
        <div className="flex h-10 w-full items-center gap-2 rounded-ctl border border-line bg-surface px-3 sm:w-auto sm:min-w-[220px]">
          <Search className="h-4 w-4 text-text-3" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search…"
            className="bg-transparent text-sm text-text outline-none w-full"
          />
        </div>
        {hasCategory && categoryOptions.length > 0 && (
          <MultiSelect
            label="All categories"
            options={categoryOptions}
            selected={categories}
            onChange={(v) => { setCategories(v); setPage(1); }}
          />
        )}
        {isFiltered && (
          <button onClick={() => { setSearch(""); setCategories([]); setPage(1); }} className="text-[13px] text-brand-text hover:underline">
            Clear filters
          </button>
        )}
      </div>

      {data?.note && (
        <div className="flex items-start gap-2 rounded-card bg-warn-soft px-3 py-2 text-[13px] text-warn-text">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{data.note}</span>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-text-3" />
        </div>
      )}

      {!loading && data && (
        <>
          {totalRow && kpiCols.length > 0 && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {kpiCols.map((c) => (
                <KeyNumber key={c.key} label={c.label} value={totalRow[c.key] === "" ? "–" : fmtCell(totalRow[c.key], c.kind)}
                  note={<>{isFiltered ? "rows shown, " : ""}{rangeLabel(from)} – {rangeLabel(to)}</>} />
              ))}
            </div>
          )}
          {data.chart && data.chart.length > 0 && !isFiltered && <Chart data={data.chart} />}

          <div className="max-h-[68vh] overflow-auto rounded-card border border-line bg-surface">
            <table className="w-full border-separate border-spacing-0">
              <thead className="sticky top-0 z-10">
                <tr className="bg-sunken text-left text-xs font-medium text-text-2">
                  {columns.map((c, i) => (
                    <th
                      key={c.key}
                      onClick={() => toggleSort(c.key)}
                      className={`cursor-pointer select-none px-3 py-2.5 border-b border-line hover:text-text ${i === 0 ? "min-w-[150px]" : "whitespace-nowrap text-right"}`}
                    >
                      <span className={`inline-flex items-center gap-1 ${i === 0 ? "" : "justify-end"}`}>
                        {c.label}
                        {c.tip && (
                          <span title={c.tip} aria-label={c.tip} className="cursor-help">
                            <Info className="h-3 w-3 text-text-3" />
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
                    <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-text-2">
                      {isFiltered ? "No rows match your filters." : "No data in this period."}
                    </td>
                  </tr>
                ) : (
                  pagedRows.map((r, ri) => (
                    <tr key={ri} className="hover:bg-sunken">
                      {columns.map((c, ci) => (
                        <td
                          key={c.key}
                          className={`px-3 py-2.5 text-sm border-b border-line ${ci === 0 ? "text-text font-medium" : "whitespace-nowrap text-right text-text"}`}
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
                  <tr className="bg-sunken font-semibold">
                    {columns.map((c, ci) => (
                      <td key={c.key} className={`px-3 py-2.5 text-sm text-text border-t-2 border-line-2 ${ci === 0 ? "" : "whitespace-nowrap text-right"}`}>
                        {totalRow[c.key] === "" ? "" : fmtCell(totalRow[c.key], c.kind)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-xs text-text-2">
            <span>
              {filteredRows.length === 0
                ? "0 rows"
                : `Showing ${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filteredRows.length)} of ${filteredRows.length}`}
              {isFiltered && data && ` (filtered from ${data.rows.length})`}
            </span>
            {pageCount > 1 && (
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1} className="inline-flex h-9 items-center gap-1 rounded-ctl border border-line px-3 disabled:opacity-40 hover:bg-sunken">
                  <ChevronLeft className="h-3.5 w-3.5" /> Prev
                </button>
                <span>Page {safePage} / {pageCount}</span>
                <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={safePage >= pageCount} className="inline-flex h-9 items-center gap-1 rounded-ctl border border-line px-3 disabled:opacity-40 hover:bg-sunken">
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
  if (!active) return <ArrowUpDown className="h-3 w-3 text-text-3" />;
  return dir === "asc" ? <ArrowUp className="h-3 w-3 text-brand-text" /> : <ArrowDown className="h-3 w-3 text-brand-text" />;
}

function MultiSelect({
  label, options, selected, onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = (o: string) =>
    onChange(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]);

  const summary =
    selected.length === 0 ? label : selected.length === 1 ? selected[0] : `${selected.length} categories`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-10 items-center gap-2 rounded-ctl border bg-surface px-3 text-sm outline-none ${
          selected.length ? "border-text font-semibold text-text" : "border-line text-text"
        }`}
      >
        {summary}
        <ChevronDown className={`h-4 w-4 text-text-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-60 overflow-auto rounded-lg border border-line bg-surface p-1 shadow-lg">
          <div className="flex items-center justify-between px-2 py-1.5 text-xs text-text-2">
            <button onClick={() => onChange(options)} className="hover:text-brand-text">Select all</button>
            <button onClick={() => onChange([])} className="hover:text-brand-text">Clear</button>
          </div>
          {options.map((o) => (
            <label key={o} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text hover:bg-sunken">
              <input
                type="checkbox"
                checked={selected.includes(o)}
                onChange={() => toggle(o)}
                className="h-3.5 w-3.5 accent-ink"
              />
              <span className="truncate">{o}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function Chart({ data }: { data: { label: string; value: number }[] }) {
  const bars = data.slice(0, 31);
  const max = Math.max(...bars.map((d) => d.value), 1);
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      {/* Plot: each column is full-height so the bar's % height resolves. */}
      <div className="flex h-48 items-end gap-2">
        {bars.map((d, i) => (
          <div key={i} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
            <span className="pointer-events-none absolute inset-x-0 bottom-full mb-1 whitespace-nowrap text-center text-[10px] font-medium text-text opacity-0 group-hover:opacity-100">
              {fmtRM(d.value)}
            </span>
            <div
              className="mx-auto w-full max-w-[40px] rounded-t bg-brand transition-opacity hover:opacity-80"
              style={{ height: `${Math.max((d.value / max) * 100, 2)}%` }}
              title={`${d.label}: ${fmtRM(d.value)}`}
            />
          </div>
        ))}
      </div>
      {/* Labels aligned under each bar via the same flex columns. */}
      <div className="mt-2 flex gap-2">
        {bars.map((d, i) => (
          <div key={i} className="min-w-0 flex-1 truncate text-center text-[10px] text-text-2" title={d.label}>
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}
