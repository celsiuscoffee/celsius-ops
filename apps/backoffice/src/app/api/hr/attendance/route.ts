import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { getAccessibleOutletIds } from "@/lib/hr/scope";

export const dynamic = "force-dynamic";

// GET: list attendance logs with filters
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "flagged"; // default to flagged only
  const limit = parseInt(searchParams.get("limit") || "50");
  // MANAGER sees attendance across ALL their assigned outlets (outletId +
  // outletIds[]). A URL outlet_id param is honored only if accessible.
  // OWNER/ADMIN honor the URL param freely.
  const requestedOutletId = searchParams.get("outlet_id");
  const allowedOutletIds = await getAccessibleOutletIds(session);

  let outletFilterIds: string[] | null = null;
  if (allowedOutletIds === null) {
    // OWNER/ADMIN: optional single-outlet filter from URL
    outletFilterIds = requestedOutletId ? [requestedOutletId] : null;
  } else {
    if (allowedOutletIds.length === 0) {
      return NextResponse.json({ logs: [] });
    }
    outletFilterIds = requestedOutletId && allowedOutletIds.includes(requestedOutletId)
      ? [requestedOutletId]
      : allowedOutletIds;
  }

  let query = hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("*")
    .order("clock_in", { ascending: false })
    .limit(limit);

  if (status !== "all") {
    query = query.eq("ai_status", status);
  }
  if (outletFilterIds !== null) {
    query = query.in("outlet_id", outletFilterIds);
  }

  const { data: rawData, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Exclude "OT-only" flagged logs from the attendance queue — those route to
  // the OT approval queue instead. A log stays in attendance if it has any
  // non-OT flag (late_arrival, early_out, outside_geofence, no_clock_out, etc).
  const data = status === "flagged"
    ? (rawData || []).filter((l: { ai_flags: string[] | null }) => {
        const flags = l.ai_flags || [];
        if (flags.length === 0) return true;
        return flags.some((f) => f !== "overtime_detected");
      })
    : (rawData || []);

  // Enrich with user name + fullName + outlet name
  const userIds = Array.from(new Set((data || []).map((l: { user_id: string }) => l.user_id)));
  const outletIds = Array.from(
    new Set((data || []).map((l: { outlet_id: string }) => l.outlet_id).filter(Boolean)),
  );

  const [users, outlets] = await Promise.all([
    userIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, fullName: true },
        })
      : Promise.resolve([]),
    outletIds.length > 0
      ? prisma.outlet.findMany({
          where: { id: { in: outletIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const outletMap = new Map(outlets.map((o) => [o.id, o.name]));

  const enriched = (data || []).map((log: { user_id: string; outlet_id: string }) => {
    const u = userMap.get(log.user_id);
    return {
      ...log,
      user_name: u?.fullName || u?.name || null,
      user_nickname: u?.name || null,
      outlet_name: outletMap.get(log.outlet_id) || null,
    };
  });

  return NextResponse.json({ logs: enriched, count: enriched.length });
}

// PATCH: review a flagged attendance log
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { id, action, adjustedHours, notes, excuseReason } = body as {
    id: string;
    action: "acknowledge" | "excuse" | "approve" | "reject" | "adjust";
    adjustedHours?: number;
    notes?: string;
    excuseReason?: string;
  };

  const updateData: Record<string, unknown> = {
    ai_status: "reviewed",
    reviewed_by: session.id,
    reviewed_at: new Date().toISOString(),
    review_notes: notes || null,
  };

  if (action === "approve" || action === "acknowledge") {
    // "Acknowledge": manager saw it, penalty still applies as calculated
    updateData.final_status = "approved";
    updateData.excused = false;
  } else if (action === "excuse") {
    // "Excuse": legitimate reason — allowance engine waives the penalty
    updateData.final_status = "approved";
    updateData.excused = true;
    updateData.excused_reason = excuseReason || notes || null;
  } else if (action === "reject") {
    updateData.final_status = "rejected";
  } else if (action === "adjust" && adjustedHours != null) {
    updateData.final_status = "adjusted";
    updateData.total_hours = adjustedHours;
    updateData.regular_hours = Math.min(adjustedHours, 8);
    updateData.overtime_hours = Math.max(0, adjustedHours - 8);
  }

  const { data, error } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ log: data });
}
