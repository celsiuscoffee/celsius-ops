import { describe, it, expect } from "vitest";
import {
  storehubSource,
  posSource,
  pickupSource,
  SOURCE_LABELS,
  SOURCE_ORDER,
} from "../source-channels";

// The input vocabularies below are the actual values verified in prod
// (2026-07-18) — see the module header. If a new POS source or pickup
// source appears, add it here first.

describe("storehubSource", () => {
  it("maps the three real StoreHub channels", () => {
    expect(storehubSource("OFFLINE_PAYMENTS")).toBe("till");
    expect(storehubSource("GRABFOOD")).toBe("grabfood");
    // Beep is retired with StoreHub — folded into Other Delivery (owner call)
    expect(storehubSource("BEEP_ORDERS")).toBe("delivery_other");
  });

  it("null/unknown → till (the counter default)", () => {
    expect(storehubSource(null)).toBe("till");
    expect(storehubSource(undefined)).toBe("till");
    expect(storehubSource("(direct)")).toBe("till");
  });

  it("other aggregators → delivery_other", () => {
    expect(storehubSource("FOODPANDA")).toBe("delivery_other");
    expect(storehubSource("SHOPEEFOOD")).toBe("delivery_other");
  });
});

describe("posSource", () => {
  it("maps the real pos_orders source values", () => {
    expect(posSource("dine_in", "pos")).toBe("till");
    expect(posSource("takeaway", "pos")).toBe("till");
    expect(posSource("takeaway", "grabfood")).toBe("grabfood");
  });

  it("delivery order type without a platform source → delivery_other", () => {
    expect(posSource("delivery", null)).toBe("delivery_other");
  });

  it("qr-ish sources → qr_table", () => {
    expect(posSource("dine_in", "qr")).toBe("qr_table");
    expect(posSource("dine_in", "qr_table")).toBe("qr_table");
  });
});

describe("pickupSource", () => {
  it("web_qr (table scan-&-order) → qr_table", () => {
    expect(pickupSource("web_qr")).toBe("qr_table");
  });

  it("app / web / null → pickup_app", () => {
    expect(pickupSource("app_ios")).toBe("pickup_app");
    expect(pickupSource("app_android")).toBe("pickup_app");
    expect(pickupSource("web")).toBe("pickup_app");
    expect(pickupSource(null)).toBe("pickup_app");
  });
});

describe("labels & order", () => {
  it("every ordered key has a label", () => {
    for (const key of SOURCE_ORDER) {
      expect(SOURCE_LABELS[key]).toBeTruthy();
    }
  });
});
