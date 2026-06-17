import { describe, it, expect } from "vitest";
import {
  indexProductsByGrabKeys,
  resolveGrabItemProduct,
  fallbackGrabItemName,
  type GrabItemProductRow,
} from "./grab-order-items";

const LATTE: GrabItemProductRow = {
  id: "68ad6eab59357c00074fe000",
  name: "Buttercream Latte",
  grab_item_id: "MYITE2026011703270414937",
};
const MOCHA: GrabItemProductRow = {
  id: "68ad6eac59357c00074fe149",
  name: "Berry Berries",
  grab_item_id: null,
};

describe("indexProductsByGrabKeys", () => {
  it("keys a product by both its id and its grab_item_id", () => {
    const index = indexProductsByGrabKeys([LATTE]);
    expect(index.get(LATTE.id)).toBe(LATTE);
    expect(index.get(LATTE.grab_item_id!)).toBe(LATTE);
  });

  it("skips an empty grab_item_id", () => {
    const index = indexProductsByGrabKeys([MOCHA]);
    expect(index.get(MOCHA.id)).toBe(MOCHA);
    expect([...index.keys()]).toEqual([MOCHA.id]);
  });

  it("never lets a grab_item_id clobber a real product id key", () => {
    // Pathological: another product's grab_item_id equals MOCHA's product id.
    const evil: GrabItemProductRow = { id: "x", name: "Evil", grab_item_id: MOCHA.id };
    const index = indexProductsByGrabKeys([MOCHA, evil]);
    expect(index.get(MOCHA.id)).toBe(MOCHA); // id wins over the colliding grab_item_id
  });
});

describe("resolveGrabItemProduct", () => {
  const index = indexProductsByGrabKeys([LATTE, MOCHA]);

  it("matches a self-serve order line by Grab's own item id (the real-world bug)", () => {
    // Grab's portal-built menu sends only grabItemID; item.id is Grab's id too.
    const item = { id: "MYITE2026011703270414937", grabItemID: "MYITE2026011703270414937", price: 1590 };
    expect(resolveGrabItemProduct(item, index)?.name).toBe("Buttercream Latte");
  });

  it("matches a pushed-menu order line by our product id (item.id = products.id)", () => {
    expect(resolveGrabItemProduct({ id: MOCHA.id, price: 1690 }, index)?.name).toBe("Berry Berries");
  });

  it("falls back to grabItemID when item.id doesn't match", () => {
    const item = { id: "unknown-partner-id", grabItemID: "MYITE2026011703270414937" };
    expect(resolveGrabItemProduct(item, index)?.name).toBe("Buttercream Latte");
  });

  it("returns undefined for an unlinked item", () => {
    expect(resolveGrabItemProduct({ id: "MYITE9999", grabItemID: "MYITE8888" }, index)).toBeUndefined();
  });
});

describe("fallbackGrabItemName", () => {
  it("shows the price and an 8-char id hint when no catalogue match", () => {
    expect(fallbackGrabItemName({ id: "MYITE2026011703282830543", price: 987 })).toBe(
      "Item @ RM 9.87 [MYITE202]",
    );
  });

  it("uses grabItemID for the hint when item.id is absent", () => {
    expect(fallbackGrabItemName({ grabItemID: "MYITE2026011703283251309", price: 1487 })).toBe(
      "Item @ RM 14.87 [MYITE202]",
    );
  });

  it("omits the price when it is zero or missing", () => {
    expect(fallbackGrabItemName({ id: "MYITE202", price: 0 })).toBe("Item [MYITE202]");
    expect(fallbackGrabItemName({})).toBe("Item");
  });
});
