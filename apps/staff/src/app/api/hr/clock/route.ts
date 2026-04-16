import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { haversineDistance, GEOFENCE_RADIUS_METERS } from "@/lib/hr/constants";
import type { AttendanceLog, GeofenceZone } from "@/lib/hr/types";

export const dynamic = "force-dynamic";

// GET: current clock-in status for the logged-in user
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Find today's open attendance log (clocked in but not out)
  const { data: active } = await supabase
    .from("hr_attendance_logs")
    .select("*")
    .eq("user_id", session.id)
    .is("clock_out", null)
    .order("clock_in", { ascending: false })
    .limit(1)
    .single();

  // Get geofence zones for the user's outlet
  const outletId = session.outletId;
  let geofence: GeofenceZone | null = null;
  if (outletId) {
    const { data } = await supabase
      .from("hr_geofence_zones")
      .select("*")
      .eq("outlet_id", outletId)
      .eq("is_active", true)
      .limit(1)
      .single();
    geofence = data;
  }

  return NextResponse.json({
    activeLog: active as AttendanceLog | null,
    geofence,
    outletId,
  });
}

// POST: clock in or clock out
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { action, latitude, longitude, photo } = body as {
    action: "clock_in" | "clock_out";
    latitude?: number;
    longitude?: number;
    photo?: string; // base64 data URL
  };

  const outletId = session.outletId;
  if (!outletId) {
    return NextResponse.json({ error: "No outlet assigned" }, { status: 400 });
  }

  // Check geofence
  let withinGeofence = false;
  if (latitude != null && longitude != null) {
    const { data: zone } = await supabase
      .from("hr_geofence_zones")
      .select("*")
      .eq("outlet_id", outletId)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (zone) {
      const distance = haversineDistance(
        latitude, longitude,
        Number(zone.latitude), Number(zone.longitude),
      );
      withinGeofence = distance <= (zone.radius_meters || GEOFENCE_RADIUS_METERS);
    }
  }

  // Upload photo to Supabase Storage if provided
  async function uploadPhoto(photoData: string, prefix: string): Promise<string | null> {
    if (!photoData) return null;
    try {
      // Strip data URL prefix: "data:image/jpeg;base64,..."
      const base64 = photoData.includes(",") ? photoData.split(",")[1] : photoData;
      const buffer = Buffer.from(base64, "base64");
      const timestamp = Date.now();
      const path = `attendance/${session!.id}/${prefix}_${timestamp}.jpg`;

      const { error: uploadErr } = await supabase.storage
        .from("hr-photos")
        .upload(path, buffer, { contentType: "image/jpeg", upsert: false });

      if (uploadErr) {
        console.error("Photo upload error:", uploadErr.message);
        return null;
      }

      const { data: urlData } = supabase.storage
        .from("hr-photos")
        .getPublicUrl(path);

      return urlData.publicUrl;
    } catch {
      return null;
    }
  }

  if (action === "clock_in") {
    // Check if already clocked in
    const { data: existing } = await supabase
      .from("hr_attendance_logs")
      .select("id")
      .eq("user_id", session.id)
      .is("clock_out", null)
      .limit(1)
      .single();

    if (existing) {
      return NextResponse.json({ error: "Already clocked in" }, { status: 400 });
    }

    const photoUrl = photo ? await uploadPhoto(photo, "in") : null;

    const { data, error } = await supabase
      .from("hr_attendance_logs")
      .insert({
        user_id: session.id,
        outlet_id: outletId,
        clock_in: new Date().toISOString(),
        clock_in_lat: latitude ?? null,
        clock_in_lng: longitude ?? null,
        clock_in_method: "app",
        clock_in_photo_url: photoUrl,
        ai_status: "pending",
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      log: data,
      withinGeofence,
    });
  }

  if (action === "clock_out") {
    // Find the open log
    const { data: activeLog } = await supabase
      .from("hr_attendance_logs")
      .select("*")
      .eq("user_id", session.id)
      .is("clock_out", null)
      .order("clock_in", { ascending: false })
      .limit(1)
      .single();

    if (!activeLog) {
      return NextResponse.json({ error: "Not clocked in" }, { status: 400 });
    }

    const clockOut = new Date();
    const clockIn = new Date(activeLog.clock_in);
    const totalHours = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60);

    const photoUrl = photo ? await uploadPhoto(photo, "out") : null;

    const { data, error } = await supabase
      .from("hr_attendance_logs")
      .update({
        clock_out: clockOut.toISOString(),
        clock_out_lat: latitude ?? null,
        clock_out_lng: longitude ?? null,
        clock_out_method: "app",
        clock_out_photo_url: photoUrl,
        total_hours: Math.round(totalHours * 100) / 100,
      })
      .eq("id", activeLog.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      log: data,
      withinGeofence,
      totalHours: Math.round(totalHours * 100) / 100,
    });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
