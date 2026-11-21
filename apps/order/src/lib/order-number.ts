// Customer order numbers (orders.order_number, UNIQUE).
//
// History: /api/orders (native pickup app) used C-<random 0000-9998>. With
// ~2,000 of those 9,999 values already taken by Oct 2026, roughly one app
// order in five hit the UNIQUE constraint and failed with "Failed to create
// order" — no row, no retry, nothing in the sales data. /api/checkout/initiate
// (table QR) already used the wider time-based format below.
//
// Both routes now share one generator and retry with a fresh number when the
// insert collides, so a duplicate can never fail a customer's order.

/** C- + 4 base36 chars of the clock + 2 random digits, e.g. "C-7FAC15". */
export function generateOrderNumber(): string {
  const clock = Date.now().toString(36).slice(-4).toUpperCase();
  const rand = Math.floor(Math.random() * 100).toString().padStart(2, "0");
  return `C-${clock}${rand}`;
}

type PgError = { code?: string; message?: string; details?: string | null } | null;

/** True when an insert failed only because order_number was already taken. */
export function isOrderNumberClash(err: PgError): boolean {
  if (!err || err.code !== "23505") return false;
  const text = `${err.message ?? ""} ${err.details ?? ""}`;
  return /order_number/i.test(text);
}

/**
 * Runs `insert` with a fresh order number until it does not clash, up to
 * `attempts` tries. Any other error, or a clash on the last try, is returned
 * unchanged for the caller to handle.
 */
export async function insertWithUniqueOrderNumber<T>(
  insert: (orderNumber: string) => PromiseLike<{ data: T | null; error: PgError }>,
  attempts = 5,
): Promise<{ data: T | null; error: PgError; orderNumber: string }> {
  let orderNumber = generateOrderNumber();
  let result = await insert(orderNumber);
  for (let i = 1; i < attempts && isOrderNumberClash(result.error); i += 1) {
    console.warn(`[order-number] ${orderNumber} already taken; retrying (${i}/${attempts - 1})`);
    orderNumber = generateOrderNumber();
    result = await insert(orderNumber);
  }
  return { ...result, orderNumber };
}
