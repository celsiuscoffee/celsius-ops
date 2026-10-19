/**
 * Which recent same-table, same-amount order means a second charge would
 * take money twice.
 *
 * Dependency-free and separate from route.ts on purpose: the root vitest
 * config maps `@/` to apps/backoffice/src, so a test that reaches route.ts
 * cannot load in the repo-wide run.
 *
 * Money is at risk when the twin is already settled, OR when it is still
 * pending on a live gateway checkout — the debit can land at the bank
 * seconds in while the gateway still reports nothing (C-7272: charged at
 * +4s, RM said EXPIRED at +51s). A failed or abandoned twin that never
 * reached a checkout never took money, so it must NOT block a real order.
 */
export type TwinRow = {
  id: string;
  order_number: string;
  status: string;
  created_at: string;
  payment_checkout_id: string | null;
};

const SETTLED = ["paid", "preparing", "ready", "collected", "completed"];

export function pickDuplicateTwin(rows: TwinRow[] | null | undefined): TwinRow | null {
  for (const row of rows ?? []) {
    if (SETTLED.includes(row.status)) return row;
    if (row.status === "pending" && row.payment_checkout_id != null) return row;
  }
  return null;
}
