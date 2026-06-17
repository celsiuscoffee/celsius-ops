import { describe, it, expect } from "vitest";
import { buildClearingLines, type ClearingParams } from "./clearing";
import type { JournalLineInput } from "../types";

function balance(lines: JournalLineInput[]): { debit: number; credit: number } {
  return {
    debit: Math.round(lines.reduce((s, l) => s + (l.debit ?? 0), 0) * 100) / 100,
    credit: Math.round(lines.reduce((s, l) => s + (l.credit ?? 0), 0) * 100) / 100,
  };
}
function base(over: Partial<ClearingParams>): ClearingParams {
  return { matchedToType: "invoice", bankAccountCode: "1000-01", amountMatched: 0, outletId: "o1", ...over };
}

describe("buildClearingLines", () => {
  it("AR card: DR bank, CR card debtor (net) + CR SST debtor (sst)", () => {
    const lines = buildClearingLines(base({ amountMatched: 424, channel: "card", subtotal: 400, total: 424 }))!;
    expect(balance(lines)).toEqual({ debit: 424, credit: 424 });
    const dr = lines.find((l) => l.debit);
    expect(dr?.accountCode).toBe("1000-01");
    expect(lines.find((l) => l.accountCode === "1006")?.credit).toBe(400);
    expect(lines.find((l) => l.accountCode === "1000-02")?.credit).toBe(24);
  });

  it("AR cash_qr: net + SST collapse to one credit on 1000-02", () => {
    const lines = buildClearingLines(base({ amountMatched: 636, channel: "cash_qr", subtotal: 600, total: 636 }))!;
    expect(lines).toHaveLength(2); // DR bank, CR 1000-02
    expect(lines.find((l) => l.accountCode === "1000-02")?.credit).toBe(636);
    expect(balance(lines)).toEqual({ debit: 636, credit: 636 });
  });

  it("AR partial: splits net/SST proportionally and stays balanced", () => {
    const lines = buildClearingLines(base({ amountMatched: 212, channel: "card", subtotal: 400, total: 424 }))!;
    expect(lines.find((l) => l.accountCode === "1006")?.credit).toBe(200);
    expect(lines.find((l) => l.accountCode === "1000-02")?.credit).toBe(12);
    expect(balance(lines)).toEqual({ debit: 212, credit: 212 });
  });

  it("AP bill: DR payable 3001 / CR bank, gross (no SST split)", () => {
    const lines = buildClearingLines(base({ matchedToType: "bill", amountMatched: 500 }))!;
    expect(lines.find((l) => l.debit)?.accountCode).toBe("3001");
    expect(lines.find((l) => l.credit)?.accountCode).toBe("1000-01");
    expect(balance(lines)).toEqual({ debit: 500, credit: 500 });
  });

  it("returns null for transaction targets and zero amounts", () => {
    expect(buildClearingLines(base({ matchedToType: "transaction", amountMatched: 100 }))).toBeNull();
    expect(buildClearingLines(base({ amountMatched: 0, channel: "card", subtotal: 0, total: 0 }))).toBeNull();
  });

  it("falls back to the cash debtor for an unknown channel", () => {
    const lines = buildClearingLines(base({ amountMatched: 100, channel: "weird", subtotal: 100, total: 100 }))!;
    expect(lines.find((l) => l.credit)?.accountCode).toBe("1000-02");
    expect(balance(lines)).toEqual({ debit: 100, credit: 100 });
  });
});
