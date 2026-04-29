import * as XLSX from "xlsx";

// Parses a bank-statement CSV / XLSX file and returns the totals + period.
//
// Designed to be tolerant of bank-export formats — Maybank's CSV is the
// primary target but the same heuristics work for most retail-bank exports
// (CIMB, RHB, HSBC, etc.). We don't attempt categorisation here; just sum
// debits/credits and bound the period.
//
// Heuristics
// ----------
// 1. Read the first worksheet of an XLSX, or the file as a single sheet for
//    CSV. Convert to a 2D array of strings.
// 2. Find the header row by scanning for a row that contains at least one
//    column whose lower-cased header includes "debit" or "withdrawal" AND
//    one that includes "credit" or "deposit". A row that mentions just
//    "amount" + a separate "type" / "DR/CR" column is a fallback.
// 3. Find the "date" column the same way.
// 4. Walk subsequent rows, accumulating debits + credits and tracking
//    min/max date. Skip rows where the date column doesn't parse.
//
// Anything we can't parse becomes a warning the UI surfaces — Finance can
// still type in the totals manually if the parse fails.

export type ParsedStatement = {
  totalInflows: number;
  totalOutflows: number;
  periodStart: string | null;   // YYYY-MM-DD
  periodEnd: string | null;     // YYYY-MM-DD
  rowsParsed: number;
  warnings: string[];
};

const INFLOW_HEADERS = ["credit", "deposit", "credits", "kredit", "in"];
const OUTFLOW_HEADERS = ["debit", "withdrawal", "withdrawals", "debits", "debit (rm)", "out"];
const DATE_HEADERS = ["date", "transaction date", "txn date", "value date", "tarikh", "posting date"];
const AMOUNT_HEADERS = ["amount", "transaction amount", "amt"];
const DR_CR_HEADERS = ["dr/cr", "dr cr", "type", "debit/credit", "transaction type"];

function normalize(s: unknown): string {
  return typeof s === "string" ? s.trim().toLowerCase() : "";
}

function parseAmount(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v).trim();
  if (!s) return 0;
  // Some banks wrap negatives in parentheses, append "DR", or use commas.
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (/\bdr\b/i.test(s)) sign = -1;
  s = s.replace(/[^\d.\-]/g, "");
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return sign * n;
}

function parseDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === "number") {
    // Excel date serial — XLSX should auto-convert with cellDates: true,
    // but if it slips through, fallback the conversion.
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d, d.H, d.M, d.S));
    return null;
  }
  const s = String(v).trim();
  if (!s) return null;
  // Try ISO first, then DD/MM/YYYY (Maybank), then DD-MM-YYYY.
  const iso = new Date(s);
  if (!isNaN(iso.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(s)) return iso;
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m1) {
    const d = parseInt(m1[1], 10);
    const mo = parseInt(m1[2], 10) - 1;
    let y = parseInt(m1[3], 10);
    if (y < 100) y += 2000;
    const dt = new Date(Date.UTC(y, mo, d));
    if (!isNaN(dt.getTime())) return dt;
  }
  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function findHeaderRow(rows: unknown[][]): { idx: number; cols: Record<string, number> } | null {
  // Scan up to first 25 rows looking for the header. Banks often pad with
  // metadata (account holder, statement period, etc.) before the table.
  const limit = Math.min(rows.length, 25);
  for (let i = 0; i < limit; i++) {
    const row = rows[i].map(normalize);
    const dateIdx = row.findIndex((c) => DATE_HEADERS.some((h) => c.includes(h)));
    if (dateIdx < 0) continue;
    const debitIdx = row.findIndex((c) => OUTFLOW_HEADERS.some((h) => c === h || c.includes(h)));
    const creditIdx = row.findIndex((c) => INFLOW_HEADERS.some((h) => c === h || c.includes(h)));
    const amountIdx = row.findIndex((c) => AMOUNT_HEADERS.some((h) => c === h));
    const drcrIdx = row.findIndex((c) => DR_CR_HEADERS.some((h) => c.includes(h)));
    if (debitIdx >= 0 && creditIdx >= 0) {
      return { idx: i, cols: { date: dateIdx, debit: debitIdx, credit: creditIdx } };
    }
    if (amountIdx >= 0 && drcrIdx >= 0) {
      return { idx: i, cols: { date: dateIdx, amount: amountIdx, drcr: drcrIdx } };
    }
  }
  return null;
}

export function parseBankStatementBuffer(buffer: Buffer, filename = "statement"): ParsedStatement {
  const warnings: string[] = [];
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch (err) {
    return {
      totalInflows: 0,
      totalOutflows: 0,
      periodStart: null,
      periodEnd: null,
      rowsParsed: 0,
      warnings: [`Could not read file as CSV/XLSX: ${err instanceof Error ? err.message : "parse error"}`],
    };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return {
      totalInflows: 0,
      totalOutflows: 0,
      periodStart: null,
      periodEnd: null,
      rowsParsed: 0,
      warnings: [`No worksheets found in ${filename}`],
    };
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null }) as unknown[][];

  const header = findHeaderRow(rows);
  if (!header) {
    return {
      totalInflows: 0,
      totalOutflows: 0,
      periodStart: null,
      periodEnd: null,
      rowsParsed: 0,
      warnings: [`Couldn't find a header row with date + debit/credit columns. Expected something like "Date / Debit / Credit" or "Date / Amount / DR/CR". Type the totals in manually.`],
    };
  }

  let totalIn = 0;
  let totalOut = 0;
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;
  let rowsParsed = 0;

  for (let i = header.idx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const date = parseDate(row[header.cols.date!]);
    if (!date) continue;

    let inflow = 0;
    let outflow = 0;

    if (header.cols.debit != null && header.cols.credit != null) {
      const dbt = parseAmount(row[header.cols.debit]);
      const crd = parseAmount(row[header.cols.credit]);
      if (dbt > 0) outflow = dbt;
      if (crd > 0) inflow = crd;
    } else if (header.cols.amount != null && header.cols.drcr != null) {
      const amt = Math.abs(parseAmount(row[header.cols.amount]));
      const tag = normalize(row[header.cols.drcr]);
      if (/^d|debit|dr|wd|withdraw/.test(tag)) outflow = amt;
      else if (/^c|credit|cr|dep|deposit/.test(tag)) inflow = amt;
    }

    if (inflow === 0 && outflow === 0) continue;

    totalIn += inflow;
    totalOut += outflow;
    if (!periodStart || date < periodStart) periodStart = date;
    if (!periodEnd || date > periodEnd) periodEnd = date;
    rowsParsed++;
  }

  if (rowsParsed === 0) {
    warnings.push(`Found a header but no transaction rows parsed. Check the file format.`);
  }

  return {
    totalInflows: Math.round(totalIn * 100) / 100,
    totalOutflows: Math.round(totalOut * 100) / 100,
    periodStart: periodStart ? ymd(periodStart) : null,
    periodEnd: periodEnd ? ymd(periodEnd) : null,
    rowsParsed,
    warnings,
  };
}
