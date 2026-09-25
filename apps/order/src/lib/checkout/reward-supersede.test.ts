import { describe, expect, it, vi } from "vitest";
import { supersedePendingRewardOrders } from "./reward-supersede";

function fakeSupabase(rows: { id: string }[]) {
  const calls: { update?: unknown; eq: [string, unknown][] } = { eq: [] };
  const builder = {
    update: vi.fn((v: unknown) => { calls.update = v; return builder; }),
    eq: vi.fn((c: string, v: unknown) => { calls.eq.push([c, v]); return builder; }),
    select: vi.fn(async () => ({ data: rows, error: null })),
  };
  const supabase = { from: vi.fn(() => builder) };
  return { supabase: supabase as never, calls };
}

describe("supersedePendingRewardOrders", () => {
  it("fails older pending orders holding the same wallet voucher", async () => {
    const { supabase, calls } = fakeSupabase([{ id: "o1" }, { id: "o2" }]);
    const n = await supersedePendingRewardOrders(supabase, { walletVoucherId: "wv1", rewardId: "r1", memberId: "m1" });
    expect(n).toBe(2);
    expect(calls.update).toEqual({ status: "failed" });
    expect(calls.eq).toEqual([["status", "pending"], ["wallet_voucher_id", "wv1"]]);
  });
  it("scopes catalog rewards to the member", async () => {
    const { supabase, calls } = fakeSupabase([]);
    await supersedePendingRewardOrders(supabase, { walletVoucherId: null, rewardId: "r1", memberId: "m1" });
    expect(calls.eq).toEqual([["status", "pending"], ["reward_id", "r1"], ["loyalty_id", "m1"]]);
  });
  it("does nothing without a reward or without a member for a catalog reward", async () => {
    const { supabase, calls } = fakeSupabase([]);
    expect(await supersedePendingRewardOrders(supabase, { walletVoucherId: null, rewardId: null, memberId: "m1" })).toBe(0);
    expect(await supersedePendingRewardOrders(supabase, { walletVoucherId: null, rewardId: "r1", memberId: null })).toBe(0);
    expect(calls.update).toBeUndefined();
  });
});
