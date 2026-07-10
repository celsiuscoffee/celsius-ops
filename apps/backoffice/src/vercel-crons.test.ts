import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Vercel schedules AT MOST 40 cron jobs per project — entries past the cap are
// silently never scheduled. This repo hit 46 on 2026-07-10 and the tail six
// (procurement-exec, par recalc, invoice/receiving chases, consumption,
// labour-variance) were dead for ~10 days with zero errors anywhere. This test
// is the ratchet that makes that impossible to repeat: if you need a new cron
// and the budget is spent, FOLD it into an existing dispatcher
// (procurement-loop / ops-nudges / bukku-feed-sync pattern) instead of
// appending an entry that will never run.
const VERCEL_CRON_CAP = 40;
// Keep headroom below the hard cap so the next few additions don't have to
// stop and consolidate first.
const BUDGET = 38;

describe("vercel.json crons", () => {
  const config = JSON.parse(readFileSync(resolve(__dirname, "../vercel.json"), "utf8")) as {
    crons?: { path: string; schedule: string }[];
  };
  const crons = config.crons ?? [];

  it(`stays within the cron budget (${BUDGET} < Vercel cap ${VERCEL_CRON_CAP})`, () => {
    expect(crons.length).toBeLessThanOrEqual(BUDGET);
  });

  it("has no duplicate cron paths", () => {
    const paths = crons.map((c) => c.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
