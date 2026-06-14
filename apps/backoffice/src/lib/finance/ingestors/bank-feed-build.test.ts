import { describe, it, expect } from "vitest";
import { buildBankTxnRow, bankTxnKey, dedupeRows, type BankTxnRow } from "./bank-feed-build";

function ok(input: Parameters<typeof buildBankTxnRow>[0]): BankTxnRow {
  const r = buildBankTxnRow(input);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.row;
}

describe("buildBankTxnRow", () => {
  it("normalizes a valid line and defaults status to unmatched", () => {
    const row = ok({ bankAccountCode: "1000-01", date: "2026-06-10", amount: 123.456, description: " Card settle ", reference: "REF1" });
    expect(row.bank_account_code).toBe("1000-01");
    expect(row.amount).toBe(123.46); // rounded to 2dp
    expect(row.description).toBe("Card settle"); // trimmed
    expect(row.reference).toBe("REF1");
    expect(row.status).toBe("unmatched");
    expect(row.raw_line_id).toBeNull();
  });

  it("coerces an absent reference to '' so re-imports dedupe (PG NULLs are distinct)", () => {
    const row = ok({ bankAccountCode: "1000-01", date: "2026-06-10", amount: -50 });
    expect(row.reference).toBe("");
    expect(row.description).toBe("(no description)");
  });

  it("rejects a missing account code, bad date, and zero / non-finite amount", () => {
    expect(buildBankTxnRow({ bankAccountCode: "", date: "2026-06-10", amount: 10 }).ok).toBe(false);
    expect(buildBankTxnRow({ bankAccountCode: "1000-01", date: "10/06/2026", amount: 10 }).ok).toBe(false);
    expect(buildBankTxnRow({ bankAccountCode: "1000-01", date: "2026-06-10", amount: 0 }).ok).toBe(false);
    expect(buildBankTxnRow({ bankAccountCode: "1000-01", date: "2026-06-10", amount: NaN }).ok).toBe(false);
  });

  it("preserves the sign (inflow vs outflow)", () => {
    expect(ok({ bankAccountCode: "1000-01", date: "2026-06-10", amount: 100 }).amount).toBe(100);
    expect(ok({ bankAccountCode: "1000-01", date: "2026-06-10", amount: -100 }).amount).toBe(-100);
  });
});

describe("dedupeRows", () => {
  it("drops intra-batch duplicates on the composite key, first wins", () => {
    const a = ok({ bankAccountCode: "1000-01", date: "2026-06-10", amount: 100, description: "x", reference: "R" });
    const b = ok({ bankAccountCode: "1000-01", date: "2026-06-10", amount: 100, description: "x", reference: "R" });
    const c = ok({ bankAccountCode: "1000-01", date: "2026-06-10", amount: 100, description: "x", reference: "R2" });
    const out = dedupeRows([a, b, c]);
    expect(out).toHaveLength(2); // a (==b) + c
    expect(out[0].id).toBe(a.id);
  });

  it("treats two empty-reference lines that are otherwise identical as duplicates", () => {
    const a = ok({ bankAccountCode: "1000-01", date: "2026-06-10", amount: 100, description: "x" });
    const b = ok({ bankAccountCode: "1000-01", date: "2026-06-10", amount: 100, description: "x" });
    expect(bankTxnKey(a)).toBe(bankTxnKey(b));
    expect(dedupeRows([a, b])).toHaveLength(1);
  });
});
