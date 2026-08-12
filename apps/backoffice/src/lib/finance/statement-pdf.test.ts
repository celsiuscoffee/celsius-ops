import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  buildStatementPdf,
  computeLayout,
  fitText,
  sanitize,
  wrapText,
  type StatementDoc,
  type StatementRow,
} from "./statement-pdf";

async function helvetica() {
  const pdf = await PDFDocument.create();
  return pdf.embedFont(StandardFonts.Helvetica);
}

const baseDoc = (rows: StatementRow[], columns = [{ label: "Amount" }]): StatementDoc => ({
  company: "Celsius Coffee Conezion",
  title: "Profit and Loss",
  periodLine: "1 April 2026 to 30 June 2026",
  preparedOn: "12 August 2026",
  columns,
  rows,
  filename: "pnl.pdf",
});

describe("sanitize", () => {
  it("maps the non-Latin-1 glyphs this app emits instead of dropping them", () => {
    expect(sanitize("2026-04-01 → 2026-06-30")).toBe("2026-04-01 -> 2026-06-30");
    expect(sanitize("Δ vs prev")).toBe("Delta vs prev");
    expect(sanitize("Grab • fees…")).toBe("Grab - fees...");
  });

  it("keeps the non-breaking space Intl currency formatting emits", () => {
    // "RM 387,939.88" — the space must survive as a plain space, not vanish.
    expect(sanitize("RM 387,939.88")).toBe("RM 387,939.88");
  });

  it("keeps accented Latin-1 characters and drops what Helvetica cannot draw", () => {
    expect(sanitize("Café")).toBe("Café");
    expect(sanitize("咖啡 latte")).toBe(" latte");
  });

  it("produces only WinAnsi-encodable text for a font to draw", async () => {
    const font = await helvetica();
    const nasty = "Δ → café 咖啡 • “quoted” — 1×2 ≈ 3";
    // widthOfTextAtSize throws on characters the encoding cannot represent.
    expect(() => font.widthOfTextAtSize(sanitize(nasty), 8)).not.toThrow();
  });
});

describe("fitText", () => {
  it("leaves text that already fits untouched", async () => {
    const font = await helvetica();
    expect(fitText("Rent", font, 8, 200)).toBe("Rent");
  });

  it("truncates to width with an ellipsis", async () => {
    const font = await helvetica();
    const out = fitText("Statutory contributions, employer EPF/SOCSO/EIS (accrued from payroll)", font, 8, 60);
    expect(out.endsWith("...")).toBe(true);
    expect(font.widthOfTextAtSize(out, 8)).toBeLessThanOrEqual(60);
  });
});

describe("wrapText", () => {
  it("wraps to lines that each fit the width", async () => {
    const font = await helvetica();
    const note = "Per-outlet view: revenue + COGS + outlet-tagged costs only (contribution margin). Shared/HQ opex is paid from the entity account and cannot be split per outlet.";
    const lines = wrapText(note, font, 7, 200);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(font.widthOfTextAtSize(l, 7)).toBeLessThanOrEqual(200);
    expect(lines.join(" ")).toBe(note);
  });
});

describe("computeLayout", () => {
  it("keeps a readable account column for a single-column statement", () => {
    const l = computeLayout(595.28, 1, true);
    expect(l.labelW).toBeGreaterThan(300);
    expect(l.codeW + l.labelW + l.valW).toBeLessThanOrEqual(595.28 - 72 + 0.01);
  });

  it("fits the longest real COA code without truncating it", async () => {
    const font = await helvetica();
    for (const n of [1, 2, 3, 13]) {
      const l = computeLayout(n > 3 ? 841.89 : 595.28, n, true);
      // 8pt of padding is reserved inside the code column.
      expect(font.widthOfTextAtSize("BANK:MARKETPLACE_FEE", l.codeSize)).toBeLessThanOrEqual(l.codeW - 8);
    }
  });

  it("shrinks value columns rather than overflowing a 12-month landscape report", () => {
    const l = computeLayout(841.89, 13, true); // 12 months + Total
    expect(l.codeW + l.labelW + l.valW * 13).toBeLessThanOrEqual(841.89 - 72 + 0.01);
    expect(l.labelW).toBeGreaterThanOrEqual(60);
    expect(l.size).toBeLessThan(8);
  });

  it("drops the code column before letting the account name go unreadable", () => {
    const l = computeLayout(595.28, 10, true);
    expect(l.codeW).toBe(0);
    expect(l.labelW).toBeGreaterThanOrEqual(60);
  });
});

describe("buildStatementPdf", () => {
  it("renders a one-page PDF for a short statement", async () => {
    const bytes = await buildStatementPdf(baseDoc([
      { kind: "group", label: "Income" },
      { kind: "line", code: "REV-INSTORE", name: "In-store sales (dine-in + takeaway)", values: ["337,956.42"] },
      { kind: "line", code: "REV-DISCOUNT", name: "Discount given", values: ["(9,267.28)"] },
      { kind: "total", label: "Total Income", values: ["387,939.88"] },
      { kind: "total", label: "Net Income", values: ["54,901.04"], strong: true },
    ]));
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
    expect(parsed.getPage(0).getSize().width).toBeCloseTo(595.28, 1);
  });

  it("paginates long statements", async () => {
    const rows: StatementRow[] = [{ kind: "group", label: "Expenses" }];
    for (let i = 0; i < 200; i++) {
      rows.push({ kind: "line", code: `BANK:${i}`, name: `Expense line ${i}`, values: ["1,000.00"] });
    }
    const parsed = await PDFDocument.load(await buildStatementPdf(baseDoc(rows)));
    expect(parsed.getPageCount()).toBeGreaterThan(1);
  });

  it("goes landscape once there are more than three value columns", async () => {
    const columns = Array.from({ length: 6 }, (_, i) => ({ label: `M${i}` }));
    const parsed = await PDFDocument.load(await buildStatementPdf(baseDoc([
      { kind: "line", name: "Rent", values: ["1", "2", "3", "4", "5", "6"] },
    ], columns)));
    const { width, height } = parsed.getPage(0).getSize();
    expect(width).toBeGreaterThan(height);
  });

  it("does not throw on unrenderable glyphs anywhere in the document", async () => {
    const doc = baseDoc([
      { kind: "group", label: "Résumé ▲" },
      { kind: "subgroup", label: "People — 咖啡" },
      { kind: "line", code: "→", name: "Δ change", values: ["RM 1,000.00"] },
      { kind: "total", label: "Total →", values: ["Δ"] },
    ]);
    doc.notes = ["Range exceeds 12 months — showing the last 12 ✓"];
    doc.scopeNote = "2026-04-01 → 2026-06-30";
    doc.kpis = [{ label: "Net Profit", value: "RM 54,901.04" }];
    await expect(buildStatementPdf(doc)).resolves.toBeInstanceOf(Uint8Array);
  });

  it("tolerates a missing or corrupt logo instead of failing the export", async () => {
    await expect(buildStatementPdf(baseDoc([{ kind: "line", name: "Rent", values: ["1.00"] }]), null))
      .resolves.toBeInstanceOf(Uint8Array);
    await expect(buildStatementPdf(baseDoc([{ kind: "line", name: "Rent", values: ["1.00"] }]), new Uint8Array([1, 2, 3])))
      .resolves.toBeInstanceOf(Uint8Array);
  });
});
