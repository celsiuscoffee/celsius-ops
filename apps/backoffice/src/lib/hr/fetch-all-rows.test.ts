import { describe, it, expect } from "vitest";

// PostgREST caps an unbounded response at 1000 rows and tells you nothing:
// no error, no flag, just a short array. Every consumer that treated
// `data.length` as "all of them" was quietly wrong.
//
// Measured damage in July 2026:
//   * serving time — 7,626 served orders across the outlets, so the lever
//     scored everyone off roughly 1–4 July. Worth RM40–50 a head per month.
//   * phone capture target — 4,192–5,601 orders per outlet per 90 days, so the
//     baseline came from the oldest 1000. Tamarind read 35% against a true 44%.
//     Found only because a human thought the number looked wrong.
//
// This mirrors the shipped `fetchAllRows` paging loop.

const PAGE = 1000;

async function fetchAllRows<T>(
  build: () => { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }> },
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error || !data) break;
    out.push(...data);
    if (data.length < PAGE) break;
    if (out.length >= 100_000) break;
  }
  return out;
}

/** A fake table of `total` rows that honours .range() the way PostgREST does. */
const table = (total: number, opts: { errorAt?: number } = {}) => {
  let calls = 0;
  const builder = {
    range: (from: number, to: number) => {
      calls++;
      if (opts.errorAt && calls === opts.errorAt) {
        return Promise.resolve({ data: null, error: new Error("boom") });
      }
      const slice = Array.from(
        { length: Math.max(0, Math.min(to, total - 1) - from + 1) },
        (_, i) => ({ id: from + i }),
      );
      return Promise.resolve({ data: slice, error: null });
    },
  };
  return { build: () => builder, calls: () => calls };
};

describe("fetchAllRows", () => {
  it("returns everything past the 1000-row cap — the whole point", async () => {
    const t = table(7626); // July 2026's served-order count
    const rows = await fetchAllRows<{ id: number }>(t.build);
    expect(rows.length).toBe(7626);
    expect(rows[0].id).toBe(0);
    expect(rows[7625].id).toBe(7625);
  });

  it("stops on the first short page rather than probing forever", async () => {
    const t = table(1500);
    await fetchAllRows(t.build);
    expect(t.calls()).toBe(2); // 1000 + 500, then done
  });

  it("costs exactly one call when the result is small", async () => {
    const t = table(42);
    expect((await fetchAllRows(t.build)).length).toBe(42);
    expect(t.calls()).toBe(1);
  });

  it("handles an empty result", async () => {
    const t = table(0);
    expect(await fetchAllRows(t.build)).toEqual([]);
    expect(t.calls()).toBe(1);
  });

  it("needs a SECOND call when the total is exactly one page", async () => {
    // The subtle case: 1000 rows is indistinguishable from "1000 and more"
    // until an empty page proves otherwise. Stopping early here is precisely
    // the bug being fixed, so the extra round-trip is the correct cost.
    const t = table(1000);
    expect((await fetchAllRows(t.build)).length).toBe(1000);
    expect(t.calls()).toBe(2);
  });

  it("returns what it has if a page errors, rather than throwing mid-payroll", async () => {
    const t = table(5000, { errorAt: 3 });
    const rows = await fetchAllRows(t.build);
    expect(rows.length).toBe(2000); // two good pages, then it stopped
  });

  it("bails at 100k so a dropped filter cannot page forever inside a payroll run", async () => {
    const t = table(500_000);
    const rows = await fetchAllRows(t.build);
    expect(rows.length).toBe(100_000);
  });
});

describe("what truncation did to the numbers", () => {
  it("the old behaviour was a silent first-page read", async () => {
    // No error, no signal — just 1000 of 7,626, which is why nothing caught it.
    const t = table(7626);
    const { data } = await t.build().range(0, 999);
    expect(data!.length).toBe(1000);
    expect(1000 / 7626).toBeLessThan(0.14); // ~13% of the month
  });
});
