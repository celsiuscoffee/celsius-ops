import { describe, it, expect } from "vitest";
import {
  mapGrabStatusToPOS,
  shouldApplyStatus,
  type GrabOrderState,
} from "./grab-order-status";

/**
 * Regression cover for the "orders stranded at open" bug.
 *
 * Root cause: DRIVER_ALLOCATED (a POST-acceptance Grab state) mapped to "open",
 * and any push was applied unconditionally — so a normal driver-allocation push
 * (or a stray PENDING re-push for an order Grab hadn't accepted) demoted an
 * already-accepted order back to "open", below the on-register KDS floor, where
 * it vanished and could never be advanced.
 *
 * These tests fail on the OLD logic (DRIVER_ALLOCATED→open, unconditional apply)
 * and pass on the new (DRIVER_ALLOCATED→sent_to_kitchen, forward-only guard).
 */

describe("mapGrabStatusToPOS", () => {
  it("keeps DRIVER_ALLOCATED in the active kitchen bucket (not 'open')", () => {
    // The exact mapping that was wrong before.
    expect(mapGrabStatusToPOS("DRIVER_ALLOCATED")).toBe("sent_to_kitchen");
  });

  it("maps the full Grab lifecycle to the expected POS statuses", () => {
    const cases: Array<[GrabOrderState, string]> = [
      ["PENDING", "open"],
      ["ACCEPTED", "sent_to_kitchen"],
      ["DRIVER_ALLOCATED", "sent_to_kitchen"],
      ["DRIVER_ARRIVED", "ready"],
      ["COLLECTED", "completed"],
      ["DELIVERED", "completed"],
      ["CANCELLED", "cancelled"],
      ["FAILED", "cancelled"],
    ];
    for (const [state, expected] of cases) {
      expect(mapGrabStatusToPOS(state), state).toBe(expected);
    }
  });

  it("defaults an unknown state to 'open' rather than throwing", () => {
    expect(mapGrabStatusToPOS("SOMETHING_NEW")).toBe("open");
  });
});

describe("shouldApplyStatus — forward-only guard", () => {
  it("never demotes an accepted order back to open", () => {
    // The stranding scenario: order is sent_to_kitchen, a late/duplicate push
    // maps to open. It must NOT be applied.
    expect(shouldApplyStatus("sent_to_kitchen", "open")).toBe(false);
    expect(shouldApplyStatus("ready", "open")).toBe(false);
    expect(shouldApplyStatus("ready", "sent_to_kitchen")).toBe(false);
    expect(shouldApplyStatus("completed", "ready")).toBe(false);
  });

  it("allows genuine forward progress", () => {
    expect(shouldApplyStatus("open", "sent_to_kitchen")).toBe(true);
    expect(shouldApplyStatus("sent_to_kitchen", "ready")).toBe(true);
    expect(shouldApplyStatus("ready", "completed")).toBe(true);
    expect(shouldApplyStatus(null, "sent_to_kitchen")).toBe(true);
  });

  it("is a no-op when the status is unchanged", () => {
    expect(shouldApplyStatus("sent_to_kitchen", "sent_to_kitchen")).toBe(false);
    expect(shouldApplyStatus("open", "open")).toBe(false);
  });

  it("lets cancellation win from any live stage but never resurrects a finished order", () => {
    expect(shouldApplyStatus("open", "cancelled")).toBe(true);
    expect(shouldApplyStatus("sent_to_kitchen", "cancelled")).toBe(true);
    expect(shouldApplyStatus("ready", "cancelled")).toBe(true);
    expect(shouldApplyStatus("completed", "cancelled")).toBe(false);
    expect(shouldApplyStatus("cancelled", "cancelled")).toBe(false);
  });
});

describe("end-to-end: a stranded-order webhook sequence no longer demotes", () => {
  // Replays the real production sequence (order accepted, then Grab pushes a
  // driver-allocation, then a stray PENDING re-push) through the map+guard the
  // webhook uses, asserting the order stays visible on the KDS throughout.
  function replay(initial: string, states: GrabOrderState[]): string {
    let status = initial;
    for (const s of states) {
      const next = mapGrabStatusToPOS(s);
      if (shouldApplyStatus(status, next)) status = next;
    }
    return status;
  }

  it("stays sent_to_kitchen through ACCEPTED → DRIVER_ALLOCATED → stray PENDING", () => {
    // Created as sent_to_kitchen (the webhook insert default).
    expect(replay("sent_to_kitchen", ["ACCEPTED", "DRIVER_ALLOCATED", "PENDING"]))
      .toBe("sent_to_kitchen"); // never falls off the KDS into "open"
  });

  it("still completes on a normal delivery lifecycle", () => {
    expect(
      replay("sent_to_kitchen", ["ACCEPTED", "DRIVER_ALLOCATED", "DRIVER_ARRIVED", "COLLECTED", "DELIVERED"]),
    ).toBe("completed");
  });

  it("a cancellation mid-flight still cancels", () => {
    expect(replay("sent_to_kitchen", ["ACCEPTED", "CANCELLED"])).toBe("cancelled");
  });
});
