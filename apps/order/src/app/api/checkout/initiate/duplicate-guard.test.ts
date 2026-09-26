import { describe, it, expect } from "vitest";
import { pickDuplicateTwin, type TwinRow } from "./duplicate-guard";

const row = (over: Partial<TwinRow>): TwinRow => ({
  id: "id",
  order_number: "C-TEST01",
  status: "pending",
  created_at: "2026-09-26T02:44:21Z",
  payment_checkout_id: null,
  ...over,
});

describe("pickDuplicateTwin", () => {
  it("flags a settled twin — paying again charges twice", () => {
    for (const status of ["paid", "preparing", "ready", "collected", "completed"]) {
      expect(pickDuplicateTwin([row({ status })])?.status).toBe(status);
    }
  });

  it("flags a pending twin that reached a checkout (money may be in flight)", () => {
    // C-7272: bank debited at +4s while the gateway still reported nothing.
    expect(pickDuplicateTwin([row({ status: "pending", payment_checkout_id: "179038250" })])).not.toBeNull();
  });

  it("ignores a pending twin with no checkout — nothing could have been charged", () => {
    expect(pickDuplicateTwin([row({ status: "pending", payment_checkout_id: null })])).toBeNull();
  });

  it("ignores failed and cancelled twins so a real retry is never blocked", () => {
    expect(
      pickDuplicateTwin([
        row({ status: "failed", payment_checkout_id: "1790390727436386057" }),
        row({ status: "cancelled", payment_checkout_id: "1790390760214763483" }),
      ]),
    ).toBeNull();
  });

  it("returns the first at-risk row among a mixed set", () => {
    // The real Shah Alam table 15 sequence: two failures around a settled one.
    const twin = pickDuplicateTwin([
      row({ status: "failed", order_number: "C-FJ9C94", payment_checkout_id: "x" }),
      row({ status: "completed", order_number: "C-DFFK97" }),
      row({ status: "failed", order_number: "C-ETHC92", payment_checkout_id: "y" }),
    ]);
    expect(twin?.order_number).toBe("C-DFFK97");
  });

  it("handles an empty or missing result set", () => {
    expect(pickDuplicateTwin([])).toBeNull();
    expect(pickDuplicateTwin(null)).toBeNull();
    expect(pickDuplicateTwin(undefined)).toBeNull();
  });
});
