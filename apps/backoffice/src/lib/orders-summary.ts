// Sales › Orders key numbers (restructure step 6, 17 Nov 2026), worked out from
// the orders the page already loads (the current filter). Pure, so it is tested
// without the page. Money is in sen, as the orders table stores it.

export type OrderLite = { status: string; total: number; created_at: string };

export type OrdersSummary = {
  /** orders that went through (not pending, not failed) */
  paid: { count: number; sales: number; average: number | null };
  /** paid or preparing: a customer is waiting for these */
  inProgress: { count: number; oldestMinutes: number | null };
  /** ready but not yet collected */
  ready: number;
  /** payment failed */
  failed: { count: number; of: number };
};

const NOT_SALES = new Set(["pending", "failed"]);

export function summariseOrders(rows: OrderLite[], now: number): OrdersSummary {
  const paid = rows.filter((o) => !NOT_SALES.has(o.status));
  const sales = paid.reduce((a, o) => a + o.total, 0);
  const waiting = rows.filter((o) => o.status === "paid" || o.status === "preparing");
  const ages = waiting.map((o) => (now - Date.parse(o.created_at)) / 60_000);
  return {
    paid: { count: paid.length, sales, average: paid.length ? sales / paid.length : null },
    inProgress: { count: waiting.length, oldestMinutes: ages.length ? Math.floor(Math.max(...ages)) : null },
    ready: rows.filter((o) => o.status === "ready").length,
    failed: { count: rows.filter((o) => o.status === "failed").length, of: rows.length },
  };
}
