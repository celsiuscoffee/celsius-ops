import { beforeEach, describe, expect, it, vi } from "vitest";

// Chainable, thenable fake of the finance client. Records every write and
// lets the test decide whether the atomic claim UPDATE hits a row.
type Op = { table: string; op: string; payload?: unknown; filters: [string, string, unknown][] };
const ops: Op[] = [];
let excRow: Record<string, unknown> | null = null;
let claimWins = true;

function builder(table: string, op: string, payload?: unknown) {
  const rec: Op = { table, op, payload, filters: [] };
  ops.push(rec);
  const b: Record<string, unknown> = {};
  const chain = (name: string) => (col: string, val: unknown) => { rec.filters.push([name, col, val]); return b; };
  b.eq = chain("eq"); b.is = chain("is"); b.neq = chain("neq");
  b.select = () => b;
  b.single = () => Promise.resolve({ data: op === "select" && table === "fin_exceptions" ? excRow : null, error: null });
  b.maybeSingle = b.single;
  b.then = (res: (v: unknown) => void) => {
    const isClaim = op === "update" && table === "fin_exceptions" && rec.filters.some(([n, c]) => n === "is" && c === "resolved_by");
    res({ data: isClaim ? (claimWins ? [{ id: excRow?.id }] : []) : null, error: null });
  };
  return b;
}
function fakeClient() {
  return {
    from(table: string) {
      return {
        select: () => builder(table, "select"),
        update: (p: unknown) => builder(table, "update", p),
        insert: (p: unknown) => builder(table, "insert", p),
      };
    },
  };
}

vi.mock("./supabase", () => ({ getFinanceClient: () => fakeClient() }));
vi.mock("./ledger", () => ({ postJournal: vi.fn() }));
vi.mock("@celsius/agents/src/messages", () => ({ logAgentMessage: vi.fn() }));

import { resolveException } from "./inbox";

const updates = () => ops.filter((o) => o.op === "update" && o.table === "fin_exceptions");
const claims = () => updates().filter((o) => o.filters.some(([n, c]) => n === "is" && c === "resolved_by"));

beforeEach(() => {
  ops.length = 0;
  claimWins = true;
  excRow = { id: "exc-1", company_id: "co", type: "match", related_type: "bank_txn", related_id: "b1", agent: "bank", reason: "r", proposed_action: null, status: "open" };
});

describe("resolveException claim", () => {
  it("claims the exception atomically before resolving it", async () => {
    const r = await resolveException("exc-1", "user-1", { kind: "dismiss", reason: "dup" });
    expect(r).toEqual({ kind: "dismissed" });
    const [claim] = claims();
    expect(claim.payload).toMatchObject({ resolved_by: "user-1" });
    expect(claim.filters).toEqual(expect.arrayContaining([["eq", "status", "open"], ["is", "resolved_by", null]]));
    // The dismiss write follows the claim, and nothing released it.
    expect(updates().some((o) => (o.payload as { status?: string })?.status === "dismissed")).toBe(true);
    expect(updates().some((o) => (o.payload as { resolved_by?: unknown })?.resolved_by === null)).toBe(false);
  });

  it("returns a noop, and writes nothing else, when another request holds the claim", async () => {
    claimWins = false;
    const r = await resolveException("exc-1", "user-1", { kind: "dismiss", reason: "dup" });
    expect(r.kind).toBe("noop");
    expect(updates()).toHaveLength(1); // the failed claim only
  });

  it("releases the claim when the resolver has nothing to do", async () => {
    const r = await resolveException("exc-1", "user-1", { kind: "approve" }); // bank/match: no resolver yet
    expect(r.kind).toBe("noop");
    const release = updates().at(-1)!;
    expect(release.payload).toEqual({ resolved_by: null, resolved_at: null });
    expect(release.filters).toEqual(expect.arrayContaining([["eq", "id", "exc-1"], ["eq", "status", "open"]]));
  });

  it("does not claim an exception that is no longer open", async () => {
    excRow = { ...excRow!, status: "resolved" };
    const r = await resolveException("exc-1", "user-1", { kind: "approve" });
    expect(r).toEqual({ kind: "noop", reason: "Exception already resolved" });
    expect(claims()).toHaveLength(0);
  });
});
