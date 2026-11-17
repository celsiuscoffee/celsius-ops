import { describe, it, expect } from "vitest";
import { summariseReviews } from "./reviews-summary";

describe("summariseReviews", () => {
  it("counts unreplied reviews, complaints and connected outlets", () => {
    const s = summariseReviews(
      [{ rating: 5, reply: { comment: "Thanks" } }, { rating: 4 }, { rating: 2 }, { rating: 3, reply: { comment: "" } }],
      3,
      [{ google: { connected: true } }, { google: { connected: false } }],
    );
    expect(s.google).toEqual({ count: 4, unreplied: 3 });
    expect(s.complaints).toEqual({ count: 5, lowGoogle: 2, qr: 3 });
    expect(s.connected).toEqual({ count: 1, of: 2 });
  });

  it("is empty-safe", () => {
    expect(summariseReviews([], 0, [])).toEqual({ google: { count: 0, unreplied: 0 }, complaints: { count: 0, lowGoogle: 0, qr: 0 }, connected: { count: 0, of: 0 } });
  });
});
