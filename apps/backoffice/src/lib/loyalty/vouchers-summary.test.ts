import { describe, it, expect } from "vitest";
import { summariseVouchers, type VoucherRow } from "./vouchers-summary";

const NOW = Date.parse("2026-11-17T04:00:00Z");
const at = (d: number) => new Date(NOW + d * 86_400_000).toISOString();
const v = (status: string, issued: number, expires: number | null, redeemed: number | null = null, source = "mission"): VoucherRow =>
  ({ status, source_type: source, issued_at: at(issued), expires_at: expires == null ? null : at(expires), redeemed_at: redeemed == null ? null : at(redeemed) });

describe("summariseVouchers", () => {
  it("counts active vouchers and those expiring within a week", () => {
    const s = summariseVouchers([v("active", -2, 3), v("active", -2, 20), v("active", -2, null), v("active", -40, -1)], NOW);
    expect(s.active).toEqual({ count: 3, expiringSoon: 1 });
  });

  it("measures how many vouchers issued in 30 days were used", () => {
    const s = summariseVouchers([v("used", -5, 10, -2), v("active", -3, 10), v("active", -1, 10), v("used", -60, -30, -50)], NOW);
    expect(s.issued30).toEqual({ count: 3, used: 1, share: 1 / 3 });
  });

  it("counts vouchers that expired unused in the last 30 days and the top source", () => {
    const s = summariseVouchers([
      v("expired", -40, -5, null, "birthday"), v("active", -40, -2, null, "birthday"),
      v("used", -40, -3, -10, "birthday"), v("expired", -90, -60),
      v("active", -1, 9, null, "referral"), v("active", -2, 9, null, "referral"), v("active", -2, 9, null, "mission"),
    ], NOW);
    expect(s.wasted30).toBe(2);
    expect(s.topSource).toEqual({ source: "referral", count: 2 });
  });

  it("is empty-safe", () => {
    const s = summariseVouchers([], NOW);
    expect(s.issued30.share).toBeNull();
    expect(s.topSource).toBeNull();
  });
});
