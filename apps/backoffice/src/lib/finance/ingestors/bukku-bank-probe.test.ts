import { describe, it, expect, vi, afterEach } from "vitest";
import { probeBukkuOutlet } from "./bukku-bank-probe";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}
function errorResponse(status: number, body: string): Response {
  return { ok: false, status, json: async () => ({}), text: async () => body } as Response;
}

const income = {
  id: 4, number: "OR-00001", number2: "X", date: "2025-05-26", amount: 5000, status: "ready",
  description: "Cash register closing", account_id: 2,
  deposit_items: [{ account_id: 2, account_code: "1000-00", account_name: "Cash on Hand" }],
};

afterEach(() => vi.unstubAllGlobals());

describe("probeBukkuOutlet", () => {
  it("reports ok with counts + a mapped sample on 200", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ transactions: [income], paging: { current_page: 1, per_page: 5, total: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ transactions: [], paging: { current_page: 1, per_page: 5, total: 0 } }));
    vi.stubGlobal("fetch", fetchMock);

    const p = await probeBukkuOutlet({ outlet: "Shah Alam", token: "t", from: "2025-05-01", to: "2025-05-31" });
    expect(p.ok).toBe(true);
    expect(p.incomeCount).toBe(1);
    expect(p.expenseCount).toBe(0);
    expect(p.sample?.[0]).toMatchObject({ amount: 5000, bankAccountCode: "1000-00" });
    // First call must carry the Bearer token.
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer t");
  });

  it("surfaces a 403 (stale/unauthorised token) as ok:false with the status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(403, '{"message":"User is not authorised to access the company."}')));
    const p = await probeBukkuOutlet({ outlet: "Shah Alam", token: "stale", from: "2025-05-01", to: "2025-05-31" });
    expect(p.ok).toBe(false);
    expect(p.status).toBe(403);
    expect(p.error).toContain("not authorised");
  });

  it("catches network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const p = await probeBukkuOutlet({ outlet: "Shah Alam", token: "t", from: "2025-05-01", to: "2025-05-31" });
    expect(p.ok).toBe(false);
    expect(p.error).toContain("ECONNREFUSED");
  });
});
