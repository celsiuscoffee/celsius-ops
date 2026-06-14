import { describe, it, expect } from "vitest";
import { buildChannelInvoices, type ChannelInvoiceRow } from "./ar-invoices";
import type { EodSummary } from "./ar";

function summary(over: Partial<EodSummary> = {}): EodSummary {
  return {
    companyId: "co1",
    outletId: "outlet-uuid",
    outletName: "Shah Alam",
    date: "2026-06-12",
    transactions: 10,
    netSales: 1000,
    sst: 60,
    discounts: 0,
    channels: { cashQr: 600, card: 400, voucher: 0, grabfood: 0, gastrohub: 0, other: 0 },
    sourceDocId: "doc1",
    storehubRefIds: [],
    ...over,
  };
}

function byChannel(rows: ChannelInvoiceRow[]): Record<string, ChannelInvoiceRow> {
  return Object.fromEntries(rows.map((r) => [r.channel, r]));
}

describe("buildChannelInvoices", () => {
  it("emits one invoice per non-zero channel, SST allocated by net share", () => {
    const rows = buildChannelInvoices(summary(), "txn1");
    expect(rows.map((r) => r.channel).sort()).toEqual(["card", "cash_qr"]);
    const m = byChannel(rows);

    // cash_qr: net 600 → SST 60 * 600/1000 = 36 → total 636
    expect(m.cash_qr.subtotal).toBe(600);
    expect(m.cash_qr.sst_amount).toBe(36);
    expect(m.cash_qr.total).toBe(636);

    // card: net 400 → SST 24 → total 424
    expect(m.card.subtotal).toBe(400);
    expect(m.card.sst_amount).toBe(24);
    expect(m.card.total).toBe(424);

    // invoice totals sum to gross banked = net + sst
    expect(rows.reduce((s, r) => s + r.total, 0)).toBe(1060);
  });

  it("tags each invoice unpaid, links the transaction, and uses a deterministic number", () => {
    const rows = buildChannelInvoices(summary(), "txn1");
    const card = byChannel(rows).card;
    expect(card.payment_status).toBe("unpaid");
    expect(card.paid_amount).toBe(0);
    expect(card.transaction_id).toBe("txn1");
    expect(card.invoice_number).toBe("AR-outlet-uuid-2026-06-12-card");
    expect(card.company_id).toBe("co1");
    expect(card.invoice_date).toBe("2026-06-12");
  });

  it("skips zero-amount channels", () => {
    const rows = buildChannelInvoices(
      summary({ channels: { cashQr: 1000, card: 0, voucher: 0, grabfood: 0, gastrohub: 0, other: 0 }, netSales: 1000, sst: 60 }),
      "txn1"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe("cash_qr");
  });

  it("handles zero SST without dividing by zero net", () => {
    const rows = buildChannelInvoices(
      summary({ channels: { cashQr: 0, card: 0, voucher: 0, grabfood: 0, gastrohub: 0, other: 0 }, netSales: 0, sst: 0 }),
      "txn1"
    );
    expect(rows).toHaveLength(0);
  });

  it("maps delivery/gastrohub channels to their enum codes", () => {
    const rows = buildChannelInvoices(
      summary({ channels: { cashQr: 0, card: 0, voucher: 50, grabfood: 100, gastrohub: 200, other: 10 }, netSales: 360, sst: 0 }),
      "txn1"
    );
    expect(rows.map((r) => r.channel).sort()).toEqual(["gastrohub", "grabfood", "other", "voucher"]);
  });
});
