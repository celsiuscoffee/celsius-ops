import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildGrid, scanGrid } from "./places";

// scanGrid must survive transient Places API errors (retry per point) and a
// quota outage must surface as failures, not hang — regression cover for the
// 2026-07-06 incident where mid-run quota exhaustion produced 20 fully-failed
// scans that burned the monthly budget.

function placesResponse(names: string[]) {
  return {
    ok: true,
    text: async () => "",
    json: async () => ({
      places: names.map((n, i) => ({ id: `place-${i}`, displayName: { text: n } })),
    }),
  } as Response;
}

const errorResponse = (status: number) =>
  ({ ok: false, status, text: async () => "RESOURCE_EXHAUSTED" } as unknown as Response);

describe("scanGrid", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("retries a transiently failing point and records its rank", async () => {
    const points = buildGrid(3.1, 101.6, 2, 1.5); // 4 points
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      // First request fails once, then everything succeeds.
      if (calls === 1) return errorResponse(429);
      return placesResponse(["Celsius Coffee", "Rival Cafe"]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = scanGrid("key", "cafe", points, 2500, null, "Celsius Coffee", 4);
    await vi.runAllTimersAsync();
    const { failures, points: scanned } = await promise;

    expect(failures).toBe(0);
    expect(scanned.every((p) => p.rank === 1)).toBe(true);
    // 4 points + 1 retry
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("counts a point as failed only after retries are exhausted", async () => {
    const points = buildGrid(3.1, 101.6, 2, 1.5);
    vi.stubGlobal("fetch", vi.fn(async () => errorResponse(429)));

    const promise = scanGrid("key", "cafe", points, 2500, null, "Celsius Coffee", 4);
    await vi.runAllTimersAsync();
    const { failures, points: scanned } = await promise;

    expect(failures).toBe(4);
    expect(scanned.every((p) => p.rank === null)).toBe(true);
  });

  it("tallies competitors that out-rank us", async () => {
    const points = buildGrid(3.1, 101.6, 2, 1.5);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => placesResponse(["Rival One", "Rival Two", "Celsius Coffee"])),
    );

    const promise = scanGrid("key", "cafe", points, 2500, null, "Celsius Coffee", 4);
    await vi.runAllTimersAsync();
    const { competitors, points: scanned } = await promise;

    expect(scanned.every((p) => p.rank === 3)).toBe(true);
    expect(competitors[0]?.name).toBe("Rival One");
    expect(competitors[0]?.top3Points).toBe(4);
  });
});
