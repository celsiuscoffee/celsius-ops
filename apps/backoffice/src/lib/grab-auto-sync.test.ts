import { describe, it, expect } from "vitest";
import { buildGrabRecordEntities, type GrabMenuItemLike } from "./grab-record-entities";

const item = (over: Partial<GrabMenuItemLike> = {}): GrabMenuItemLike => ({
  id: "68ad6eab59357c00074fe000",
  price: 1590,
  availableStatus: "AVAILABLE",
  ...over,
});

describe("buildGrabRecordEntities", () => {
  it("targets Grab's own item id when the product is linked (self-serve store)", () => {
    const gid = new Map([["68ad6eab59357c00074fe000", "MYITE2026011703270414937"]]);
    const [entity] = buildGrabRecordEntities([item()], gid);
    expect(entity.id).toBe("MYITE2026011703270414937");
    expect(entity.price).toBe(1590);
    expect(entity.availableStatus).toBe("AVAILABLE");
  });

  it("falls back to our product id when there's no link (pushed-menu store)", () => {
    const [entity] = buildGrabRecordEntities([item()], new Map());
    expect(entity.id).toBe("68ad6eab59357c00074fe000");
  });

  it("carries maxStock for an out-of-stock item (Grab requires it with UNAVAILABLE)", () => {
    const gid = new Map([["68ad6eab59357c00074fe000", "MYITE202"]]);
    const [entity] = buildGrabRecordEntities(
      [item({ availableStatus: "UNAVAILABLE", maxStock: 0 })],
      gid,
    );
    expect(entity).toEqual({ id: "MYITE202", price: 1590, availableStatus: "UNAVAILABLE", maxStock: 0 });
  });

  it("omits maxStock when the item is available", () => {
    const [entity] = buildGrabRecordEntities([item()], new Map());
    expect("maxStock" in entity).toBe(false);
  });

  it("maps a mixed basket, translating only the linked items", () => {
    const gid = new Map([["linked", "MYITE-LINKED"]]);
    const entities = buildGrabRecordEntities(
      [item({ id: "linked" }), item({ id: "unlinked", price: 990 })],
      gid,
    );
    expect(entities.map((e) => e.id)).toEqual(["MYITE-LINKED", "unlinked"]);
  });

  it("returns an empty array for an empty menu", () => {
    expect(buildGrabRecordEntities([], new Map())).toEqual([]);
  });
});
