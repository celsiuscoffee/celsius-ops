import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET: my OT requests
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("hr_overtime_requests")
    .select("*")
    .eq("user_id", session.id)
    .order("date", { ascending: false })
    .limit(30);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ requests: data || [] });
}

// POST: submit OT pre-approval request for myself
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { date, hours_requested, ot_type, reason, shift_start_time, shift_end_time } = body;

  if (!date || !hours_requested || !reason) {
    return NextResponse.json({ error: "date, hours_requested, reason required" }, { status: 400 });
  }
  const hoursNum = Number(hours_requested);
  if (!Number.isFinite(hoursNum) || hoursNum <= 0 || hoursNum > 24) {
    return NextResponse.json({ error: "hours_requested must be between 0.25 and 24" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("hr_overtime_requests")
    .insert({
      user_id: session.id,
      outlet_id: session.outletId || null,
      date,
      request_type: "pre_approval",
      hours_requested: hoursNum,
      ot_type: ot_type || "1.5x",
      reason,
      shift_start_time: shift_start_time || null,
      shift_end_time: shift_end_time || null,
      status: "pending",
      requested_by: session.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ request: data });
}

// DELETE: cancel my own pending OT request
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Confirm ownership + pending status
  const { data: existing } = await supabase
    .from("hr_overtime_requests")
    .select("user_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.user_id !== session.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (existing.status !== "pending") return NextResponse.json({ error: "Only pending can be cancelled" }, { status: 400 });

  const { error } = await supabase
    .from("hr_overtime_requests")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
