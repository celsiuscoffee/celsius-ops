import { describe, it, expect } from "vitest";
import { mapGrabStatusToPOS, resolveStatusTransition } from "./grab-order-status";

describe("mapGrabStatusToPOS", () => {
  it("maps the known Grab lifecycle states", () => {
    expect(mapGrabStatusToPOS("PENDING")).toBe("open");
    expect(mapGrabStatusToPOS("DRIVER_ALLOCATED")).toBe("open");
    expect(mapGrabStatusToPOS("ACCEPTED")).toBe("sent_to_kitchen");
    expect(mapGrabStatusToPOS("DRIVER_ARRIVED")).toBe("ready");
    expect(mapGrabStatusToPOS("COLLECTED")).toBe("completed");
    expect(mapGrabStatusToPOS("DELIVERED")).toBe("completed");
    expect(mapGrabStatusToPOS("CANCELLED")).toBe("cancelled");
    expect(mapGrabStatusToPOS("FAILED")).toBe("cancelled");
  });

  it("tolerates case and separator variants", () => {
    expect(mapGrabStatusToPOS("Driver Arrived")).toBe("ready");
    expect(mapGrabStatusToPOS("driver-arrived")).toBe("ready");
    expect(mapGrabStatusToPOS(" delivered ")).toBe("completed");
    expect(mapGrabStatusToPOS("Canceled")).toBe("cancelled"); // US spelling
  });

  it("returns null for unknown / missing states (no silent fallback to open)", () => {
    expect(mapGrabStatusToPOS(undefined)).toBeNull();
    expect(mapGrabStatusToPOS(null)).toBeNull();
    expect(mapGrabStatusToPOS("")).toBeNull();
    expect(mapGrabStatusToPOS("SOME_NEW_STATE")).toBeNull();
  });
});

describe("resolveStatusTransition (forward-only)", () => {
  it("advances along the lifecycle", () => {
    expect(resolveStatusTransition("open", "sent_to_kitchen")).toBe("sent_to_kitchen");
    expect(resolveStatusTransition("sent_to_kitchen", "ready")).toBe("ready");
    expect(resolveStatusTransition("ready", "completed")).toBe("completed");
  });

  it("never regresses to a lower status — the production bug", () => {
    // A late/duplicate Grab push mapping to "open" must NOT undo a completed order.
    expect(resolveStatusTransition("completed", "open")).toBeNull();
    expect(resolveStatusTransition("ready", "open")).toBeNull();
    expect(resolveStatusTransition("sent_to_kitchen", "open")).toBeNull();
    expect(resolveStatusTransition("completed", "ready")).toBeNull();
  });

  it("is a no-op for an unknown incoming status or an unchanged one", () => {
    expect(resolveStatusTransition("completed", null)).toBeNull();
    expect(resolveStatusTransition("open", null)).toBeNull();
    expect(resolveStatusTransition("ready", "ready")).toBeNull();
  });

  it("honours a cancellation from any non-terminal status", () => {
    expect(resolveStatusTransition("open", "cancelled")).toBe("cancelled");
    expect(resolveStatusTransition("ready", "cancelled")).toBe("cancelled");
  });

  it("never un-completes or re-cancels a terminal order", () => {
    expect(resolveStatusTransition("completed", "cancelled")).toBeNull();
    expect(resolveStatusTransition("cancelled", "cancelled")).toBeNull();
    expect(resolveStatusTransition("refunded", "cancelled")).toBeNull();
  });
});
