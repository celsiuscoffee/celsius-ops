import { describe, it, expect } from "vitest";
import {
  mapMoneyToLines,
  mapTransferToLines,
  mapRawFeedToLines,
  type BukkuMoneyTxn,
  type BukkuTransferTxn,
  type BukkuRawFeedLine,
} from "./bukku-bank";

// Fixtures are the exact example payloads from the Bukku Bank API spec
// (developers.bukku.my/specs/.../examples/{money_in,money_out,transfer}/list).

const MONEY_IN: BukkuMoneyTxn = {
  id: 4,
  number: "OR-00001",
  date: "2025-05-26",
  contact_name: "March Seventh",
  amount: 5000,
  currency_code: "MYR",
  status: "ready",
  account_id: 2,
  account_name: "Cash on Hand",
  description: "Cash register closing",
};

const MONEY_OUT: BukkuMoneyTxn = {
  id: 5,
  number: "PV-00003",
  date: "2025-05-26",
  contact_name: "March Seventh",
  amount: 250,
  currency_code: "MYR",
  status: "ready",
  account_id: 2,
  account_name: "Cash on Hand",
  description: "Cash out for cash register",
};

const TRANSFER: BukkuTransferTxn = {
  id: 6,
  number: "FT-00001",
  date: "2025-05-26",
  amount: 513,
  currency_code: "MYR",
  status: "ready",
  account_id: 3,
  account_name: "Bank Account",
  account2_id: 8,
  account2_name: "Credit Card Accounts",
  description: "Payment for May 1, 2025 Statement",
};

describe("mapMoneyToLines", () => {
  it("maps Money In to a single CR line on the bank account", () => {
    const [line] = mapMoneyToLines([MONEY_IN], "in");
    expect(line).toEqual({
      bukkuId: 4,
      bukkuAccountId: 2,
      accountName: "Cash on Hand",
      txnDate: "2025-05-26",
      description: "Cash register closing",
      reference: "OR-00001",
      amount: 5000,
      direction: "CR",
      isInterCo: false,
    });
  });

  it("maps Money Out to a single DR line", () => {
    const [line] = mapMoneyToLines([MONEY_OUT], "out");
    expect(line.direction).toBe("DR");
    expect(line.amount).toBe(250);
    expect(line.reference).toBe("PV-00003");
    expect(line.isInterCo).toBe(false);
  });

  it("falls back to contact name then number when description is null", () => {
    const [line] = mapMoneyToLines([{ ...MONEY_IN, description: null }], "in");
    expect(line.description).toBe("March Seventh");
    const [line2] = mapMoneyToLines([{ ...MONEY_IN, description: null, contact_name: null }], "in");
    expect(line2.description).toBe("OR-00001");
  });
});

describe("mapRawFeedToLines", () => {
  const FEED: BukkuRawFeedLine[] = [
    { id: 5393, date: "2026-06-27 22:32:31", description: "DUITNOW QR- ZAID FITRI* ", debit_amount: "0.00", credit_amount: "46.60" },
    { id: 5390, date: "2026-06-27 09:00:00", description: "PAYMENT TO SUPPLIER", debit_amount: "215.00", credit_amount: "0.00" },
    { id: 5388, date: "2026-06-26 10:00:00", description: "ZERO ROW", debit_amount: "0.00", credit_amount: "0.00" },
  ];

  it("maps credit→CR, debit→DR, trims desc, dates to YYYY-MM-DD, uses id as reference", () => {
    const lines = mapRawFeedToLines(FEED);
    expect(lines).toHaveLength(2); // zero-value row dropped
    expect(lines[0]).toEqual({
      bukkuId: 5393,
      bukkuAccountId: 0,
      accountName: null,
      txnDate: "2026-06-27",
      description: "DUITNOW QR- ZAID FITRI*",
      reference: "5393",
      amount: 46.6,
      direction: "CR",
      isInterCo: false,
    });
    expect(lines[1].direction).toBe("DR");
    expect(lines[1].amount).toBe(215);
  });
});

describe("mapTransferToLines", () => {
  it("splits a transfer into a DR on the source and a CR on the destination, both interCo", () => {
    const lines = mapTransferToLines([TRANSFER]);
    expect(lines).toHaveLength(2);

    const dr = lines.find((l) => l.direction === "DR")!;
    const cr = lines.find((l) => l.direction === "CR")!;

    expect(dr.bukkuAccountId).toBe(3);
    expect(cr.bukkuAccountId).toBe(8);
    expect(dr.amount).toBe(513);
    expect(cr.amount).toBe(513);
    expect(dr.isInterCo).toBe(true);
    expect(cr.isInterCo).toBe(true);
    expect(dr.reference).toBe("FT-00001");
    expect(cr.reference).toBe("FT-00001");
    // Both sides share the source transaction id (idempotency).
    expect(dr.bukkuId).toBe(6);
    expect(cr.bukkuId).toBe(6);
  });
});
