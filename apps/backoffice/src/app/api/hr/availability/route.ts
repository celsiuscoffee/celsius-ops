import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { resolveVisibleUserIds } from "@/lib/hr/scope";

export const dynamic = "force-dynamic";

// GET /api/hr/availability?user_id=X — list one staff's weekly availability
// GET /api/hr/availability                → everyone's (OWNER/ADMIN), or subtree (MANAGER)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = new URL(req.url).searchParams.get("user_id");
  const isAdmin = ["OWNER", "ADMIN"].includes(session.role);
  const isManager = session.role === "MANAGER";
  const target = userId || session.id;

  // Self-access is always allowed. Admin sees anyone. Manager sees subtree.
  if (!isAdmin && !isManager && target !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const visibleIds = await resolveVisibleUserIds(session);
  // Manager requesting a specific user → must be self or in subtree.
  if (isManager && userId && userId !== session.id && !(visibleIds || []).includes(userId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let q = hrSupabaseAdmin
    .from("hr_staff_weekly_availability")
    .select("*")
    .order("day_of_week")
    .order("available_from");

  if (userId) {
    q = q.eq("user_id", target);
  } else if (!isAdmin && !isManager) {
    q = q.eq("user_id", target);
  } else if (isManager && visibleIds !== null) {
    // Include self + subtree
    const allowed = Array.from(new Set([session.id, ...visibleIds]));
    if (allowed.length === 0) return NextResponse.json({ availability: [] });
    q = q.in("user_id", allowed);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ availability: data ?? [] });
}

// POST /api/hr/availability  body: { user_id, day_of_week, available_from, available_until, is_preferred?, max_shifts_per_week?, notes? }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { user_id, day_of_week, available_from, available_until, is_preferred, max_shifts_per_week, notes } = body;

  const isAdmin = ["OWNER", "ADMIN"].includes(session.role);
  const isManager = session.role === "MANAGER";
  const target = user_id || session.id;

  if (!isAdmin && !isManager && target !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (isManager && target !== session.id) {
    const visibleIds = await resolveVisibleUserIds(session);
    if (!(visibleIds || []).includes(target)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  if (day_of_week == null || !available_from || !available_until) {
    return NextResponse.json({ error: "day_of_week, available_from, available_until required" }, { status: 400 });
  }
  if (day_of_week < 0 || day_of_week > 6) {
    return NextResponse.json({ error: "day_of_week must be 0-6 (Sun=0, Sat=6)" }, { status: 400 });
  }
  if (available_from >= available_until) {
    return NextResponse.json({ error: "available_from must be before available_until" }, { status: 400 });
  }

  const { data, error } = await hrSupabaseAdmin
    .from("hr_staff_weekly_availability")
    .insert({
      user_id: target,
      day_of_week,
      available_from,
      available_until,
      is_preferred: is_preferred ?? false,
      max_shifts_per_week: max_shifts_per_week ?? null,
      notes: notes ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ availability: data });
}

// DELETE /api/hr/availability?id=X
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Owner/admin can delete any; manager only subtree; staff only their own
  const { data: row } = await hrSupabaseAdmin
    .from("hr_staff_weekly_availability")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const isAdmin = ["OWNER", "ADMIN"].includes(session.role);
  const isManager = session.role === "MANAGER";
  if (!isAdmin && !isManager && row.user_id !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (isManager && row.user_id !== session.id) {
    const visibleIds = await resolveVisibleUserIds(session);
    if (!(visibleIds || []).includes(row.user_id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { error } = await hrSupabaseAdmin
    .from("hr_staff_weekly_availability")
    .delete()
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
