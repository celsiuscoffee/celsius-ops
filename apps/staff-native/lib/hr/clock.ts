import { api } from "../api";

export type AttendanceLog = {
  id: string;
  user_id: string;
  outlet_id: string;
  clock_in: string;
  clock_out: string | null;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  clock_out_lat: number | null;
  clock_out_lng: number | null;
  total_hours: number | null;
};

export type GeofenceZone = {
  id: string;
  outlet_id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  is_active: boolean;
};

export type ClockStatus = {
  activeLog: AttendanceLog | null;
  geofence: GeofenceZone | null;
  outletId: string | null;
};

export type ClockAction = "clock_in" | "clock_out";

export function getClockStatus() {
  return api<ClockStatus>("/api/hr/clock");
}

export function postClockAction(
  action: ClockAction,
  coords: { latitude: number; longitude: number } | null,
) {
  return api<{ success: true; log: AttendanceLog; withinGeofence: boolean }>(
    "/api/hr/clock",
    {
      method: "POST",
      body: JSON.stringify({
        action,
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
      }),
    },
  );
}

export type PingResult = {
  attendanceLogId?: string;
  notClockedIn?: boolean;
  inZone?: boolean;
  distance?: number | null;
  radius?: number;
  zoneName?: string | null;
  outOfZoneMinutes?: number;
  thresholds?: { warn: number; grace: number };
  status?: "ok" | "warning" | "out_of_zone" | "auto_close_pending";
};

export function pingAttendance(
  coords: { latitude: number; longitude: number },
  source: "foreground" | "background" | "push_wake" = "foreground",
  batteryLevel?: number,
) {
  return api<PingResult>("/api/hr/attendance/ping", {
    method: "POST",
    body: JSON.stringify({
      lat: coords.latitude,
      lng: coords.longitude,
      batteryLevel,
      source,
    }),
  });
}
