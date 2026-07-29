import { GEOFENCE_RADIUS_METERS, haversineDistance } from "./constants";

// The clock-out geofence decision, split out of the route so it can be tested
// without a database.
//
// The hard gate measures the staffer against the outlet stamped on their open
// log. That is only a fair test if we CONFIRMED they were at that outlet when
// they clocked in. Clock-in is deliberately soft (warn + allow + audit, so a
// barista is never locked out of starting a shift), which means an
// `app_offsite` / `app_nogps` log carries a GUESSED outlet — the nearest one
// that happens to have an hr_geofence_zones row, which may not be the outlet
// they are standing in at all.
//
// Real incident (2026-07-29): "Celsius Coffee IOI Mall" had no geofence row, so
// staff working there were snapped to Conezion 571m away and tagged offsite at
// clock-in. At clock-out the hard gate then demanded they be at Conezion — they
// physically could not end their own shift without walking to another outlet.
// So: hard-gate only a verified clock-in; otherwise fall back to the same
// warn + allow + audit rule clock-in already uses.

export type ClockOutZone = {
  name: string | null;
  latitude: number | string;
  longitude: number | string;
  radius_meters: number | null;
};

export type ClockOutMethod = "app" | "app_offsite" | "app_nogps";

export type ClockOutDecision = {
  /** Distance to the stamped outlet, or null when we had no GPS / no zone. */
  distanceMeters: number | null;
  withinGeofence: boolean;
  zoneName: string | null;
  zoneRadius: number;
} & (
  | { allowed: true; method: ClockOutMethod; warning: string | null }
  | { allowed: false; reason: "no_gps" | "outside_zone"; error: string }
);

/** Was the clock-in itself confirmed inside the outlet's geofence? */
function isVerifiedClockIn(clockInMethod: string | null): boolean {
  return clockInMethod === "app";
}

export function evaluateClockOut(params: {
  zone: ClockOutZone | null;
  clockInMethod: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): ClockOutDecision {
  const { zone, clockInMethod, latitude, longitude } = params;

  // No zone configured for the stamped outlet — nothing to measure against, so
  // there is nothing to enforce. (This is the state IOI Mall was in.)
  if (!zone) {
    return {
      allowed: true, method: "app", warning: null,
      distanceMeters: null, withinGeofence: false, zoneName: null,
      zoneRadius: GEOFENCE_RADIUS_METERS,
    };
  }

  const zoneName = zone.name;
  const zoneRadius = zone.radius_meters || GEOFENCE_RADIUS_METERS;
  const hasGps = latitude != null && longitude != null;

  const distanceMeters = hasGps
    ? Math.round(haversineDistance(latitude, longitude, Number(zone.latitude), Number(zone.longitude)))
    : null;
  const withinGeofence = distanceMeters != null && distanceMeters <= zoneRadius;

  const base = { distanceMeters, withinGeofence, zoneName, zoneRadius };

  if (isVerifiedClockIn(clockInMethod)) {
    if (!hasGps) {
      return {
        ...base, allowed: false, reason: "no_gps",
        error: "GPS location required to clock out. Please enable location and try again.",
      };
    }
    if (!withinGeofence) {
      return {
        ...base, allowed: false, reason: "outside_zone",
        error: `You must be at ${zoneName} to clock out. You're ${distanceMeters}m away (zone: ${zoneRadius}m). Return to the outlet or ask your manager to clock you out manually.`,
      };
    }
    return { ...base, allowed: true, method: "app", warning: null };
  }

  // Unverified clock-in → the stamped outlet is a guess. Let them close their
  // shift, but tag it so attendance review sees exactly what happened.
  if (!hasGps) {
    return {
      ...base, allowed: true, method: "app_nogps",
      warning: "Clocked out without GPS — flagged for review.",
    };
  }
  if (!withinGeofence) {
    return {
      ...base, allowed: true, method: "app_offsite",
      warning: `Clocked out ${distanceMeters}m from ${zoneName} (zone ${zoneRadius}m) — flagged for review.`,
    };
  }
  return { ...base, allowed: true, method: "app", warning: null };
}
