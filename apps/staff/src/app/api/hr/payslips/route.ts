import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET: my payslips
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Get confirmed payroll items for this user
  const { data: items, error } = await supabase
    .from("hr_payroll_items")
    .select("*, hr_payroll_runs!inner(status, period_month, period_year, confirmed_at)")
    .eq("user_id", session.id)
    .in("hr_payroll_runs.status", ["confirmed", "paid"])
    .order("created_at", { ascending: false })
    .limit(12);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ payslips: items || [] });
}
