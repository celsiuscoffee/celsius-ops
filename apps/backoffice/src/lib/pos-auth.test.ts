import { describe, it, expect } from "vitest";
import { sessionOutletId } from "./pos-auth";

// Outlet UUIDs from the live estate — Farhan's case is the one this fixes.
const IOI = "baf4566e-dbba-4859-b8c7-a863c12d6682";      // his home outlet, has NO till
const PUTRAJAYA = "89b19c9f-b1e0-42fe-a404-6d1a472e34c5"; // where he was rostered
const TAMARIND = "5d1f2731-1985-4e54-a6df-3990e7d5c159";
const SHAH_ALAM = "b3b6299e-09dc-4f4a-80ef-bbc04316d324";

describe("sessionOutletId", () => {
  it("binds to the till a rotating staffer is standing at, not their home outlet", () => {
    // Farhan: home IOI Mall, rotation ticked for Putrajaya + Tamarind, signing
    // in at the Putrajaya till. The session must say Putrajaya, or the schedule
    // gate looks for his shift on IOI Mall's roster and never finds it.
    expect(sessionOutletId({
      tillOutletId: PUTRAJAYA,
      homeOutletId: IOI,
      rotation: [IOI, PUTRAJAYA, TAMARIND],
    })).toBe(PUTRAJAYA);
  });

  it("binds to the home outlet when that IS the till", () => {
    expect(sessionOutletId({
      tillOutletId: PUTRAJAYA, homeOutletId: PUTRAJAYA, rotation: [],
    })).toBe(PUTRAJAYA);
  });

  it("refuses a till the staffer does not work at — falls back to home", () => {
    // Not an access check (the PIN already matched), but the session must never
    // claim an outlet the roster doesn't put them at.
    expect(sessionOutletId({
      tillOutletId: SHAH_ALAM,
      homeOutletId: IOI,
      rotation: [PUTRAJAYA, TAMARIND],
    })).toBe(IOI);
  });

  it("keeps the home outlet when the till sends no outlet (web register)", () => {
    expect(sessionOutletId({
      tillOutletId: null, homeOutletId: IOI, rotation: [PUTRAJAYA],
    })).toBe(IOI);
  });

  it("handles cross-outlet roles with no home outlet", () => {
    // Owners/managers carry outletId = null and match every till.
    expect(sessionOutletId({
      tillOutletId: PUTRAJAYA, homeOutletId: null, rotation: [],
    })).toBeNull();
    expect(sessionOutletId({
      tillOutletId: null, homeOutletId: null, rotation: [],
    })).toBeNull();
  });

  it("tolerates a missing rotation list", () => {
    expect(sessionOutletId({ tillOutletId: PUTRAJAYA, homeOutletId: IOI })).toBe(IOI);
    expect(sessionOutletId({ tillOutletId: PUTRAJAYA, homeOutletId: IOI, rotation: null })).toBe(IOI);
  });

  it("does not bind to an unresolved legacy string id", () => {
    // The till sends "outlet-con"; if the UUID lookup failed we must not treat
    // that string as an outlet the staffer works at.
    expect(sessionOutletId({
      tillOutletId: "outlet-con", homeOutletId: IOI, rotation: [PUTRAJAYA],
    })).toBe(IOI);
  });
});
