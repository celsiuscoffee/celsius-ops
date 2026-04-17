import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { calculateWeeklyPayroll } from "@/lib/hr/agents/payroll-calculator-weekly";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET: list weekly payroll runs, or a specific run with items
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const runId = searchParams.get("run_id");

  if (runId) {
    const [runRes, itemsRes] = await Promise.all([
      hrSupabaseAdmin.from("hr_payroll_runs").select("*").eq("id", runId).single(),
      hrSupabaseAdmin
        .from("hr_payroll_items")
        .select("*")
        .eq("payroll_run_id", runId)
        .order("total_gross", { ascending: false }),
    ]);
    return NextResponse.json({ run: runRes.data, items: itemsRes.data });
  }

  const { data } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .select("*")
    .eq("cycle_type", "weekly")
    .order("period_start", { ascending: false })
    .limit(26);

  return NextResponse.json({ runs: data });
}

// POST: compute or confirm a weekly run
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { action, week_start, run_id } = body;

  if (action === "compute") {
    if (!week_start) {
      return NextResponse.json({ error: "week_start (YYYY-MM-DD Monday) required" }, { status: 400 });
    }

    const { data: agentRun } = await hrSupabaseAdmin
      .from("hr_agent_runs")
      .insert({
        agent_type: "payroll_calculator",
        triggered_by: "manual",
        triggered_by_user_id: session.id,
        status: "running",
        input_summary: { cycle: "weekly", week_start },
      })
      .select()
      .single();

    try {
      const result = await calculateWeeklyPayroll(week_start);

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
