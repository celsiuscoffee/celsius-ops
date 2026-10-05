import { beforeEach, describe, expect, it, vi } from "vitest";

type Op = { table: string; op: string; payload?: unknown; filters: [string, string, unknown][] };
const ops: Op[] = [];
let alreadyReversedByOther = false;

function builder(table: string, op: string, payload?: unknown) {
  const rec: Op = { table, op, payload, filters: [] };
  ops.push(rec);
  const b: Record<string, unknown> = {};
  const chain = (name: string) => (col: string, val: unknown) => { rec.filters.push([name, col, val]); return b; };
  b.eq = chain("eq"); b.neq = chain("neq");
  b.select = () => b;
  b.single = () => Promise.resolve({
    data: table === "fin_transactions"
      ? { id: "orig", company_id: "co", txn_date: "2026-09-01", description: "d", outlet_id: null, source_doc_id: null, txn_type: "journal", status: "posted" }
      : null,
    error: null,
  });
  b.then = (res: (v: unknown) => void) => {
    if (op === "select" && table === "fin_journal_lines") {
      return res({ data: [{ account_code: "1100", outlet_id: null, debit: 10, credit: 0, memo: null }, { account_code: "4000", outlet_id: null, debit: 0, credit: 10, memo: null }], error: null });
    }
    const isFlip = op === "update" && table === "fin_transactions" && rec.filters.some(([n]) => n === "neq");
    if (isFlip) return res({ data: alreadyReversedByOther ? [] : [{ id: "orig" }], error: null });
    res({ data: null, error: null });
  };
  return b;
}
vi.mock("./supabase", () => ({
  getFinanceClient: () => ({
    from(table: string) {
      return {
        select: () => builder(table, "select"),
        update: (p: unknown) => builder(table, "update", p),
        insert: (p: unknown) => builder(table, "insert", p),
        delete: () => builder(table, "delete"),
      };
    },
  }),
}));

import { reverseTransaction } from "./ledger";

beforeEach(() => { ops.length = 0; alreadyReversedByOther = false; });

describe("reverseTransaction", () => {
  it("posts the offset and flips the original only while it is not yet reversed", async () => {
    const r = await reverseTransaction("orig", { reason: "test", agent: "manual", agentVersion: "t" });
    expect(r.status).toBe("posted");
    const flip = ops.find((o) => o.op === "update" && o.table === "fin_transactions" && o.filters.some(([n]) => n === "neq"))!;
    expect(flip.payload).toMatchObject({ status: "reversed", reversed_by_id: r.transactionId, posting_key: null });
    expect(flip.filters).toEqual(expect.arrayContaining([["eq", "id", "orig"], ["neq", "status", "reversed"]]));
    expect(ops.some((o) => o.op === "delete")).toBe(false);
  });

  it("removes its own offset journal and throws when a concurrent call won the flip", async () => {
    alreadyReversedByOther = true;
    await expect(reverseTransaction("orig", { reason: "test", agent: "manual", agentVersion: "t" })).rejects.toThrow(/already reversed/);
    const dels = ops.filter((o) => o.op === "delete").map((o) => o.table);
    expect(dels).toEqual(["fin_journal_lines", "fin_transactions"]);
  });
});
