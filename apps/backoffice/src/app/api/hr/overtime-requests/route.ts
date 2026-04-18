import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";

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

  let q = hrSupabaseAdmin.from("hr_overtime_requests").select("*").order("date", { ascending: false });
  if (status) q = q.eq("status", status);
  if (user_id) q = q.eq("user_id", user_id);
  if (from) q = q.gte("date", from);
  if (to) q = q.lte("date", to);

  // Non-admins only see their own
  if (!["OWNER", "ADMIN"].includes(session.role)) {
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

  const enriched = (data || []).map((r: { user_id: string }) => ({
    ...r,
    staff: userMap.get(r.user_id) || null,
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

  // Staff can only submit pre-approval for themselves. Managers can submit post-hoc for anyone.
  const targetUserId = user_id || session.id;
  if (request_type === "post_hoc" && !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Only managers can submit post-hoc OT" }, { status: 403 });
  }
  if (request_type === "pre_approval" && targetUserId !== session.id && !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Can only submit OT for yourself" }, { status: 403 });
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
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { id, status, hours_approved, rejection_reason, manager_notes } = body;

  if (!id || !status) return NextResponse.json({ error: "id and status required" }, { status: 400 });
  if (!["approved", "rejected", "partial", "cancelled"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
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
  if (!isAdmin && existing.user_id !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
