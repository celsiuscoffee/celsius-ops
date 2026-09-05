import { describe, expect, it } from "vitest";
import {
  PO_STATUSES,
  PO_STATUS_TRANSITIONS,
  canTransitionPo,
  isOrderStatus,
  isTerminalPoStatus,
  poTransitionError,
} from "./po-status";

describe("PO status transition table", () => {
  it("covers every OrderStatus enum value and only references known statuses", () => {
    const enumValues = [
      "DRAFT",
      "PENDING_APPROVAL",
      "APPROVED",
      "SENT",
      "CONFIRMED",
      "AWAITING_DELIVERY",
      "PARTIALLY_RECEIVED",
      "COMPLETED",
      "CANCELLED",
    ];
    expect([...PO_STATUSES].sort()).toEqual([...enumValues].sort());
    for (const targets of Object.values(PO_STATUS_TRANSITIONS)) {
      for (const t of targets) expect(isOrderStatus(t)).toBe(true);
    }
  });

  it("allows the live UI flows", () => {
    expect(canTransitionPo("DRAFT", "APPROVED")).toBe(true); // edit-modal Approve
    expect(canTransitionPo("DRAFT", "SENT")).toBe(true); // supplier-chats create+send
    expect(canTransitionPo("DRAFT", "AWAITING_DELIVERY")).toBe(true); // create page transmit
    expect(canTransitionPo("PENDING_APPROVAL", "APPROVED")).toBe(true);
    expect(canTransitionPo("APPROVED", "SENT")).toBe(true);
    expect(canTransitionPo("SENT", "AWAITING_DELIVERY")).toBe(true);
    expect(canTransitionPo("AWAITING_DELIVERY", "PARTIALLY_RECEIVED")).toBe(true);
    expect(canTransitionPo("PARTIALLY_RECEIVED", "COMPLETED")).toBe(true); // close short
    expect(canTransitionPo("SENT", "CANCELLED")).toBe(true);
  });

  it("treats a same-status PATCH as an idempotent no-op", () => {
    expect(canTransitionPo("AWAITING_DELIVERY", "AWAITING_DELIVERY")).toBe(true);
    expect(poTransitionError("AWAITING_DELIVERY", "AWAITING_DELIVERY")).toBeNull();
  });

  it("refuses backwards and skipping moves", () => {
    expect(canTransitionPo("COMPLETED", "DRAFT")).toBe(false);
    expect(canTransitionPo("CANCELLED", "APPROVED")).toBe(false);
    expect(canTransitionPo("DRAFT", "COMPLETED")).toBe(false); // no goods received
    expect(canTransitionPo("DRAFT", "PARTIALLY_RECEIVED")).toBe(false);
    expect(canTransitionPo("APPROVED", "DRAFT")).toBe(false);
    expect(canTransitionPo("AWAITING_DELIVERY", "APPROVED")).toBe(false);
    expect(canTransitionPo("COMPLETED", "CANCELLED")).toBe(false);
  });

  it("terminal states have no exits", () => {
    expect(isTerminalPoStatus("COMPLETED")).toBe(true);
    expect(isTerminalPoStatus("CANCELLED")).toBe(true);
    expect(isTerminalPoStatus("SENT")).toBe(false);
  });

  it("produces a clear message for refusals and unknown statuses", () => {
    expect(poTransitionError("COMPLETED", "DRAFT")).toMatch(/completed.*no longer change/i);
    expect(poTransitionError("DRAFT", "COMPLETED")).toMatch(/Cannot move a draft PO to completed/);
    expect(poTransitionError("DRAFT", "COMPLETED")).toMatch(/Allowed next: pending approval, approved/);
    expect(poTransitionError("DRAFT", "BOGUS")).toMatch(/Unknown order status "BOGUS"/);
    expect(poTransitionError("DRAFT", undefined)).toMatch(/Unknown order status/);
  });
});
