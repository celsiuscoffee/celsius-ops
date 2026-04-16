import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET: my upcoming shifts
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = new Date().toISOString().slice(0, 10);

  // Get published schedule shifts for this user from today onwards
  const { data: shifts, error } = await supabase
    .from("hr_schedule_shifts")
    .select("*, hr_schedules!inner(status, outlet_id, week_start)")
    .eq("user_id", session.id)
    .eq("hr_schedules.status", "published")
    .gte("shift_date", today)
    .order("shift_date", { ascending: true })
    .limit(14);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ shifts: shifts || [] });
}
