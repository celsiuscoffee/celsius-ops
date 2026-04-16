import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { calculatePayroll } from "@/lib/hr/agents/payroll-calculator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET: list payroll runs + items for a specific run
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const runId = searchParams.get("run_id");

  if (runId) {
    // Get specific run with items
    const [runRes, itemsRes] = await Promise.all([
      hrSupabaseAdmin.from("hr_payroll_runs").select("*").eq("id", runId).single(),
      hrSupabaseAdmin.from("hr_payroll_items").select("*").eq("payroll_run_id", runId).order("basic_salary", { ascending: false }),
    ]);
    return NextResponse.json({ run: runRes.data, items: itemsRes.data });
  }

  // List all runs
  const { data } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .select("*")
    .order("period_year", { ascending: false })
    .order("period_month", { ascending: false })
    .limit(12);

  return NextResponse.json({ runs: data });
}

// POST: compute payroll or confirm
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { action, month, year, run_id } = body;

  if (action === "compute") {
    if (!month || !year) {
      return NextResponse.json({ error: "month and year required" }, { status: 400 });
    }

    // Log agent run
    const { data: agentRun } = await hrSupabaseAdmin
      .from("hr_agent_runs")
      .insert({
        agent_type: "payroll_calculator",
        triggered_by: "manual",
        triggered_by_user_id: session.id,
        status: "running",
        input_summary: { month, year },
      })
      .select()
      .single();

    try {
      const result = await calculatePayroll(month, year);

      if (agentRun) {
        await hrSupabaseAdmin
          .from("hr_agent_runs")
          .update({
            status: "completed",
            output_summary: result,
            items_processed: result.employeeCount,
            completed_at: new Date().toISOString(),
          })
          .eq("id", agentRun.id);
      }

      return NextResponse.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (agentRun) {
        await hrSupabaseAdmin
          .from("hr_agent_runs")
          .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
          .eq("id", agentRun.id);
      }
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (action === "confirm") {
    if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });

    const { data, error } = await hrSupabaseAdmin
      .from("hr_payroll_runs")
      .update({
        status: "confirmed",
        confirmed_by: session.id,
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", run_id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ run: data });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
