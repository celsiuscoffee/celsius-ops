import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// GET /api/points/activity?outletId=xxx
// Returns the last point transaction time for an outlet
export async function GET(req: NextRequest) {
  const outletId = req.nextUrl.searchParams.get("outletId");
  if (!outletId) return NextResponse.json({ error: "outletId required" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("point_transactions")
    .select("created_at")
    .eq("outlet_id", outletId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const lastActivity = data?.[0]?.created_at || null;
  const now = new Date();
  const minutesSince = lastActivity
    ? Math.floor((now.getTime() - new Date(lastActivity).getTime()) / 60000)
    : null;

  return NextResponse.json({ lastActivity, minutesSince });
}
