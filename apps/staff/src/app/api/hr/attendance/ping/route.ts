import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
// Service-role client — anon lacks INSERT on hr_attendance_pings.
import { supabaseAdmin as supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Haversine distance in metres
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// POST /api/hr/attendance/ping
// Body: { lat, lng, batteryLevel?, source? }
// Records a location heartbeat against the user's active attendance log.
// Returns whether the staff is in-zone + how long they've been out (for UI warnings).
export async function POST(req: NextRequest) {
  const session = await getUser(req.headers);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { lat, lng, batteryLevel, source } = await req.json();
  if (typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ error: "lat/lng required" }, { status: 400 });
  }

  // Find active attendance log
  const { data: activeLog } = await supabase
    .from("hr_attendance_logs")
    .select("id, outlet_id, clock_in")
    .eq("user_id", session.id)
    .is("clock_out", null)
    .order("clock_in", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!activeLog) {
    return NextResponse.json({ notClockedIn: true });
  }

  // Load the outlet's geofence zone (the one they clocked into — handles rotating staff)
  const { data: zone } = await supabase
    .from("hr_geofence_zones")
    .select("name, latitude, longitude, radius_meters")
    .eq("outlet_id", activeLog.outlet_id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  let inZone = true;
  let distance: number | null = null;
  let radius = 100;
  if (zone) {
    radius = zone.radius_meters || 100;
    distance = Math.round(haversine(lat, lng, Number(zone.latitude), Number(zone.longitude)));
    inZone = distance <= radius;
  }

  // Insert the ping
  await supabase.from("hr_attendance_pings").insert({
    attendance_log_id: activeLog.id,
    user_id: session.id,
    outlet_id: activeLog.outlet_id,
    lat,
    lng,
    distance_meters: distance,
    in_zone: inZone,
    battery_level: typeof batteryLevel === "number" ? Math.round(batteryLevel) : null,
    source: source === "background" || source === "push_wake" ? source : "foreground",
  });

  // For UI: compute minutes since last in-zone ping (if out-of-zone now)
  let outOfZoneMinutes = 0;
  if (!inZone) {
    const { data: lastInZone } = await supabase
      .from("hr_attendance_pings")
      .select("created_at")
      .eq("attendance_log_id", activeLog.id)
      .eq("in_zone", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastInZoneAt = lastInZone?.created_at
      ? new Date(lastInZone.created_at)
      : new Date(activeLog.clock_in);
    outOfZoneMinutes = Math.round((Date.now() - lastInZoneAt.getTime()) / 60000);
  }

  // Load grace thresholds
  const { data: settings } = await supabase
    .from("hr_company_settings")
    .select("geofence_exit_grace_minutes, geofence_warning_minutes")
    .limit(1)
    .maybeSingle();
  const warn = Number(settings?.geofence_warning_minutes ?? 20);
  const grace = Number(settings?.geofence_exit_grace_minutes ?? 30);

  return NextResponse.json({
    attendanceLogId: activeLog.id,
    inZone,
    distance,
    radius,
    zoneName: zone?.name || null,
    outOfZoneMinutes,
    thresholds: { warn, grace },
    status: inZone ? "ok" : outOfZoneMinutes >= grace ? "auto_close_pending" : outOfZoneMinutes >= warn ? "warning" : "out_of_zone",
  });
}
