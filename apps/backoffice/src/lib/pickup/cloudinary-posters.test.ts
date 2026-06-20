import { describe, it, expect } from "vitest";
import {
  partitionOrphans,
  selectDeletableOrphans,
  referencesLookSafe,
  type PosterAsset,
} from "./cloudinary-posters";

const asset = (publicId: string, extra: Partial<PosterAsset> = {}): PosterAsset => ({
  publicId,
  bytes: 1000,
  createdAt: null,
  ...extra,
});

describe("partitionOrphans", () => {
  it("treats an asset as referenced when its public_id appears in any URL", () => {
    const assets = [
      asset("celsius-coffee/posters/aaa"),
      asset("celsius-coffee/posters/bbb"),
    ];
    const refs = [
      "https://res.cloudinary.com/x/image/upload/v123/celsius-coffee/posters/aaa.jpg",
    ];
    const { referenced, orphans } = partitionOrphans(assets, refs);
    expect(referenced.map((a) => a.publicId)).toEqual(["celsius-coffee/posters/aaa"]);
    expect(orphans.map((a) => a.publicId)).toEqual(["celsius-coffee/posters/bbb"]);
  });

  it("matches despite transformations and cache-bust query strings", () => {
    const assets = [asset("celsius-coffee/posters/ccc")];
    const refs = [
      "https://res.cloudinary.com/x/image/upload/q_auto,f_auto/v9/celsius-coffee/posters/ccc.webp?b=171717",
    ];
    expect(partitionOrphans(assets, refs).orphans).toHaveLength(0);
  });

  it("counts an asset referenced only via composer_state.bgUrl / original_bg_url", () => {
    // loadReferencedUrls flattens all three fields into the URL list; here
    // we just prove a non-image_url reference still protects the asset.
    const assets = [asset("celsius-coffee/posters/ddd")];
    const refs = ["https://res.cloudinary.com/x/image/upload/celsius-coffee/posters/ddd"];
    expect(partitionOrphans(assets, refs).orphans).toHaveLength(0);
  });

  it("flags assets referenced by nothing", () => {
    const assets = [asset("celsius-coffee/posters/eee")];
    expect(partitionOrphans(assets, []).orphans).toHaveLength(1);
  });
});

describe("selectDeletableOrphans", () => {
  const now = Date.parse("2026-06-20T00:00:00Z");
  const graceMs = 7 * 86_400_000;

  it("keeps (does not delete) orphans inside the grace window", () => {
    const fresh = asset("celsius-coffee/posters/new", {
      createdAt: "2026-06-19T00:00:00Z", // 1 day old
    });
    expect(selectDeletableOrphans([fresh], graceMs, now)).toHaveLength(0);
  });

  it("deletes orphans older than the grace window", () => {
    const old = asset("celsius-coffee/posters/old", {
      createdAt: "2026-06-01T00:00:00Z", // ~19 days old
    });
    expect(selectDeletableOrphans([old], graceMs, now)).toHaveLength(1);
  });

  it("never deletes an orphan with unknown or unparseable age", () => {
    const noDate = asset("celsius-coffee/posters/x", { createdAt: null });
    const badDate = asset("celsius-coffee/posters/y", { createdAt: "not-a-date" });
    expect(selectDeletableOrphans([noDate, badDate], graceMs, now)).toHaveLength(0);
  });
});

describe("referencesLookSafe", () => {
  it("flags the catastrophic case: assets exist but zero references loaded", () => {
    expect(referencesLookSafe(42, 0)).toBe(false);
  });

  it("allows a normal run with references present", () => {
    expect(referencesLookSafe(42, 10)).toBe(true);
  });

  it("allows an empty Cloudinary (nothing to delete anyway)", () => {
    expect(referencesLookSafe(0, 0)).toBe(true);
  });
});
