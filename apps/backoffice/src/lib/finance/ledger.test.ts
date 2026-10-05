import { beforeEach, describe, expect, it, vi } from "vitest";

// Scripted fake of the finance Supabase client: records every write so the
// test can assert what postJournal leaves behind when the DB trigger rejects
// the draft → posted flip.
type Call = { table: string; op: "insert" | "update" | "delete"; eq?: [string, unknown]; payload?: unknown };
const calls: Call[] = [];
let failFlip = false;

function fakeClient() {
  return {
    from(table: string) {
      return {
        insert(payload: unknown) {
          calls.push({ table, op: "insert", payload });
          return Promise.resolve({ error: null });
        },
        update(payload: unknown) {
          const c: Call = { table, op: "update", payload };
          calls.push(c);
          return {
            eq(col: string, val: unknown) {
              c.eq = [col, val];
              const rejected = failFlip && table === "fin_transactions" && (payload as { status?: string })?.status === "posted";
              return Promise.resolve({ error: rejected ? { message: "Cannot post transaction to closed period 2026-08" } : null });
            },
          };
        },
        delete() {
          const c: Call = { table, op: "delete" };
          calls.push(c);
          return {
            eq(col: string, val: unknown) {
              c.eq = [col, val];
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

vi.mock("./supabase", () => ({ getFinanceClient: () => fakeClient() }));

import { postJournal } from "./ledger";

const input = {
  companyId: "co-1",
  txnDate: "2026-08-31",
  description: "EOD Sales — test",
  txnType: "ar_invoice" as const,
  agent: "ar" as const,
  agentVersion: "ar-v1",
  confidence: 0.95,
  postingKey: "11111111-1111-4111-8111-111111111111",
  lines: [
    { accountCode: "1100", debit: 100 },
    { accountCode: "4000", credit: 100 },
  ],
};

beforeEach(() => {
  calls.length = 0;
  failFlip = false;
});

describe("postJournal", () => {
  it("inserts header + lines then flips to posted", async () => {
    const r = await postJournal(input);
    expect(r.status).toBe("posted");
    expect(calls.map((c) => `${c.op}:${c.table}`)).toEqual([
      "insert:fin_transactions",
      "insert:fin_journal_lines",
      "update:fin_transactions",
    ]);
    expect(calls.some((c) => c.op === "delete")).toBe(false);
  });

  it("removes the draft (lines, then header) when the trigger rejects the flip", async () => {
    // Security review 2026-09-25 H13: a stranded draft carried the posting_key
    // and satisfied every "already posted" guard forever.
    failFlip = true;
    await expect(postJournal(input)).rejects.toMatchObject({ message: expect.stringContaining("closed period") });
    const deletes = calls.filter((c) => c.op === "delete");
    expect(deletes.map((c) => c.table)).toEqual(["fin_journal_lines", "fin_transactions"]);
    const txnId = (calls[0].payload as { id: string }).id;
    expect(deletes[0].eq).toEqual(["transaction_id", txnId]);
    expect(deletes[1].eq).toEqual(["id", txnId]);
  });

  it("leaves a requested draft as a draft and never flips it", async () => {
    const r = await postJournal({ ...input, draft: true });
    expect(r.status).toBe("draft");
    expect(calls.filter((c) => c.op === "update")).toHaveLength(0);
  });
});
