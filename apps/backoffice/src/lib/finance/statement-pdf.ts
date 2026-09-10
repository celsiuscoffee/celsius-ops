// Branded PDF renderer for the Finance › Reports statements (P&L, Balance
// Sheet, Cash Flow, Trial Balance).
//
// Isomorphic on purpose: pdf-lib runs in the browser, so the Reports page
// imports this lazily (`await import(...)`) inside the export handler and the
// ~400KB of pdf-lib never lands in the page bundle. Rendering client-side also
// means the PDF is built from the SAME data the table on screen is rendering —
// the compare column, by-month columns and expense grouping the user picked all
// carry through, exactly like the CSV export does.
//
// The caller passes PRE-FORMATTED value strings. Money formatting therefore
// stays in one place (the page's accounting formatter) and can never drift
// between the screen, the CSV and the PDF.
//
// House style follows the payslip generator (@celsius/shared/src/hr/payslip):
// terracotta brand bar, Helvetica, A4.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

// ─── Document model ─────────────────────────────────────────────

export type StatementColumn = {
  /** Header label, e.g. "Amount", "Apr 2026", "% of income". */
  label: string;
};

export type StatementRow =
  /** Section band — INCOME, EXPENSES, ASSETS… */
  | { kind: "group"; label: string }
  /** Sub-heading inside a section — the P&L expense cost drivers. */
  | { kind: "subgroup"; label: string }
  /** An account line. `values` aligns 1:1 with `columns`. */
  | { kind: "line"; code?: string | null; name: string; values: Array<string | null>; indent?: boolean }
  /** A subtotal / total. `strong` gives it the filled emphasis band. */
  | { kind: "total"; label: string; values: Array<string | null>; strong?: boolean; muted?: boolean }
  | { kind: "spacer" };

export type StatementDoc = {
  /** Legal entity (or "Consolidated, all companies"). */
  company: string;
  /** Statement title — "Profit and Loss". */
  title: string;
  /** "1 April 2026 to 30 June 2026" / "As of 30 June 2026". */
  periodLine: string;
  /** "12 August 2026" — matches the on-screen prepared-on line. */
  preparedOn: string;
  /** Scope qualifier printed under the period, e.g. an outlet filter. */
  scopeNote?: string | null;
  /** Headline tiles, up to 4, drawn above the table on page 1. */
  kpis?: Array<{ label: string; value: string }>;
  /** Value columns. The Code and Account columns are implicit. */
  columns: StatementColumn[];
  rows: StatementRow[];
  /** Footnotes — data caveats, imbalance warnings. */
  notes?: string[];
  /** Suggested download filename (used by the caller, not by the renderer). */
  filename: string;
  /** Omit the leading account-code column (Cash Flow has no codes to show). */
  hideCodes?: boolean;
  /** Force an orientation; default picks landscape past 3 value columns. */
  orientation?: "portrait" | "landscape";
};

// ─── Geometry & palette ─────────────────────────────────────────

const A4_W = 595.28;
const A4_H = 841.89;
const M = 36; // page margin

const BLACK = rgb(0.1, 0.1, 0.1);
const GRAY = rgb(0.42, 0.42, 0.42);
const HAIRLINE = rgb(0.82, 0.82, 0.82);
const BAND = rgb(0.945, 0.941, 0.933);
const TOTAL_BAND = rgb(0.965, 0.925, 0.886);
const WHITE = rgb(1, 1, 1);
// Celsius brand — terracotta #C2452D (globals.css --color-terracotta)
const TERRACOTTA = rgb(0xc2 / 255, 0x45 / 255, 0x2d / 255);

const ROW_H = 13;
const GROUP_H = 16;
const FOOTER_H = 26;

// ─── Text helpers ───────────────────────────────────────────────

// The standard 14 PDF fonts are WinAnsi-encoded, so anything outside Latin-1
// throws at draw time. Map the characters this app actually emits (arrows,
// deltas, curly quotes from account names) and drop the rest rather than
// letting an export fail on one stray glyph.
const CHAR_MAP: Record<string, string> = {
  " ": " ", "→": "->", "←": "<-", "↑": "^", "↓": "v",
  "—": "-", "–": "-", "•": "-", "·": "-", "×": "x", "≈": "~", "≤": "<=", "≥": ">=",
  "Δ": "Delta", "∆": "Delta", "…": "...",
  "‘": "'", "’": "'", "“": '"', "”": '"',
};

export function sanitize(s: string): string {
  let out = "";
  for (const ch of String(s ?? "")) {
    const mapped = CHAR_MAP[ch];
    if (mapped !== undefined) { out += mapped; continue; }
    const code = ch.codePointAt(0) ?? 0;
    // Printable ASCII, or Latin-1 supplement (accented names).
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) out += ch;
    // Anything else (CJK, emoji, box drawing) is dropped.
  }
  return out;
}

/** Truncate to fit `maxWidth`, appending "..." when it had to cut. */
export function fitText(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const s = sanitize(text);
  if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (font.widthOfTextAtSize(`${s.slice(0, mid)}...`, size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? "" : `${s.slice(0, lo)}...`;
}

/** Greedy word wrap for the footnotes block. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = sanitize(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) { line = next; continue; }
    if (line) lines.push(line);
    // A single word longer than the column: hard-cut it.
    line = font.widthOfTextAtSize(w, size) <= maxWidth ? w : fitText(w, font, size, maxWidth);
  }
  if (line) lines.push(line);
  return lines;
}

// ─── Column layout ──────────────────────────────────────────────

export type Layout = { codeW: number; labelW: number; valW: number; size: number; codeSize: number };

// Value columns get a fixed width and the account name takes what's left.
// Wide reports (12 month columns) shrink the value width, then the code column,
// before they ever spill off the page.
//
// The preferred code width fits the longest real COA code
// ("BANK:MARKETPLACE_FEE") without an ellipsis — a truncated code is useless,
// you cannot look it up. 13 is that string's Helvetica width per point of type
// size, rounded up; +8 is the cell padding.
const WIDEST_CODE_EMS = 13;
const MIN_LABEL = 120;
const MIN_VAL = 42;

export function computeLayout(pageWidth: number, columnCount: number, showCodes: boolean): Layout {
  const avail = pageWidth - 2 * M;
  const n = Math.max(1, columnCount);
  const size = n >= 9 ? 6.8 : n >= 6 ? 7.4 : 8.2;
  const codeSize = Math.max(6, size - 1);
  const wideCode = WIDEST_CODE_EMS * codeSize + 8;
  // Full code column, then a narrow one that clips only the longest codes,
  // then none at all.
  for (const codeW of showCodes ? [wideCode, wideCode * 0.7, 0] : [0]) {
    let valW = 76;
    while (valW > MIN_VAL && avail - codeW - n * valW < MIN_LABEL) valW -= 1;
    if (avail - codeW - n * valW >= MIN_LABEL) {
      return { codeW, labelW: avail - codeW - n * valW, valW, size, codeSize };
    }
  }
  // Nothing fits cleanly (a very wide report on portrait): give the values
  // their floor and let the account name take whatever is left.
  return { codeW: 0, labelW: Math.max(60, avail - n * MIN_VAL), valW: MIN_VAL, size, codeSize };
}

// ─── Renderer ───────────────────────────────────────────────────

async function embedLogo(pdf: PDFDocument, bytes: Uint8Array | null | undefined): Promise<PDFImage | null> {
  if (!bytes || bytes.length === 0) return null;
  try {
    return await pdf.embedJpg(bytes);
  } catch {
    try { return await pdf.embedPng(bytes); } catch { return null; }
  }
}

export async function buildStatementPdf(doc: StatementDoc, logoBytes?: Uint8Array | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedLogo(pdf, logoBytes);

  const landscape = doc.orientation === "landscape"
    || (doc.orientation !== "portrait" && doc.columns.length > 3);
  const W = landscape ? A4_H : A4_W;
  const H = landscape ? A4_W : A4_H;
  const showCodes = !doc.hideCodes;
  const L = computeLayout(W, doc.columns.length, showCodes);
  const contentW = W - 2 * M;
  const bottom = M + FOOTER_H;

  pdf.setTitle(`${doc.title} — ${doc.company}`);
  pdf.setSubject(doc.periodLine);
  pdf.setCreator("Celsius Ops");

  let page!: PDFPage;
  let y = 0;
  let first = true;

  // x of the right edge of value column i (values are right-aligned to it).
  const valRight = (i: number) => M + L.codeW + L.labelW + L.valW * (i + 1) - 4;

  function drawColumnHeader() {
    page.drawRectangle({ x: M, y: y - 15, width: contentW, height: 15, color: BAND });
    if (L.codeW > 0) page.drawText("CODE", { x: M + 4, y: y - 11, size: 6.5, font: bold, color: GRAY });
    page.drawText("ACCOUNT", { x: M + L.codeW + 4, y: y - 11, size: 6.5, font: bold, color: GRAY });
    doc.columns.forEach((c, i) => {
      const t = fitText(c.label.toUpperCase(), bold, 6.5, L.valW - 8);
      page.drawText(t, { x: valRight(i) - bold.widthOfTextAtSize(t, 6.5), y: y - 11, size: 6.5, font: bold, color: GRAY });
    });
    y -= 15;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: HAIRLINE });
    y -= 4;
  }

  function newPage() {
    page = pdf.addPage([W, H]);
    // Brand bar across the very top of every page.
    page.drawRectangle({ x: 0, y: H - 3, width: W, height: 3, color: TERRACOTTA });
    y = H - M;

    if (first) {
      first = false;
      const LOGO = 38;
      const textX = logo ? M + LOGO + 10 : M;
      if (logo) page.drawImage(logo, { x: M, y: y - LOGO + 8, width: LOGO, height: LOGO });
      page.drawText(fitText(doc.company, bold, 12, contentW - (textX - M) - 140), {
        x: textX, y: y - 4, size: 12, font: bold, color: TERRACOTTA,
      });
      const prepared = sanitize(`Prepared on ${doc.preparedOn}`);
      page.drawText(prepared, {
        x: W - M - font.widthOfTextAtSize(prepared, 8), y: y - 4, size: 8, font, color: GRAY,
      });
      y -= logo ? LOGO - 2 : 20;

      // Centred statement block, the way the on-screen header frames it.
      const title = sanitize(doc.title);
      page.drawText(title, { x: (W - bold.widthOfTextAtSize(title, 15)) / 2, y: y - 14, size: 15, font: bold, color: BLACK });
      y -= 30;
      const period = sanitize(doc.periodLine);
      page.drawText(period, { x: (W - font.widthOfTextAtSize(period, 9.5)) / 2, y, size: 9.5, font, color: GRAY });
      y -= 12;
      if (doc.scopeNote) {
        const t = fitText(doc.scopeNote, font, 8, contentW);
        page.drawText(t, { x: (W - font.widthOfTextAtSize(t, 8)) / 2, y, size: 8, font, color: GRAY });
        y -= 11;
      }
      const cur = "All figures in Malaysian Ringgit (RM). Negatives in parentheses.";
      page.drawText(cur, { x: (W - font.widthOfTextAtSize(cur, 7)) / 2, y, size: 7, font, color: GRAY });
      y -= 16;

      const kpis = (doc.kpis ?? []).slice(0, 4);
      if (kpis.length > 0) {
        const gap = 8;
        const boxW = (contentW - gap * (kpis.length - 1)) / kpis.length;
        const boxH = 36;
        kpis.forEach((k, i) => {
          const x = M + i * (boxW + gap);
          page.drawRectangle({
            x, y: y - boxH, width: boxW, height: boxH,
            color: WHITE, borderColor: HAIRLINE, borderWidth: 0.6,
          });
          page.drawText(fitText(k.label, font, 7.5, boxW - 16), { x: x + 8, y: y - 13, size: 7.5, font, color: GRAY });
          page.drawText(fitText(k.value, bold, 13, boxW - 16), { x: x + 8, y: y - 29, size: 13, font: bold, color: BLACK });
        });
        y -= boxH + 12;
      }
    } else {
      const cont = fitText(`${doc.company} — ${doc.title} (continued)`, font, 8, contentW - 80);
      page.drawText(cont, { x: M, y: y - 6, size: 8, font, color: GRAY });
      y -= 16;
    }

    drawColumnHeader();
  }

  /** Start a new page when `need` points no longer fit above the footer. */
  function ensure(need: number) {
    if (y - need < bottom) newPage();
  }

  newPage();

  const rows = doc.rows;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    if (r.kind === "spacer") { ensure(6); y -= 6; continue; }

    if (r.kind === "group") {
      // Keep-with-next: never leave a section band stranded at the page foot.
      ensure(GROUP_H + ROW_H * 2);
      page.drawRectangle({ x: M, y: y - GROUP_H, width: contentW, height: GROUP_H, color: BAND });
      page.drawText(fitText(r.label.toUpperCase(), bold, 8, contentW - 12), {
        x: M + 5, y: y - 11.5, size: 8, font: bold, color: BLACK,
      });
      y -= GROUP_H + 2;
      continue;
    }

    if (r.kind === "subgroup") {
      ensure(14 + ROW_H);
      y -= 4;
      page.drawText(fitText(r.label.toUpperCase(), bold, 7, contentW - 12), {
        x: M + 5, y: y - 8, size: 7, font: bold, color: GRAY,
      });
      y -= 13;
      continue;
    }

    if (r.kind === "line") {
      ensure(ROW_H);
      const baseline = y - 9;
      if (L.codeW > 0 && r.code) {
        page.drawText(fitText(r.code, font, L.codeSize, L.codeW - 8), {
          x: M + 4, y: baseline, size: L.codeSize, font, color: GRAY,
        });
      }
      page.drawText(fitText(r.name, font, L.size, L.labelW - 10 - (r.indent ? 10 : 0)), {
        x: M + L.codeW + 4 + (r.indent ? 10 : 0), y: baseline, size: L.size, font, color: BLACK,
      });
      r.values.slice(0, doc.columns.length).forEach((v, ci) => {
        if (v == null || v === "") return;
        const t = fitText(v, font, L.size, L.valW - 6);
        page.drawText(t, { x: valRight(ci) - font.widthOfTextAtSize(t, L.size), y: baseline, size: L.size, font, color: BLACK });
      });
      y -= ROW_H;
      continue;
    }

    // total
    ensure(ROW_H + 8);
    const f = bold;
    const size = r.strong ? L.size + 0.6 : L.size;
    const color = r.muted ? GRAY : BLACK;
    const h = ROW_H + 3;
    if (r.strong) {
      page.drawRectangle({ x: M, y: y - h, width: contentW, height: h, color: TOTAL_BAND });
    } else {
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: HAIRLINE });
    }
    const baseline = y - h + 4.5;
    page.drawText(fitText(r.label, f, size, L.codeW + L.labelW - 10), {
      x: M + 5, y: baseline, size, font: f, color,
    });
    r.values.slice(0, doc.columns.length).forEach((v, ci) => {
      if (v == null || v === "") return;
      const t = fitText(v, f, size, L.valW - 6);
      page.drawText(t, { x: valRight(ci) - f.widthOfTextAtSize(t, size), y: baseline, size, font: f, color });
    });
    y -= h + 2;
  }

  // Footnotes — same caveats the screen prints under the table.
  const notes = (doc.notes ?? []).map((n) => sanitize(n)).filter(Boolean);
  if (notes.length > 0) {
    ensure(18);
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: HAIRLINE });
    y -= 10;
    for (const n of notes) {
      for (const line of wrapText(n, font, 7, contentW)) {
        ensure(9);
        page.drawText(line, { x: M, y: y - 6, size: 7, font, color: GRAY });
        y -= 9;
      }
      y -= 2;
    }
  }

  // Footers last — page count is only known once the flow has finished.
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const { width } = p.getSize();
    p.drawLine({ start: { x: M, y: M + 14 }, end: { x: width - M, y: M + 14 }, thickness: 0.4, color: HAIRLINE });
    p.drawText(sanitize(`${doc.company} — ${doc.title} — ${doc.periodLine}`), {
      x: M, y: M + 4, size: 6.5, font, color: GRAY,
    });
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: width - M - font.widthOfTextAtSize(label, 6.5), y: M + 4, size: 6.5, font, color: GRAY });
  });

  return pdf.save();
}
