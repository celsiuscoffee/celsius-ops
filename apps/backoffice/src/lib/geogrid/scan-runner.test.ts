import { describe, it, expect } from "vitest";
import { producedData, interleaveByOutlet, isDue, atGoal, SCAN_STATUS_FAILED } from "./scan-runner";
import { PlacesApiError, isRetryablePlacesError } from "./places";

// Regression cover for the 2026-08-15 loop QA finding: the monthly scan cap was
// charged for scans that returned nothing, so half the GBP budget bought no rank
// data and the outlets behind the queue were never reached at all.

describe("producedData", () => {
  it("does not charge the budget for a wholly-failed scan", () => {
    expect(producedData(SCAN_STATUS_FAILED)).toBe(false);
  });

  it("charges for complete and partial scans — a partial still carries rank", () => {
    expect(producedData("complete")).toBe(true);
    expect(producedData("partial")).toBe(true);
  });
});

describe("interleaveByOutlet", () => {
  it("gives every outlet a turn before any outlet takes a second", () => {
    const due = [
      { outletId: "sa", keyword: "cafe" },
      { outletId: "sa", keyword: "coffee" },
      { outletId: "sa", keyword: "brunch" },
      { outletId: "ioi", keyword: "cafe" },
      { outletId: "tam", keyword: "cafe" },
    ];
    expect(interleaveByOutlet(due).map((d) => `${d.outletId}:${d.keyword}`)).toEqual([
      "sa:cafe",
      "ioi:cafe",
      "tam:cafe",
      "sa:coffee",
      "sa:brunch",
    ]);
  });

  it("keeps each outlet's warmest-first order intact", () => {
    const due = [
      { outletId: "a", keyword: "worst" },
      { outletId: "a", keyword: "middle" },
      { outletId: "a", keyword: "best" },
    ];
    expect(interleaveByOutlet(due).map((d) => d.keyword)).toEqual(["worst", "middle", "best"]);
  });

  it("loses nothing and invents nothing", () => {
    const due = [
      { outletId: "a", keyword: "1" },
      { outletId: "b", keyword: "2" },
      { outletId: "a", keyword: "3" },
      { outletId: "c", keyword: "4" },
    ];
    expect(interleaveByOutlet(due)).toHaveLength(4);
    expect(new Set(interleaveByOutlet(due))).toEqual(new Set(due));
  });

  it("handles an empty queue", () => {
    expect(interleaveByOutlet([])).toEqual([]);
  });
});

// The Aug 3 and Jul 6 runs failed 20 scans each because the cron fires thousands
// of Places calls back to back, trips the rate limit, and nothing retried. The
// tell was that scans recovered mid-run and then failed again — a broken outlet
// would never recover.
describe("isRetryablePlacesError", () => {
  it("retries a rate-limit", () => {
    expect(isRetryablePlacesError(new PlacesApiError("429 rate limited", 429))).toBe(true);
  });

  it("retries Google's own 5xx", () => {
    expect(isRetryablePlacesError(new PlacesApiError("boom", 500))).toBe(true);
    expect(isRetryablePlacesError(new PlacesApiError("boom", 503))).toBe(true);
  });

  it("retries a network error that never got a status", () => {
    expect(isRetryablePlacesError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryablePlacesError(new PlacesApiError("no status", null))).toBe(true);
  });

  it("does NOT retry a bad key, a denial or a bad request", () => {
    expect(isRetryablePlacesError(new PlacesApiError("bad request", 400))).toBe(false);
    expect(isRetryablePlacesError(new PlacesApiError("bad key", 401))).toBe(false);
    expect(isRetryablePlacesError(new PlacesApiError("denied", 403))).toBe(false);
    expect(isRetryablePlacesError(new PlacesApiError("not found", 404))).toBe(false);
  });
});

describe("isDue cadence", () => {
  const now = new Date("2026-08-15T00:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000);

  it("treats a never-scanned combo as due", () => {
    expect(isDue(null, now)).toBe(true);
  });

  it("re-checks a working combo weekly", () => {
    const working = { pctTop3: 20, avgRank: 8 };
    expect(atGoal({ ...working, createdAt: daysAgo(6) })).toBe(false);
    expect(isDue({ ...working, createdAt: daysAgo(6) }, now)).toBe(false);
    expect(isDue({ ...working, createdAt: daysAgo(7) }, now)).toBe(true);
  });

  it("re-checks an at-goal combo monthly, not weekly", () => {
    const won = { pctTop3: 85, avgRank: 2 };
    expect(atGoal({ ...won, createdAt: daysAgo(10) })).toBe(true);
    expect(isDue({ ...won, createdAt: daysAgo(10) }, now)).toBe(false);
    expect(isDue({ ...won, createdAt: daysAgo(28) }, now)).toBe(true);
  });
});
