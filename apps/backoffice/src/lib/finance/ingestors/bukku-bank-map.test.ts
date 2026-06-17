import { describe, it, expect } from "vitest";
import { mapBukkuTxn, mapBukkuTransactions, type BukkuBankTxn } from "./bukku-bank-map";

// Shapes taken verbatim from the live Bukku spec examples.
const income: BukkuBankTxn = {
  id: 4,
  number: "OR-00001",
  number2: "89NI47N538990803C",
  date: "2025-05-26",
  amount: 5000,
  status: "ready",
  description: "Cash register closing",
  account_id: 2,
  deposit_items: [{ account_id: 2, account_code: "1000-00", account_name: "Cash on Hand" }],
};
const expense: BukkuBankTxn = {
  id: 5,
  number: "PV-00003",
  number2: "874Q398OERUA4389Q",
  date: "2025-05-26",
  amount: 250,
  status: "ready",
  description: "Cash out for cash register",
  account_id: 2,
  deposit_items: [{ account_id: 2, account_code: "1000-00", account_name: "Cash on Hand" }],
};

describe("mapBukkuTxn", () => {
  it("maps an income to a positive (inflow) bank line", () => {
    const l = mapBukkuTxn(income, "income")!;
    expect(l.amount).toBe(5000);
    expect(l.bankAccountCode).toBe("1000-00");
    expect(l.date).toBe("2025-05-26");
    expect(l.reference).toBe("OR-00001");
    expect(l.description).toBe("Cash register closing");
  });

  it("maps an expense to a negative (outflow) bank line", () => {
    const l = mapBukkuTxn(expense, "expense")!;
    expect(l.amount).toBe(-250);
    expect(l.bankAccountCode).toBe("1000-00");
    expect(l.reference).toBe("PV-00003");
  });

  it("skips voided / draft entries", () => {
    expect(mapBukkuTxn({ ...income, status: "void" }, "income")).toBeNull();
    expect(mapBukkuTxn({ ...income, status: "draft" }, "income")).toBeNull();
  });

  it("skips entries with no bank account or zero amount", () => {
    expect(mapBukkuTxn({ ...income, deposit_items: [] }, "income")).toBeNull();
    expect(mapBukkuTxn({ ...income, deposit_items: null }, "income")).toBeNull();
    expect(mapBukkuTxn({ ...income, amount: 0 }, "income")).toBeNull();
  });

  it("mapBukkuTransactions concatenates incomes (+) and expenses (−)", () => {
    const lines = mapBukkuTransactions([income], [expense]);
    expect(lines.map((l) => l.amount)).toEqual([5000, -250]);
  });
});
