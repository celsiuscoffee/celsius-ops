import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/grab", () => ({
  batchUpdateMenu: vi.fn(),
  isGrabConfigured: vi.fn(() => true),
}));

import { batchUpdateMenu } from "@/lib/grab";
import {
  availabilityEntity,
  chunk,
  desiredAvailability,
  isGrabThrottleError,
  isGrabVisible,
  parseRetryAfterMs,
  pendingAvailabilityIds,
  pushAvailability,
} from "./grab-availability";

// The exact 409 body Grab returned when Mini Pavlova was 86'd at Shah Alam
// (2026-08-02 12:31:50Z) and the push was dropped.
const THROTTLE_409 =
  'Grab API PUT /partner/v1/batch/menu failed (409): {"target":"","reason":"conflict",' +
  '"message":"batchUpdate ITEM 68d92fd799cecc0007dafb92 too frequently, retry after 10 seconds"}';

describe("availabilityEntity", () => {
  it("sends maxStock:0 with UNAVAILABLE — Grab keeps selling without it", () => {
    expect(availabilityEntity("p1", false)).toEqual({
      id: "p1",
      availableStatus: "UNAVAILABLE",
      maxStock: 0,
    });
  });

  it("leaves maxStock unset when available (absent = in stock)", () => {
    expect(availabilityEntity("p1", true)).toEqual({ id: "p1", availableStatus: "AVAILABLE" });
  });
});

describe("isGrabThrottleError", () => {
  it("recognises the 409 throttle", () => {
    expect(isGrabThrottleError(new Error(THROTTLE_409))).toBe(true);
  });

  it("does not treat permanent failures as retryable", () => {
    expect(
      isGrabThrottleError(
        new Error('Grab API PUT /partner/v1/batch/menu failed (400): {"reason":"invalid_argument"}'),
      ),
    ).toBe(false);
    expect(isGrabThrottleError(new Error("Grab OAuth failed (401): nope"))).toBe(false);
    expect(isGrabThrottleError(undefined)).toBe(false);
  });
});

describe("parseRetryAfterMs", () => {
  it("honours Grab's advised wait", () => {
    expect(parseRetryAfterMs(new Error(THROTTLE_409))).toBe(10_000);
  });

  it("clamps an unreasonable wait to the cap", () => {
    expect(parseRetryAfterMs(new Error("retry after 600 seconds"), 2_000, 12_000)).toBe(12_000);
  });

  it("falls back when Grab didn't say", () => {
    expect(parseRetryAfterMs(new Error("conflict (409)"), 2_000)).toBe(2_000);
  });
});

describe("desiredAvailability", () => {
  it("is unavailable when 86'd at the outlet", () => {
    expect(desiredAvailability(true, true)).toBe(false);
  });

  it("is unavailable when globally off the catalogue", () => {
    expect(desiredAvailability(false, false)).toBe(false);
  });

  it("is available only when neither says otherwise", () => {
    expect(desiredAvailability(true, false)).toBe(true);
  });
});

describe("isGrabVisible", () => {
  it("ships products with no channel allow-list", () => {
    expect(isGrabVisible(undefined)).toBe(true);
    expect(isGrabVisible([])).toBe(true);
  });

  it("ships only products listing grab", () => {
    expect(isGrabVisible(["grab", "pickup"])).toBe(true);
    expect(isGrabVisible(["pickup"])).toBe(false);
  });
});

describe("pendingAvailabilityIds", () => {
  it("returns items Grab was never told about", () => {
    const desired = new Map([["a", false], ["b", true]]);
    expect(pendingAvailabilityIds(desired, undefined)).toEqual(["a", "b"]);
  });

  it("returns only items whose status changed", () => {
    const desired = new Map([["a", false], ["b", true], ["c", false]]);
    expect(pendingAvailabilityIds(desired, { a: true, b: true })).toEqual(["a", "c"]);
  });

  it("sends nothing in a steady state", () => {
    const desired = new Map([["a", false], ["b", true]]);
    expect(pendingAvailabilityIds(desired, { a: false, b: true })).toEqual([]);
  });
});

describe("chunk", () => {
  it("splits into fixed-size batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe("pushAvailability", () => {
  const mocked = vi.mocked(batchUpdateMenu);

  beforeEach(() => {
    mocked.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Run `p` while auto-advancing timers so the retry sleeps don't stall the test. */
  async function settle<T>(p: Promise<T>): Promise<T> {
    const done = p.then(
      (v) => ({ ok: true as const, v }),
      (e) => ({ ok: false as const, e }),
    );
    await vi.runAllTimersAsync();
    const r = await done;
    if (!r.ok) throw r.e;
    return r.v;
  }

  it("succeeds on the first attempt", async () => {
    mocked.mockResolvedValueOnce({});
    const result = await settle(pushAvailability("m1", [availabilityEntity("p1", false)]));
    expect(result).toMatchObject({ ok: true, attempts: 1 });
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("retries through the throttle and lands the 86 — the bug this fixes", async () => {
    mocked
      .mockRejectedValueOnce(new Error(THROTTLE_409))
      .mockRejectedValueOnce(new Error(THROTTLE_409))
      .mockResolvedValueOnce({});
    const result = await settle(pushAvailability("m1", [availabilityEntity("p1", false)]));
    expect(result).toMatchObject({ ok: true, attempts: 3 });
    expect(mocked).toHaveBeenCalledTimes(3);
  });

  it("gives up after maxAttempts and flags it throttled for the reconciler", async () => {
    mocked.mockRejectedValue(new Error(THROTTLE_409));
    const result = await settle(pushAvailability("m1", [availabilityEntity("p1", false)]));
    expect(result.ok).toBe(false);
    expect(result.throttled).toBe(true);
    expect(mocked).toHaveBeenCalledTimes(3);
  });

  it("does not retry a permanent failure", async () => {
    mocked.mockRejectedValue(new Error("Grab API PUT /partner/v1/batch/menu failed (400): bad"));
    const result = await settle(pushAvailability("m1", [availabilityEntity("p1", false)]));
    expect(result.ok).toBe(false);
    expect(result.throttled).toBe(false);
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("sends one call for a whole batch instead of one per item", async () => {
    mocked.mockResolvedValueOnce({});
    const entities = ["a", "b", "c"].map((id) => availabilityEntity(id, false));
    await settle(pushAvailability("m1", entities));
    expect(mocked).toHaveBeenCalledWith("m1", "ITEM", entities);
  });
});
