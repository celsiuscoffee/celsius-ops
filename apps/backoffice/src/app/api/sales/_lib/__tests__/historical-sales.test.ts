import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The boundary between the hand-digitised pre-import history
// (historical_daily_sales) and the hubbo till archive is 2025-01-01 MYT, and it
// is stated in THREE places: a CHECK constraint on the table, the unified_sales
// VIEW's branch, and HISTORICAL_UNTIL in unified-sales.ts. If any one of them
// drifts, 2024 revenue either vanishes from the dashboard or — far worse —
// starts double-counting against hubbo. These tests pin all three together.

const REPO = path.resolve(__dirname, "../../../../../../../..");
const MIGRATION = path.join(
  REPO,
  "packages/db/prisma/migrations/20260730_historical_daily_sales/migration.sql",
);
const UNIFIED = path.join(
  REPO,
  "apps/backoffice/src/app/api/sales/_lib/unified-sales.ts",
);

const migration = readFileSync(MIGRATION, "utf8");
const unified = readFileSync(UNIFIED, "utf8");

describe("historical sales backfill", () => {
  it("guards the pre-2025 bound in the CHECK constraint", () => {
    expect(migration).toMatch(
      /CONSTRAINT historical_daily_sales_pre_2025\s+CHECK \(biz_date < DATE '2025-01-01'\)/,
    );
  });

  it("repeats the same bound in the unified_sales view branch", () => {
    const branch = migration.slice(migration.indexOf("'historical'::text AS source"));
    expect(branch).toContain("FROM historical_daily_sales hd");
    expect(branch).toMatch(/WHERE hd\.biz_date < DATE '2025-01-01'/);
  });

  it("uses the equivalent UTC instant in the query path", () => {
    // 2025-01-01 00:00 MYT === 2024-12-31 16:00 UTC. A mismatch here would shift
    // the handover by 8 hours and overlap hubbo's first day.
    const match = unified.match(/const HISTORICAL_UNTIL = new Date\("([^"]+)"\)/);
    expect(match).not.toBeNull();
    const until = new Date(match![1]);
    const mytMidnight = new Date("2025-01-01T00:00:00+08:00");
    expect(until.toISOString()).toBe(mytMidnight.toISOString());
  });

  it("filters on that bound in SQL as well as in the date-range check", () => {
    const branch = unified.slice(unified.indexOf("// ── Historical —"));
    expect(branch).toContain("FROM historical_daily_sales");
    expect(branch).toContain("AND biz_date < ${HISTORICAL_UNTIL}");
    expect(branch).toContain("from.getTime() < HISTORICAL_UNTIL.getTime()");
  });

  it("never loads a non-trading day as zero", () => {
    // Blank days and explicit 0-against-0-orders days are both omitted, so a
    // shut shop cannot drag the daily averages down.
    const rows = migration.match(/^ {2}\('hist-[^\n]+$/gm) ?? [];
    expect(rows.length).toBe(722);
    const zeroRows = rows.filter((r) => /, 0\.00, /.test(r));
    expect(zeroRows).toEqual([]);
    // The fleet-wide Raya closure has no rows at all.
    for (const day of ["2024-04-09", "2024-04-10", "2024-04-11"]) {
      expect(rows.some((r) => r.includes(day))).toBe(false);
    }
  });

  it("reconciles to the source sheet's own annual totals", () => {
    const rows = migration.match(/^ {2}\('hist-[^\n]+$/gm) ?? [];
    const sum = (key: string) =>
      rows
        .filter((r) => r.startsWith(`  ('hist-${key}-`))
        .reduce((acc, r) => {
          const m = r.match(/, (\d+\.\d{2}), 'sheet:/);
          expect(m).not.toBeNull();
          return acc + Math.round(Number(m![1]) * 100);
        }, 0);

    // "Celsius - Sales Tracking 2024" Overall row, read at full stored precision.
    expect(sum("conezion")).toBe(Math.round(828906.52 * 100));
    expect(sum("shahalam")).toBe(Math.round(774642.52 * 100));
  });

  it("covers only the two cafés that traded in 2024", () => {
    const outletIds = new Set(
      (migration.match(/^ {2}\('hist-[^\n]+$/gm) ?? []).map(
        (r) => r.match(/, '([0-9a-f-]{36})', DATE/)![1],
      ),
    );
    expect(outletIds).toEqual(
      new Set([
        "89b19c9f-b1e0-42fe-a404-6d1a472e34c5", // Putrajaya (Conezion)
        "b3b6299e-09dc-4f4a-80ef-bbc04316d324", // Shah Alam
      ]),
    );
    // Tamarind opened Aug 2025 — it must not appear at all.
    expect(migration).not.toContain("5d1f2731-1985-4e54-a6df-3990e7d5c159', DATE");
  });
});
