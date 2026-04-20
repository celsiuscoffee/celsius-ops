import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { resolveVisibleUserIds } from "@/lib/hr/scope";

export const dynamic = "force-dynamic";

// GET /api/hr/overtime-requests?status=pending&user_id=...&from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const user_id = searchParams.get("user_id");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const isAdmin = ["OWNER", "ADMIN"].includes(session.role);
  const isManager = session.role === "MANAGER";

  let q = hrSupabaseAdmin.from("hr_overtime_requests").select("*").order("date", { ascending: false });
  if (status) q = q.eq("status", status);
  if (user_id) q = q.eq("user_id", user_id);
  if (from) q = q.gte("date", from);
  if (to) q = q.lte("date", to);

  if (isAdmin) {
    // no user scoping
  } else if (isManager) {
    const visibleIds = await resolveVisibleUserIds(session);
    // Manager sees their own + subtree
    const allowed = Array.from(new Set([session.id, ...(visibleIds || [])]));
    if (user_id && !allowed.includes(user_id)) {
      return NextResponse.json({ requests: [] });
    }
    if (!user_id) {
      q = q.in("user_id", allowed);
    }
  } else {
    q = q.eq("user_id", session.id);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich with staff name
  const userIds = Array.from(new Set((data || []).map((r: { user_id: string }) => r.user_id)));
  const users = userIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, fullName: true } })
    : [];
  const userMap = new Map(users.map(u => [u.id, u]));

  // Enrich with attendance logs for that staff on that date so reviewers can
  // see raw clock-in / clock-out times, not just the aggregated OT total.
  // Look up in one batched query keyed by user_id + MYT date range.
  type OTRow = { id: string; user_id: string; date: string };
  const rows = (data || []) as OTRow[];
  type AttLog = {
    id: string;
    user_id: string;
    clock_in: string;
    clock_out: string | null;
    overtime_hours: number | null;
    overtime_type: string | null;
    outlet_id: string | null;
  };
  const attendanceMap = new Map<string, AttLog[]>(); // key: user_id|date (MYT)
  if (rows.length > 0) {
    const uniqueUserIds = Array.from(new Set(rows.map((r) => r.user_id)));
    const dates = rows.map((r) => r.date).sort();
    const minDate = dates[0];
    const maxDate = dates[dates.length - 1];
    // Clock-in is UTC; widen range by 1 day each side so MYT conversion
    // can't miss an overlap.
    const rangeStart = new Date(`${minDate}T00:00:00Z`);
    rangeStart.setUTCDate(rangeStart.getUTCDate() - 1);
    const rangeEnd = new Date(`${maxDate}T00:00:00Z`);
    rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 2);
    const { data: logs } = await hrSupabaseAdmin
      .from("hr_attendance_logs")
      .select("id, user_id, clock_in, clock_out, overtime_hours, overtime_type, outlet_id")
      .in("user_id", uniqueUserIds)
      .gte("clock_in", rangeStart.toISOString())
      .lt("clock_in", rangeEnd.toISOString())
      .order("clock_in", { ascending: true });
    const toMytDate = (iso: string) =>
      new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    for (const l of (logs || []) as AttLog[]) {
      const key = `${l.user_id}|${toMytDate(l.clock_in)}`;
      const arr = attendanceMap.get(key) || [];
      arr.push(l);
      attendanceMap.set(key, arr);
    }
  }

  const enriched = rows.map((r) => ({
    ...r,
    staff: userMap.get(r.user_id) || null,
    attendance_logs: attendanceMap.get(`${r.user_id}|${r.date}`) || [],
  }));

  return NextResponse.json({ requests: enriched });
}

// POST: create an OT request (pre-approval by staff, or post-hoc by manager)
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { user_id, outlet_id, date, request_type, hours_requested, ot_type, reason, shift_start_time, shift_end_time, attendance_log_id } = body;

  if (!date || !hours_requested || !reason || !request_type) {
    return NextResponse.json({ error: "date, hours_requested, reason, request_type required" }, { status: 400 });
  }

  // Staff can only submit pre-approval for themselves. Managers/admins can submit post-hoc for their subtree (MANAGER) or anyone (OWNER/ADMIN).
  const targetUserId = user_id || session.id;
  const isAdmin = ["OWNER", "ADMIN"].includes(session.role);
  const isManager = session.role === "MANAGER";

  if (request_type === "post_hoc" && !isAdmin && !isManager) {
    return NextResponse.json({ error: "Only managers can submit post-hoc OT" }, { status: 403 });
  }
  if (request_type === "pre_approval" && targetUserId !== session.id && !isAdmin && !isManager) {
    return NextResponse.json({ error: "Can only submit OT for yourself" }, { status: 403 });
  }
  if (isManager && targetUserId !== session.id) {
    const visibleIds = await resolveVisibleUserIds(session);
    if (!(visibleIds || []).includes(targetUserId)) {
      return NextResponse.json({ error: "Forbidden — outside your subtree" }, { status: 403 });
    }
  }

  const { data, error } = await hrSupabaseAdmin
    .from("hr_overtime_requests")
    .insert({
      user_id: targetUserId,
      outlet_id: outlet_id || null,
      date,
      request_type,
      hours_requested,
      ot_type: ot_type || "1.5x",
      reason,
      shift_start_time: shift_start_time || null,
      shift_end_time: shift_end_time || null,
      status: "pending",
      requested_by: session.id,
      attendance_log_id: attendance_log_id || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ request: data });
}

// PATCH: manager approves/rejects an OT request
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { id, status, hours_approved, rejection_reason, manager_notes } = body;

  if (!id || !status) return NextResponse.json({ error: "id and status required" }, { status: 400 });
  if (!["approved", "rejected", "partial", "cancelled"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  // MANAGER: only act on requests within subtree.
  if (session.role === "MANAGER") {
    const { data: existing } = await hrSupabaseAdmin
      .from("hr_overtime_requests")
      .select("user_id")
      .eq("id", id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const visibleIds = await resolveVisibleUserIds(session);
    if (!(visibleIds || []).includes(existing.user_id)) {
      return NextResponse.json({ error: "Forbidden — outside your subtree" }, { status: 403 });
    }
  }

  const updates: Record<string, unknown> = {
    status,
    reviewed_by: session.id,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (status === "approved") {
    updates.hours_approved = hours_approved ?? (await getHoursRequested(id));
  } else if (status === "partial") {
    if (hours_approved == null) return NextResponse.json({ error: "hours_approved required for partial" }, { status: 400 });
    updates.hours_approved = hours_approved;
  } else if (status === "rejected") {
    updates.hours_approved = 0;
    updates.rejection_reason = rejection_reason || null;
  }
  if (manager_notes !== undefined) updates.manager_notes = manager_notes;

  const { data, error } = await hrSupabaseAdmin
    .from("hr_overtime_requests")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ request: data });
}

async function getHoursRequested(id: string) {
  const { data } = await hrSupabaseAdmin
    .from("hr_overtime_requests")
    .select("hours_requested")
    .eq("id", id)
    .single();
  return (data as { hours_requested?: number } | null)?.hours_requested ?? 0;
}

// DELETE: cancel a pending OT request (owner or admin)
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Load to check ownership
  const { data: existing } = await hrSupabaseAdmin
    .from("hr_overtime_requests")
    .select("user_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isAdmin = ["OWNER", "ADMIN"].includes(session.role);
  const isManager = session.role === "MANAGER";
  if (!isAdmin && !isManager && existing.user_id !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (isManager && existing.user_id !== session.id) {
    const visibleIds = await resolveVisibleUserIds(session);
    if (!(visibleIds || []).includes(existing.user_id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  if (existing.status !== "pending") {
    return NextResponse.json({ error: "Only pending requests can be cancelled" }, { status: 400 });
  }

  const { error } = await hrSupabaseAdmin
    .from("hr_overtime_requests")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
