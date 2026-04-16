import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET: my attendance history
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const days = parseInt(searchParams.get("days") || "30");

  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await supabase
    .from("hr_attendance_logs")
    .select("id, clock_in, clock_out, total_hours, regular_hours, overtime_hours, overtime_type, ai_status, ai_flags, final_status, outlet_id")
    .eq("user_id", session.id)
    .gte("clock_in", since.toISOString())
    .order("clock_in", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Aggregate stats for the period
  const totalHours = (data || []).reduce((sum, a) => sum + (Number(a.total_hours) || 0), 0);
  const totalOT = (data || []).reduce((sum, a) => sum + (Number(a.overtime_hours) || 0), 0);
  const daysWorked = new Set((data || []).map((a) => a.clock_in.slice(0, 10))).size;

  return NextResponse.json({
    logs: data || [],
    stats: {
      totalHours: Math.round(totalHours * 100) / 100,
      totalOT: Math.round(totalOT * 100) / 100,
      daysWorked,
      period: days,
    },
  });
}
