import { describe, it, expect } from "vitest";
import {
  evaluateInvoiceTiming,
  isOpenInvoiceStatus,
  localDayKey,
  OPEN_INVOICE_STATUSES,
  dueDateIsBelievable,
} from "../invoice-timing";

// "Now" for the whole suite: 2026-08-10 11:00 UTC = 19:00 MYT, the day the
// Collective ageing was reported as haywire.
const NOW = "2026-08-10T11:00:00Z";

describe("localDayKey", () => {
  it("reads the Malaysian calendar day, not the UTC one", () => {
    // 17:00 UTC on the 5th is already the 6th in Kuala Lumpur (UTC+8).
    expect(localDayKey("2026-08-05T17:00:00Z")).toBe("2026-08-06");
    expect(localDayKey("2026-08-05T10:00:00Z")).toBe("2026-08-05");
  });

  it("returns null rather than guessing on unreadable input", () => {
    expect(localDayKey(null)).toBeNull();
    expect(localDayKey("not-a-date")).toBeNull();
  });
});

describe("isOpenInvoiceStatus", () => {
  it("treats DRAFT and PAID as closed", () => {
    // A DRAFT is an AI capture nobody has verified — never chase it.
    expect(isOpenInvoiceStatus("DRAFT")).toBe(false);
    expect(isOpenInvoiceStatus("PAID")).toBe(false);
    for (const s of OPEN_INVOICE_STATUSES) expect(isOpenInvoiceStatus(s)).toBe(true);
  });
});

describe("evaluateInvoiceTiming — the stuck OVERDUE latch", () => {
  it("clears OVERDUE once the due date is corrected forward (IV-02158)", () => {
    // Pre-created 27 Jul with a placeholder date, stamped OVERDUE, then
    // corrected to a real 19 Aug balance date. It must not stay overdue — and
    // because its deposit was already paid, it lands in DEPOSIT_PAID rather
    // than PENDING (see the next test for why that distinction is money).
    const r = evaluateInvoiceTiming({
      status: "OVERDUE",
      issueDate: "2026-08-05",
      dueDate: "2026-08-19",
      depositAmount: 328,
      depositPaidAt: "2026-08-07",
      now: NOW,
    });
    expect(r.balanceOverdue).toBe(false);
    expect(r.storedStatusShouldBe).toBe("DEPOSIT_PAID");
  });

  it("restores DEPOSIT_PAID, not PENDING, when the deposit is already settled", () => {
    // The back office picks its action buttons from status alone: `case
    // "PENDING"` renders "Initiate Deposit" without checking depositPaidAt.
    // Clearing OVERDUE to PENDING on a deposit-paid invoice therefore offers to
    // pay the deposit a second time. IV-02158 (RM328 paid 7 Aug) hit this.
    const r = evaluateInvoiceTiming({
      status: "OVERDUE",
      issueDate: "2026-08-05",
      dueDate: "2026-08-19",
      depositAmount: 328,
      depositPaidAt: "2026-08-07",
      amountPaid: 328,
      now: NOW,
    });
    expect(r.storedStatusShouldBe).toBe("DEPOSIT_PAID");
  });

  it("restores DEPOSIT_PAID on amountPaid alone, with no deposit timestamp", () => {
    const r = evaluateInvoiceTiming({
      status: "OVERDUE", issueDate: "2026-08-05", dueDate: "2026-08-19",
      depositPaidAt: null, amountPaid: 150, now: NOW,
    });
    expect(r.storedStatusShouldBe).toBe("DEPOSIT_PAID");
  });

  it("restores PENDING when nothing has been paid", () => {
    const r = evaluateInvoiceTiming({
      status: "OVERDUE", issueDate: "2026-08-05", dueDate: "2026-08-19",
      depositAmount: 328, depositPaidAt: null, amountPaid: 0, now: NOW,
    });
    expect(r.storedStatusShouldBe).toBe("PENDING");
  });

  it("still marks a genuinely late PENDING invoice OVERDUE", () => {
    const r = evaluateInvoiceTiming({
      status: "PENDING",
      issueDate: "2026-07-22",
      dueDate: "2026-08-05",
      now: NOW,
    });
    expect(r.balanceOverdue).toBe(true);
    expect(r.daysPastDue).toBe(5);
    expect(r.storedStatusShouldBe).toBe("OVERDUE");
  });

  it("leaves a still-current OVERDUE alone rather than flapping it", () => {
    const r = evaluateInvoiceTiming({
      status: "OVERDUE",
      issueDate: "2026-07-01",
      dueDate: "2026-07-15",
      now: NOW,
    });
    expect(r.balanceOverdue).toBe(true);
    expect(r.storedStatusShouldBe).toBeNull(); // already correct
  });

  it("never rewrites the status of a settled invoice", () => {
    const r = evaluateInvoiceTiming({
      status: "PAID",
      issueDate: "2026-07-01",
      dueDate: "2026-07-15",
      now: NOW,
    });
    expect(r.storedStatusShouldBe).toBeNull();
    expect(r.balanceOverdue).toBe(false);
  });
});

describe("evaluateInvoiceTiming — placeholder due dates", () => {
  it("refuses to chase a due date that pre-dates the invoice", () => {
    // 30 invoices carry one of these. Marking them overdue is what produced
    // the wrong stamps in the first place.
    const r = evaluateInvoiceTiming({
      status: "PENDING",
      issueDate: "2026-08-05",
      dueDate: "2026-07-27",
      now: NOW,
    });
    expect(r.dueDateInvalid).toBe(true);
    expect(r.balanceOverdue).toBe(false);
    expect(r.storedStatusShouldBe).toBeNull();
  });

  it("accepts due == issue (COD invoices legitimately do that)", () => {
    const r = evaluateInvoiceTiming({
      status: "PENDING",
      issueDate: "2026-08-01",
      dueDate: "2026-08-01",
      now: NOW,
    });
    expect(r.dueDateInvalid).toBe(false);
    expect(r.balanceOverdue).toBe(true);
  });

  it("never chases an invoice with no due date at all", () => {
    // 83 open invoices have none; they must stay quiet, not become overdue.
    const r = evaluateInvoiceTiming({ status: "PENDING", issueDate: "2026-01-01", dueDate: null, now: NOW });
    expect(r.balanceOverdue).toBe(false);
    expect(r.storedStatusShouldBe).toBeNull();
  });
});

describe("evaluateInvoiceTiming — the deposit clock", () => {
  it("flags a deposit unpaid after the issue date (IV-02160)", () => {
    const r = evaluateInvoiceTiming({
      status: "INITIATED",
      issueDate: "2026-08-05",
      dueDate: "2026-08-19",
      depositAmount: 235.8,
      depositPaidAt: null,
      now: NOW,
    });
    expect(r.depositOverdue).toBe(true);
    expect(r.depositDaysPastDue).toBe(5);
    // The deposit being late must NOT rewrite the stored status — INITIATED
    // means a payment is in flight and that fact has to survive.
    expect(r.storedStatusShouldBe).toBeNull();
  });

  it("does not flag a deposit on its issue day — it is due, not late", () => {
    const r = evaluateInvoiceTiming({
      status: "PENDING",
      issueDate: "2026-08-10",
      depositAmount: 100,
      depositPaidAt: null,
      now: NOW,
    });
    expect(r.depositOverdue).toBe(false);
  });

  it("does not flag a paid deposit, or an invoice with no deposit", () => {
    const paid = evaluateInvoiceTiming({
      status: "DEPOSIT_PAID", issueDate: "2026-07-01",
      depositAmount: 100, depositPaidAt: "2026-07-02", now: NOW,
    });
    expect(paid.depositOverdue).toBe(false);
    const none = evaluateInvoiceTiming({
      status: "PENDING", issueDate: "2026-07-01", depositAmount: 0, now: NOW,
    });
    expect(none.depositOverdue).toBe(false);
  });

  it("surfaces a late balance on INITIATED and DEPOSIT_PAID without restatusing them", () => {
    // IV-02135: 5 days past due, deposit paid, previously invisible because
    // the sweep only ever looked at PENDING.
    for (const status of ["INITIATED", "DEPOSIT_PAID", "PARTIALLY_PAID"] as const) {
      const r = evaluateInvoiceTiming({
        status, issueDate: "2026-07-22", dueDate: "2026-08-05",
        depositAmount: 328, depositPaidAt: "2026-07-22", now: NOW,
      });
      expect(r.balanceOverdue).toBe(true);
      expect(r.daysPastDue).toBe(5);
      expect(r.storedStatusShouldBe).toBeNull();
    }
  });
});

describe("dueDateIsBelievable", () => {
  it("rejects a due date that pre-dates the invoice", () => {
    // The capture model reads each field alone, so it can return a delivery
    // date, a statement date, or the previous invoice in the same photo.
    expect(dueDateIsBelievable("2026-08-05", "2026-07-27")).toBe(false);
  });

  it("accepts due == issue (COD) and any later date", () => {
    expect(dueDateIsBelievable("2026-08-05", "2026-08-05")).toBe(true);
    expect(dueDateIsBelievable("2026-08-05", "2026-08-19")).toBe(true);
  });

  it("accepts when either date is missing or unreadable — rejects only the impossible", () => {
    expect(dueDateIsBelievable(null, "2026-08-19")).toBe(true);
    expect(dueDateIsBelievable("2026-08-05", null)).toBe(true);
    expect(dueDateIsBelievable("rubbish", "2026-08-19")).toBe(true);
  });
});
