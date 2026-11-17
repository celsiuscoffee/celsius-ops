import { describe, it, expect } from "vitest";
import { summariseOrders } from "./orders-summary";

const NOW = Date.parse("2026-11-17T04:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("summariseOrders", () => {
  it("counts sales only from orders that went through", () => {
    const s = summariseOrders([
      { status: "completed", total: 1490, created_at: ago(90) },
      { status: "ready", total: 990, created_at: ago(10) },
      { status: "pending", total: 5000, created_at: ago(2) },
      { status: "failed", total: 1200, created_at: ago(30) },
    ], NOW);
    expect(s.paid).toEqual({ count: 2, sales: 2480, average: 1240 });
    expect(s.failed).toEqual({ count: 1, of: 4 });
    expect(s.ready).toBe(1);
  });

  it("ages the orders customers are waiting for", () => {
    const s = summariseOrders([
      { status: "paid", total: 100, created_at: ago(3) },
      { status: "preparing", total: 100, created_at: ago(12.5) },
    ], NOW);
    expect(s.inProgress).toEqual({ count: 2, oldestMinutes: 12 });
  });

  it("is empty-safe", () => {
    const s = summariseOrders([], NOW);
    expect(s.paid.average).toBeNull();
    expect(s.inProgress.oldestMinutes).toBeNull();
  });
});
