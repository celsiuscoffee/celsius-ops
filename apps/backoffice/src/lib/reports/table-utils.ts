// Pure helpers behind <ReportTable/> — searching, sorting and CSV export.
// Kept free of React so the ordering and escaping rules can be unit-tested.

export type SortDir = "asc" | "desc";
export type SortValue = string | number | null | undefined;

const isBlank = (v: SortValue) => v === null || v === undefined || v === "";

/**
 * Order two cells. Blanks always sink to the bottom whichever way the column
 * is sorted — a report row with no cost is not "the smallest cost", it is
 * missing, and burying it keeps the top of the table meaningful.
 * Strings compare naturally so "Item 10" lands after "Item 9".
 */
export function compareValues(a: SortValue, b: SortValue, dir: SortDir): number {
  if (isBlank(a) && isBlank(b)) return 0;
  if (isBlank(a)) return 1;
  if (isBlank(b)) return -1;
  const c =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
  return dir === "asc" ? c : -c;
}

/** Stable sort: equal rows keep the order the report chose for them. */
export function sortRows<T>(rows: T[], value: (row: T) => SortValue, dir: SortDir): T[] {
  return rows
    .map((row, i) => [row, i] as const)
    .sort((x, y) => compareValues(value(x[0]), value(y[0]), dir) || x[1] - y[1])
    .map(([row]) => row);
}

/**
 * Every whitespace-separated term must appear somewhere in the row's text, so
 * "milk shah" narrows instead of widening. Case- and order-insensitive.
 */
export function matchesQuery(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = haystack.toLowerCase();
  return q.split(/\s+/).every((term) => hay.includes(term));
}

/** RFC4180 cell: quote when the value could otherwise break the row. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** Distinct facet values in first-seen order, blanks dropped. */
export function facetValues<T>(rows: T[], value: (row: T) => string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const v = value(row);
    if (v !== null && v !== undefined && v !== "") seen.add(v);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }));
}
