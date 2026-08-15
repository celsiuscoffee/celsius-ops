/**
 * Read EVERY row a filter matches, not the first 1000.
 *
 * PostgREST caps an unbounded response at 1000 rows and says nothing about it —
 * you get a short array, no error, no flag. Two places this bit payroll before
 * it was caught, and one place it was about to:
 *
 *   * serving-time lever — 7,626 served orders in July 2026, so scores came
 *     from roughly the first four days of the month (RM40–50 a head).
 *   * phone-capture target — per-outlet baselines read the oldest 1000 of
 *     4,192–5,601 orders; Tamarind showed 35% against a true 44%.
 *   * the MONTHLY PAYROLL attendance fetch — July returned 761 of the 1000
 *     cap. One busier month and the last shifts of the month silently drop
 *     out of pay for whoever sorts last, with no error anywhere.
 *
 * Pass a builder that applies the filters; this walks it in pages until a
 * short page proves the end. A silently-truncated payroll input is worse than
 * a slow one.
 */
const PAGE = 1000;

export async function fetchAllRows<T>(
  build: () => {
    order: (
      column: string,
      opts?: { ascending?: boolean },
    ) => { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }> };
  },
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    // Postgres gives NO stable row order without ORDER BY, so separate .range()
    // pages could overlap or skip rows at the boundaries — reintroducing the
    // exact silent-truncation class this helper kills, as silent duplication or
    // omission past 1000 rows. `id` is unique on every hr_* table, so ordering
    // by it (as a tiebreak after any ordering the builder already applied)
    // makes pagination deterministic.
    const { data, error } = await build().order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error || !data) break;
    out.push(...data);
    if (data.length < PAGE) break;
    // Runaway guard: 100k rows is far past any real month and means a filter
    // was dropped. Better to stop than to page forever inside a payroll run.
    if (out.length >= 100_000) break;
  }
  return out;
}
