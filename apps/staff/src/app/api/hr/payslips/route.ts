import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
// Service-role client: hr_* tables are RLS deny-all, so the anon client returns
// nothing (payslips were invisible to ALL staff since the lockdown). We scope to
// the caller's own user_id below, which is the security boundary here.
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET: my payslips (monthly full-timer runs AND weekly part-timer runs).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Confirmed/paid payroll items for THIS user only. Order by confirmed_at so
  // both cycles interleave correctly — weekly runs have null period_year/month,
  // so month/year ordering would sink them below every monthly payslip.
  const { data: items, error } = await supabaseAdmin
    .from("hr_payroll_items")
    .select("*, hr_payroll_runs!inner(status, cycle_type, period_month, period_year, period_start, period_end, confirmed_at)")
    .eq("user_id", session.id)
    .in("hr_payroll_runs.status", ["confirmed", "paid"])
    .order("confirmed_at", { ascending: false, foreignTable: "hr_payroll_runs" })
    .limit(24);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ payslips: items || [] });
}
