// AP register import — ONE-OFF MIGRATION. This Google Sheet was the previous
// payment-request system, before the procurement module existed. It is NOT a
// live source (procurement is) — run this once to backfill the historical
// invoices so the pre-procurement bank outflows have something to match against.
// Do not wire it into a recurring cron.
//
// Each row says what an outflow was (vendor, invoice no, amount, outlet); the
// bank feed only has the payment. We create procurement Invoice rows; the
// existing AP-match (ap-match.ts) then links invoice ↔ bank line.
//
// The sheet is link-shareable, so we fetch its CSV export directly (no auth).
// Idempotent: an invoice number already in the DB is skipped, so a re-run only
// fills gaps. Imported invoices are one-off-vendor (vendorName, no Supplier
// record) with status PENDING — the matcher then settles + marks them paid.

import { prisma } from "@/lib/prisma";

const SHEET_ID = "14Y7B65kbOGMLL1FAgfXnwWqWKv2zptTZDRpvRAWozuc";
const GID = "683731319";
export const AP_SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;

// Column positions in the sheet (by data layout, not the offset header row).
const COL = { requestedDate: 0, vendor: 2, description: 3, invoiceNo: 4, amount: 5, outlet: 6, invoiceDate: 10, due: 11 } as const;

const OUTLET = {
  shahAlam: "b3b6299e-09dc-4f4a-80ef-bbc04316d324",
  putrajaya: "89b19c9f-b1e0-42fe-a404-6d1a472e34c5",
  tamarind: "5d1f2731-1985-4e54-a6df-3990e7d5c159",
  nilai: "0fbc54df-959f-4948-9ed0-992d248c51f9",
  ioi: "baf4566e-dbba-4859-b8c7-a863c12d6682",
};

// "CelsiusCoffee SA" → Shah Alam, "… P" → Putrajaya, etc. Plain "CelsiusCoffee"
// (company-wide buys) defaults to Shah Alam (the HQ outlet).
function outletIdFromSheet(s: string): string {
  const t = ` ${s.toUpperCase().trim()} `;
  if (/\bSA\b|SHAH/.test(t)) return OUTLET.shahAlam;
  if (/\bP\b|PUTRA|CONEZION/.test(t)) return OUTLET.putrajaya;
  if (/\bT\b|TAMAR/.test(t)) return OUTLET.tamarind;
  if (/IOI/.test(t)) return OUTLET.ioi;
  if (/\bN\b|NILAI/.test(t)) return OUTLET.nilai;
  return OUTLET.shahAlam;
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// Sheet dates come as "18-Aug-2025" (invoice date) or US-style "7/15/2025"
// (requested date — month/day confirmed by values like 7/15).
function parseDate(s: string): Date | null {
  const v = (s ?? "").trim();
  if (!v) return null;
  let m = v.match(/^(\d{1,2})-([A-Za-z]{3,})-(\d{4})$/);
  if (m) { const mon = MONTHS[m[2].slice(0, 3).toLowerCase()]; if (mon != null) return new Date(Date.UTC(+m[3], mon, +m[1])); }
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    let month = +m[1], day = +m[2];
    if (+m[1] > 12 && +m[2] <= 12) { day = +m[1]; month = +m[2]; } // tolerate D/M too
    return new Date(Date.UTC(+m[3], month - 1, day));
  }
  return null;
}

function parseAmount(s: string): number {
  return Math.round(parseFloat((s ?? "").replace(/[^0-9.]/g, "")) * 100) / 100 || 0;
}

// Split "Unique Paper Sdn Bhd (Fav Acc InterB, CIMB)" → name + bank hint.
function parseVendor(s: string): { name: string; bank: string | null } {
  const v = (s ?? "").trim();
  const m = v.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (m) return { name: m[1].trim(), bank: m[2].trim() || null };
  return { name: v, bank: null };
}

// Minimal RFC-4180 CSV parser (handles quoted fields with commas + newlines).
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export type ApSheetImportResult = {
  committed: boolean;
  rows: number;
  created: number;
  skippedExisting: number;
  skippedInvalid: number;
  totalCreatedRM: number;
  sample: { invoiceNumber: string; vendor: string; amount: number; outlet: string }[];
};

export async function importApSheet(opts: { commit?: boolean } = {}): Promise<ApSheetImportResult> {
  const commit = opts.commit ?? false;

  const res = await fetch(AP_SHEET_CSV_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`AP sheet fetch failed: ${res.status}`);
  const csv = await res.text();
  const rows = parseCsv(csv);
  const dataRows = rows.slice(1); // drop header

  // Existing invoice numbers (dedupe) — trim/upcase for a forgiving match.
  const existing = new Set(
    (await prisma.invoice.findMany({ select: { invoiceNumber: true } })).map((i) => i.invoiceNumber.trim().toUpperCase()),
  );

  let created = 0, skippedExisting = 0, skippedInvalid = 0, totalCreatedRM = 0;
  const sample: ApSheetImportResult["sample"] = [];
  const seen = new Set<string>();

  for (const r of dataRows) {
    const invoiceNumber = (r[COL.invoiceNo] ?? "").trim();
    const amount = parseAmount(r[COL.amount] ?? "");
    const { name: vendorName, bank } = parseVendor(r[COL.vendor] ?? "");
    if (!invoiceNumber || amount <= 0 || !vendorName) { skippedInvalid++; continue; }
    const key = invoiceNumber.toUpperCase();
    if (existing.has(key) || seen.has(key)) { skippedExisting++; continue; }
    seen.add(key);

    const issueDate = parseDate(r[COL.invoiceDate] ?? "") ?? parseDate(r[COL.requestedDate] ?? "") ?? new Date();
    const dueDate = parseDate(r[COL.due] ?? "");
    const outletId = outletIdFromSheet(r[COL.outlet] ?? "");
    const notes = (r[COL.description] ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || null;

    if (commit) {
      await prisma.invoice.create({
        data: {
          invoiceNumber, amount, outletId, issueDate, dueDate,
          status: "PENDING", paymentType: "SUPPLIER",
          vendorName, vendorBankName: bank, notes,
        },
      });
    }
    created++; totalCreatedRM = Math.round((totalCreatedRM + amount) * 100) / 100;
    if (sample.length < 10) sample.push({ invoiceNumber, vendor: vendorName, amount, outlet: r[COL.outlet]?.trim() ?? "" });
  }

  return { committed: commit, rows: dataRows.length, created, skippedExisting, skippedInvalid, totalCreatedRM, sample };
}
