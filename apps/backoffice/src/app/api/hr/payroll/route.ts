import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { calculatePayroll } from "@/lib/hr/agents/payroll-calculator";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // payroll compute can take 1-2 min for 40 staff

// GET: list payroll runs + items for a specific run
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const runId = searchParams.get("run_id");

  if (runId) {
    // Get specific run with items — enrich each item with the employee's name
    const [runRes, itemsRes] = await Promise.all([
      hrSupabaseAdmin.from("hr_payroll_runs").select("*").eq("id", runId).single(),
      hrSupabaseAdmin.from("hr_payroll_items").select("*").eq("payroll_run_id", runId).order("basic_salary", { ascending: false }),
    ]);
    const items = itemsRes.data ?? [];
    const userIds = Array.from(new Set(items.map((i: { user_id: string }) => i.user_id).filter(Boolean)));
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, fullName: true },
        })
      : [];
    const nameMap = new Map(users.map((u) => [u.id, u.fullName || u.name]));
    const enriched = items.map((i: { user_id: string }) => ({
      ...i,
      employee_name: nameMap.get(i.user_id) ?? i.user_id.slice(0, 8),
    }));
    return NextResponse.json({ run: runRes.data, items: enriched });
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

// DELETE /api/hr/payroll?run_id=X — remove a payroll run + its items.
// Only allowed for runs in draft/ai_computed status (not yet paid).
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = new URL(req.url).searchParams.get("run_id");
  if (!runId) return NextResponse.json({ error: "run_id required" }, { status: 400 });

  // Guard: don't allow deleting paid runs — they're historical.
  const { data: run } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .select("status")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (run.status === "paid") {
    return NextResponse.json({ error: "Cannot delete a paid payroll run. Revert status first." }, { status: 400 });
  }

  // Items first (no FK cascade on hr_payroll_items)
  await hrSupabaseAdmin.from("hr_payroll_items").delete().eq("payroll_run_id", runId);
  const { error } = await hrSupabaseAdmin.from("hr_payroll_runs").delete().eq("id", runId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
