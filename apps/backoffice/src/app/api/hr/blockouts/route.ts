import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";

export const dynamic = "force-dynamic";

// Part-timer blockout dates — backed by hr_staff_availability.
// Part-timers are available by default; each row represents a single date
// exception when they CAN'T work. Rendered as 'Blocked' cells on the grid.

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = new URL(req.url).searchParams.get("user_id");
  const canSeeAll = ["OWNER", "ADMIN"].includes(session.role);
  const target = userId || session.id;
  if (!canSeeAll && target !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let q = hrSupabaseAdmin
    .from("hr_staff_availability")
    .select("id, user_id, date, availability, reason, created_at")
    .order("date", { ascending: false });
  if (userId || !canSeeAll) q = q.eq("user_id", target);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ blockouts: data ?? [] });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { user_id, date, reason } = body;
  const canEditOthers = ["OWNER", "ADMIN"].includes(session.role);
  const target = user_id || session.id;
  if (!canEditOthers && target !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!date) return NextResponse.json({ error: "date required" }, { status: 400 });

  const { data, error } = await hrSupabaseAdmin
    .from("hr_staff_availability")
    .insert({
      user_id: target,
      date,
      availability: "unavailable",
      reason: reason ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ blockout: data });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data: row } = await hrSupabaseAdmin
    .from("hr_staff_availability")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const canEditOthers = ["OWNER", "ADMIN"].includes(session.role);
  if (!canEditOthers && row.user_id !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await hrSupabaseAdmin
    .from("hr_staff_availability")
    .delete()
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
