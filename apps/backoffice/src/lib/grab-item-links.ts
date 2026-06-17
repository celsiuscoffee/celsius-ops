/**
 * Pure formatting helpers for the GrabFood item-link panel. Kept free of
 * `@/`-aliased / React imports so they're unit-testable in isolation.
 */

/**
 * Render a Grab order line's observed price for the link panel. Orders for the
 * same Grab item can arrive at different prices (promos / size variants), so we
 * show a single value when they agree and a range when they don't.
 */
export function formatGrabItemPrice(
  minRm: number | null,
  maxRm: number | null,
): string {
  if (minRm == null && maxRm == null) return "—";
  const lo = minRm ?? maxRm!;
  const hi = maxRm ?? minRm!;
  const fmt = (n: number) => `RM ${n.toFixed(2)}`;
  return lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
}
