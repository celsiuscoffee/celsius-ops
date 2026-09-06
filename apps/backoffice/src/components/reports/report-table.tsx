"use client";

// One analysis surface for every procurement report: search, per-column sort,
// value filters, quick toggles, page size and CSV export of exactly what is on
// screen. Reports declare their columns and hand over their rows; the table
// owns all the interaction so the six reports behave identically.

import { Fragment, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, Search, X } from "lucide-react";
import { facetValues, matchesQuery, sortRows, toCsv, type SortDir, type SortValue } from "@/lib/reports/table-utils";

export type ReportColumn<T> = {
  key: string;
  header: string;
  align?: "left" | "right";
  /** Return the sort key. Omit to make the column unsortable. */
  sortValue?: (row: T) => SortValue;
  render: (row: T) => React.ReactNode;
  /** Value for the CSV export; defaults to sortValue when present. */
  csv?: (row: T) => string | number | null | undefined;
  /** Extra classes on the body cell. */
  cellClassName?: string;
};

export type ReportFacet<T> = {
  key: string;
  label: string;
  value: (row: T) => string | null | undefined;
};

export type ReportToggle<T> = {
  key: string;
  label: string;
  predicate: (row: T) => boolean;
};

type Props<T> = {
  rows: T[];
  columns: ReportColumn<T>[];
  rowKey: (row: T, index: number) => string;
  /** Text the search box scans. */
  searchText: (row: T) => string;
  searchPlaceholder?: string;
  facets?: ReportFacet<T>[];
  toggles?: ReportToggle<T>[];
  initialSort?: { key: string; dir: SortDir };
  csvFilename?: string;
  emptyMessage?: string;
  minWidth?: number;
  /** Full-width row rendered beneath a row (expanded breakdowns, detail lines).
   *  Return null for rows that have nothing extra to show. */
  subRow?: (row: T) => React.ReactNode;
  /** Row click handler — pair with subRow for expandable rows. */
  onRowClick?: (row: T) => void;
};

const PAGE_SIZES = [25, 50, 100, 250, 1000];

export function ReportTable<T>({
  rows, columns, rowKey, searchText, searchPlaceholder = "Search…",
  facets = [], toggles = [], initialSort, csvFilename = "report",
  emptyMessage = "Nothing to show.", minWidth = 820, subRow, onRowClick,
}: Props<T>) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(initialSort ?? null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [pageSize, setPageSize] = useState(50);

  const facetOptions = useMemo(
    () => facets.map((f) => ({ facet: f, options: facetValues(rows, f.value) })),
    [rows, facets],
  );

  const filtered = useMemo(() => {
    let out = rows;
    for (const f of facets) {
      const want = picked[f.key];
      if (want) out = out.filter((r) => (f.value(r) ?? "") === want);
    }
    for (const t of toggles) if (active[t.key]) out = out.filter(t.predicate);
    if (query.trim()) out = out.filter((r) => matchesQuery(searchText(r), query));
    return out;
  }, [rows, facets, picked, toggles, active, query, searchText]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return filtered;
    return sortRows(filtered, col.sortValue, sort.dir);
  }, [filtered, sort, columns]);

  const visible = sorted.slice(0, pageSize);
  const filtersOn = Object.values(picked).some(Boolean) || Object.values(active).some(Boolean) || query.trim().length > 0;

  function toggleSort(key: string) {
    setSort((s) =>
      s?.key !== key ? { key, dir: "desc" } : s.dir === "desc" ? { key, dir: "asc" } : null,
    );
  }

  function clearAll() {
    setQuery(""); setPicked({}); setActive({});
  }

  // Exports the filtered + sorted set, not the raw response: what you see is
  // what lands in the spreadsheet. BOM so Excel reads UTF-8 correctly.
  function exportCsv() {
    const csv = toCsv(
      columns.map((c) => c.header),
      sorted.map((row) => columns.map((c) => (c.csv ? c.csv(row) : c.sortValue ? c.sortValue(row) : ""))),
    );
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${csvFilename}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-white">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 w-56 rounded-lg border border-gray-200 bg-white pl-7 pr-2 text-xs text-gray-700 placeholder:text-gray-400 focus:border-terracotta focus:outline-none"
          />
        </div>

        {facetOptions.map(({ facet, options }) =>
          options.length > 1 ? (
            <select
              key={facet.key}
              value={picked[facet.key] ?? ""}
              onChange={(e) => setPicked((p) => ({ ...p, [facet.key]: e.target.value }))}
              className="h-8 max-w-[190px] rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700 focus:border-terracotta focus:outline-none"
            >
              <option value="">All {facet.label.toLowerCase()}</option>
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : null,
        )}

        {toggles.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive((a) => ({ ...a, [t.key]: !a[t.key] }))}
            className={`h-8 rounded-lg border px-2.5 text-xs transition-colors ${
              active[t.key]
                ? "border-terracotta bg-terracotta/10 font-medium text-terracotta"
                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {t.label}
          </button>
        ))}

        {filtersOn && (
          <button onClick={clearAll} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-gray-500 hover:text-gray-800">
            <X className="h-3 w-3" /> Clear
          </button>
        )}

        <span className="ml-auto flex items-center gap-2">
          <span className="text-[11px] tabular-nums text-gray-400">
            {filtersOn ? `${sorted.length} of ${rows.length}` : `${rows.length} rows`}
          </span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="h-8 rounded-lg border border-gray-200 bg-white px-1.5 text-xs text-gray-600 focus:border-terracotta focus:outline-none"
            aria-label="Rows per page"
          >
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} rows</option>)}
          </select>
          <button
            onClick={exportCsv}
            disabled={sorted.length === 0}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth }}>
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              {columns.map((c) => {
                const sortable = !!c.sortValue;
                const on = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    className={`px-4 py-3 font-medium text-gray-500 ${c.align === "right" ? "text-right" : "text-left"} ${sortable ? "cursor-pointer select-none hover:text-gray-800" : ""}`}
                    onClick={sortable ? () => toggleSort(c.key) : undefined}
                    aria-sort={on ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                  >
                    <span className={`inline-flex items-center gap-1 ${c.align === "right" ? "flex-row-reverse" : ""}`}>
                      {c.header}
                      {sortable && (on
                        ? (sort!.dir === "asc" ? <ArrowUp className="h-3 w-3 text-terracotta" /> : <ArrowDown className="h-3 w-3 text-terracotta" />)
                        : <ChevronsUpDown className="h-3 w-3 text-gray-300" />)}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-gray-400">
                {filtersOn ? "No rows match these filters." : emptyMessage}
              </td></tr>
            )}
            {visible.map((row, i) => {
              const key = rowKey(row, i);
              const extra = subRow?.(row);
              return (
                <Fragment key={key}>
                  <tr
                    className={`border-b border-gray-50 last:border-b-0 hover:bg-gray-50/70 ${i % 2 ? "bg-gray-50/30" : ""} ${onRowClick ? "cursor-pointer" : ""}`}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={`px-4 py-2.5 ${c.align === "right" ? "text-right" : ""} ${c.cellClassName ?? ""}`}>
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                  {extra ? (
                    <tr className="border-b border-gray-50">
                      <td colSpan={columns.length} className="bg-gray-50 px-4 py-3">{extra}</td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {sorted.length > visible.length && (
        <div className="border-t border-gray-100 px-4 py-2.5 text-center">
          <button
            onClick={() => setPageSize((n) => n + 100)}
            className="text-xs text-terracotta hover:underline"
          >
            Show more — {visible.length} of {sorted.length} shown
          </button>
        </div>
      )}
    </div>
  );
}
