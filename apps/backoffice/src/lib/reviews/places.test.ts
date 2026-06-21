import { describe, it, expect } from "vitest";
import { computeRanking, type NearbyCafe } from "./places";

function cafe(partial: Partial<NearbyCafe> & { placeId: string }): NearbyCafe {
  return {
    name: partial.placeId,
    rating: null,
    reviewCount: 0,
    distanceM: 0,
    lat: 0,
    lng: 0,
    ...partial,
  };
}

// A nearby set where "Celsius" sits in the middle of the pack.
const SET: NearbyCafe[] = [
  cafe({ placeId: "rivalA", name: "ZUS Coffee", rating: 4.6, reviewCount: 800, distanceM: 300 }),
  cafe({ placeId: "self", name: "Celsius Coffee Putrajaya", rating: 4.8, reviewCount: 420, distanceM: 5 }),
  cafe({ placeId: "rivalB", name: "Random Kopitiam", rating: 4.1, reviewCount: 500, distanceM: 700 }),
  cafe({ placeId: "rivalC", name: "Tiny Cafe", rating: 4.9, reviewCount: 60, distanceM: 1200 }),
];

describe("computeRanking", () => {
  it("matches self by stored place id and ranks by review volume", () => {
    const r = computeRanking(SET, { selfPlaceId: "self" });
    expect(r.selfFound).toBe(true);
    expect(r.totalNearby).toBe(4);
    // 420 reviews: only ZUS(800) and Kopitiam(500) beat it → rank 3.
    expect(r.rankByReviews).toBe(3);
    // 4.8 rating: only Tiny Cafe(4.9) beats it → rank 2.
    expect(r.rankByRating).toBe(2);
    // Competitors exclude self, sorted by review volume desc.
    expect(r.competitors.map((c) => c.placeId)).toEqual(["rivalA", "rivalB", "rivalC"]);
  });

  it("falls back to name hint when no place id is stored", () => {
    const r = computeRanking(SET, { selfNameHint: "Celsius Coffee Putrajaya" });
    expect(r.selfFound).toBe(true);
    expect(r.selfReviewCount).toBe(420);
    expect(r.rankByReviews).toBe(3);
  });

  it("falls back to the café sitting on our coordinates (<=60m)", () => {
    const r = computeRanking(SET, {}); // no id, no hint
    expect(r.selfFound).toBe(true);
    expect(r.selfPlaceId).toBe("self"); // distance 5m wins
  });

  it("reports selfFound=false but still returns rivals when we're not in the set", () => {
    const noSelf = SET.filter((c) => c.placeId !== "self").map((c) => ({ ...c, distanceM: c.distanceM + 500 }));
    const r = computeRanking(noSelf, { selfPlaceId: "self", selfNameHint: "Celsius" });
    expect(r.selfFound).toBe(false);
    expect(r.rankByReviews).toBeNull();
    expect(r.totalNearby).toBe(3);
    expect(r.competitors).toHaveLength(3);
  });

  it("ties and a null self rating are handled without crashing", () => {
    const tie = [
      cafe({ placeId: "self", name: "Celsius", rating: null, reviewCount: 100, distanceM: 5 }),
      cafe({ placeId: "x", name: "Other", rating: 4.5, reviewCount: 100, distanceM: 50 }),
    ];
    const r = computeRanking(tie, { selfPlaceId: "self" });
    // Equal review counts → nobody strictly beats us → rank 1.
    expect(r.rankByReviews).toBe(1);
    // Null self rating → rating rank is not computed.
    expect(r.rankByRating).toBeNull();
  });
});
