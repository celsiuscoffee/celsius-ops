import { describe, it, expect } from "vitest";
import {
  aggregateInternalEod,
  type PosOrderRow,
  type PosPaymentRow,
  type AppOrderRow,
} from "./internal-eod-aggregate";

// Helpers to keep the fixtures terse. All amounts in SEN.
function pos(id: string, total: number, sst: number, opts: Partial<PosOrderRow> = {}): PosOrderRow {
  return { id, status: "completed", refund_of_order_id: null, sst_amount: sst, total, created_at: "2026-06-12T03:00:00Z", ...opts };
}
function pay(orderId: string, method: string, amount: number, refund = 0): PosPaymentRow {
  return { order_id: orderId, payment_method: method, amount, refund_amount: refund };
}
function app(id: string, total: number, sst: number, method: string, status = "completed"): AppOrderRow {
  return { id, status, payment_method: method, subtotal: total - sst, sst_amount: sst, total, created_at: "2026-06-12T03:00:00Z" };
}

const base = { companyId: "co1", outletId: "outlet-uuid", outletName: "Shah Alam", date: "2026-06-12", sourceDocId: "doc1" };

describe("aggregateInternalEod", () => {
  it("nets SST, converts sen→RM, splits by tender, counts txns", () => {
    const s = aggregateInternalEod({
      ...base,
      posOrders: [pos("A", 1060, 60), pos("B", 2120, 120)],
      posPayments: [pay("A", "cash", 1060), pay("B", "card", 2120)],
      appOrders: [app("D", 530, 30, "card")],
    });

    expect(s.transactions).toBe(3);
    expect(s.sst).toBe(2.1); // (60+120+30)/100
    expect(s.netSales).toBe(35); // (1000+2000+500)/100
    expect(s.channels.cashQr).toBe(10); // order A net
    expect(s.channels.card).toBe(25); // B (20) + D (5)
    expect(s.channels.other).toBe(0);
    expect(s.storehubRefIds.sort()).toEqual(["A", "B", "D"]);
  });

  it("excludes refunds and voided POS orders", () => {
    const s = aggregateInternalEod({
      ...base,
      posOrders: [
        pos("A", 1060, 60),
        pos("R", 1060, 60, { refund_of_order_id: "A" }), // refund row
        pos("V", 500, 0, { status: "voided" }),
      ],
      posPayments: [pay("A", "cash", 1060), pay("R", "cash", -1060)],
      appOrders: [],
    });
    expect(s.transactions).toBe(1);
    expect(s.netSales).toBe(10);
    expect(s.channels.cashQr).toBe(10);
  });

  it("splits a single order across mixed tenders proportionally", () => {
    // RM20 net + RM1.20 SST = RM21.20 total, paid half cash half card.
    const s = aggregateInternalEod({
      ...base,
      posOrders: [pos("M", 2120, 120)],
      posPayments: [pay("M", "cash", 1060), pay("M", "card", 1060)],
      appOrders: [],
    });
    expect(s.netSales).toBe(20);
    expect(s.channels.cashQr).toBe(10);
    expect(s.channels.card).toBe(10);
  });

  it("buckets DuitNow/TnG/e-wallet to cashQr and unknown to other", () => {
    const s = aggregateInternalEod({
      ...base,
      posOrders: [pos("Q", 1000, 0), pos("T", 1000, 0), pos("U", 1000, 0)],
      posPayments: [pay("Q", "duitnow_qr", 1000), pay("T", "tng", 1000), pay("U", "crypto", 1000)],
      appOrders: [],
    });
    expect(s.channels.cashQr).toBe(20); // duitnow + tng
    expect(s.channels.other).toBe(10); // unknown method surfaces as exception
  });

  it("falls back to cashQr when a completed POS sale has no payment rows", () => {
    const s = aggregateInternalEod({
      ...base,
      posOrders: [pos("N", 800, 0)],
      posPayments: [],
      appOrders: [],
    });
    expect(s.channels.cashQr).toBe(8);
    expect(s.transactions).toBe(1);
  });

  it("ignores app orders that are not yet sales (pending/failed)", () => {
    const s = aggregateInternalEod({
      ...base,
      posOrders: [],
      posPayments: [],
      appOrders: [app("P", 1000, 0, "card", "pending"), app("F", 1000, 0, "card", "failed"), app("G", 1000, 0, "card", "paid")],
    });
    expect(s.transactions).toBe(1);
    expect(s.netSales).toBe(10);
  });
});
