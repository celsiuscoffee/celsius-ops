import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";

export const dynamic = "force-dynamic";

// GET /api/hr/coverage[?outlet_id=X]
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const outletId = new URL(req.url).searchParams.get("outlet_id");
  let q = hrSupabaseAdmin
    .from("hr_outlet_coverage_rules")
    .select("*")
    .order("outlet_id")
    .order("day_of_week")
    .order("slot_start");
  if (outletId) q = q.eq("outlet_id", outletId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data ?? [] });
}

// POST /api/hr/coverage  body: { outlet_id, day_of_week, slot_start, slot_end, min_staff, slot_label?, is_peak? }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { outlet_id, day_of_week, slot_start, slot_end, min_staff, slot_label, is_peak } = body;

  if (!outlet_id || day_of_week == null || !slot_start || !slot_end || min_staff == null) {
    return NextResponse.json({ error: "outlet_id, day_of_week, slot_start, slot_end, min_staff required" }, { status: 400 });
  }
  if (day_of_week < 0 || day_of_week > 6) {
    return NextResponse.json({ error: "day_of_week must be 0-6" }, { status: 400 });
  }
  if (slot_start >= slot_end) {
    return NextResponse.json({ error: "slot_start must be before slot_end" }, { status: 400 });
  }

  const { data, error } = await hrSupabaseAdmin
    .from("hr_outlet_coverage_rules")
    .insert({
      outlet_id,
      day_of_week,
      slot_start,
      slot_end,
      min_staff,
      slot_label: slot_label ?? null,
      is_peak: is_peak ?? false,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}

// DELETE /api/hr/coverage?id=X
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await hrSupabaseAdmin
    .from("hr_outlet_coverage_rules")
    .delete()
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
