import { describe, expect, it } from "vitest";
import { evaluateClockOut, type ClockOutZone } from "./clock-out-gate";

// Real prod values from the 2026-07-29 incident.
const CONEZION: ClockOutZone = {
  name: "Celsius Coffee Putrajaya",
  latitude: "2.96606900",
  longitude: "101.72040030",
  radius_meters: 150,
};

// Where the staffer actually was: IOI Mall, ~571m from the Conezion zone.
const AT_IOI_MALL = { latitude: 2.9705418, longitude: 101.71787839 };
const AT_CONEZION = { latitude: 2.966069, longitude: 101.7204003 };

describe("evaluateClockOut", () => {
  it("reproduces the incident distance", () => {
    const d = evaluateClockOut({ zone: CONEZION, clockInMethod: "app", ...AT_IOI_MALL });
    // The app showed "571m away" on Farhan's screen.
    expect(d.distanceMeters).toBeGreaterThan(560);
    expect(d.distanceMeters).toBeLessThan(580);
    expect(d.withinGeofence).toBe(false);
  });

  it("still hard-blocks an off-site clock-out when the clock-in was verified", () => {
    const d = evaluateClockOut({ zone: CONEZION, clockInMethod: "app", ...AT_IOI_MALL });
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.reason).toBe("outside_zone");
    expect(d.error).toContain("Celsius Coffee Putrajaya");
  });

  it("allows the clock-out when the clock-in itself was off-site (the trap)", () => {
    const d = evaluateClockOut({ zone: CONEZION, clockInMethod: "app_offsite", ...AT_IOI_MALL });
    expect(d.allowed).toBe(true);
    if (!d.allowed) return;
    expect(d.method).toBe("app_offsite");
    expect(d.warning).toContain("flagged for review");
  });

  it("allows the clock-out when the clock-in had no GPS", () => {
    const d = evaluateClockOut({ zone: CONEZION, clockInMethod: "app_nogps", ...AT_IOI_MALL });
    expect(d.allowed).toBe(true);
    if (!d.allowed) return;
    expect(d.method).toBe("app_offsite");
  });

  it("tags a GPS-less clock-out instead of blocking it, for an unverified clock-in", () => {
    const d = evaluateClockOut({ zone: CONEZION, clockInMethod: "app_offsite" });
    expect(d.allowed).toBe(true);
    if (!d.allowed) return;
    expect(d.method).toBe("app_nogps");
    expect(d.distanceMeters).toBeNull();
  });

  it("still requires GPS when the clock-in was verified", () => {
    const d = evaluateClockOut({ zone: CONEZION, clockInMethod: "app" });
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.reason).toBe("no_gps");
  });

  it("allows a normal in-zone clock-out", () => {
    const d = evaluateClockOut({ zone: CONEZION, clockInMethod: "app", ...AT_CONEZION });
    expect(d.allowed).toBe(true);
    if (!d.allowed) return;
    expect(d.method).toBe("app");
    expect(d.warning).toBeNull();
    expect(d.withinGeofence).toBe(true);
  });

  it("does not enforce anything when the outlet has no geofence row", () => {
    const d = evaluateClockOut({ zone: null, clockInMethod: "app", ...AT_IOI_MALL });
    expect(d.allowed).toBe(true);
    if (!d.allowed) return;
    expect(d.method).toBe("app");
    expect(d.zoneName).toBeNull();
  });

  it("returns to in-zone once the staffer walks back, even off an unverified clock-in", () => {
    const d = evaluateClockOut({ zone: CONEZION, clockInMethod: "app_offsite", ...AT_CONEZION });
    expect(d.allowed).toBe(true);
    if (!d.allowed) return;
    expect(d.method).toBe("app");
    expect(d.warning).toBeNull();
  });

  it("honours a custom zone radius", () => {
    const wide = { ...CONEZION, radius_meters: 800 };
    const d = evaluateClockOut({ zone: wide, clockInMethod: "app", ...AT_IOI_MALL });
    expect(d.allowed).toBe(true);
    if (!d.allowed) return;
    expect(d.withinGeofence).toBe(true);
  });
});
