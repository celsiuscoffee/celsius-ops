import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { calculatePayroll } from "@/lib/hr/agents/payroll-calculator";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";

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
          select: { id: true, name: true, fullName: true, bankAccountNumber: true, bankName: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    const enriched = items.map((i: { user_id: string }) => {
      const u = userMap.get(i.user_id);
      return {
        ...i,
        employee_name: u?.fullName || u?.name || i.user_id.slice(0, 8),
        bank_account_number: u?.bankAccountNumber ?? null,
        bank_name: u?.bankName ?? null,
      };
    });
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
  const { action, month, year, run_id, allow_early_confirm } = body;

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

    // Refuse to confirm a cycle that is still running.
    //
    // Computing early is fine and often useful — previewing cash needs, checking
    // a new joiner's prorated figure. The run sits at 'ai_computed' and hurts
    // nobody. CONFIRM is the irreversible step: it is what payslips and the bank
    // file are generated from. Confirming mid-cycle books attendance that has not
    // happened yet, so OT is 0 and the performance levers score an empty month.
    // The Aug 2026 run was computed on 1 August with 0 regular hours and 0 OT
    // across all 28 lines, and nothing here would have stopped it being paid.
    //
    // Escape hatch: payday lands on or near the last working day, so preparing on
    // the 29th for a 31st payday is legitimate. Pass allow_early_confirm to do it
    // deliberately — the point is that it cannot happen by accident.
    const { data: cycle } = await hrSupabaseAdmin
      .from("hr_payroll_runs")
      .select("period_year, period_month, period_end, cycle_type")
      .eq("id", run_id)
      .maybeSingle();

    if (cycle && !allow_early_confirm) {
      // Cycle end in MYT (UTC+8), not UTC — otherwise the guard would keep
      // blocking until 08:00 local on the 1st.
      let cycleEndMs: number | null = null;
      if (cycle.period_end) {
        cycleEndMs = Date.parse(`${cycle.period_end}T23:59:59+08:00`);
      } else if (cycle.period_year && cycle.period_month) {
        const lastDay = new Date(cycle.period_year, cycle.period_month, 0).getDate();
        const mm = String(cycle.period_month).padStart(2, "0");
        cycleEndMs = Date.parse(`${cycle.period_year}-${mm}-${String(lastDay).padStart(2, "0")}T23:59:59+08:00`);
      }

      if (cycleEndMs != null && !Number.isNaN(cycleEndMs) && Date.now() < cycleEndMs) {
        const daysLeft = Math.ceil((cycleEndMs - Date.now()) / 86_400_000);
        return NextResponse.json(
          {
            error:
              `This ${cycle.cycle_type || "payroll"} cycle has not ended — ${daysLeft} day${daysLeft === 1 ? "" : "s"} left. `
              + `Attendance for the rest of it does not exist yet, so overtime and attendance-based allowances are incomplete. `
              + `Recompute after the cycle ends, or confirm deliberately with allow_early_confirm if you are paying before month end.`,
            reason: "cycle_not_ended",
            cycleEndsAt: new Date(cycleEndMs).toISOString(),
            daysLeft,
          },
          { status: 409 },
        );
      }
    }

    // Only a not-yet-confirmed run can be confirmed. The status filter makes
    // this atomic: a concurrent double-confirm — or confirming an already-paid
    // run, which would otherwise silently DOWNGRADE it back to "confirmed" and
    // desync the bank files already generated from it — matches zero rows on
    // the losing call instead of racing. maybeSingle() then returns null, and
    // we read the current status to return a clear 409.
    const { data, error } = await hrSupabaseAdmin
      .from("hr_payroll_runs")
      .update({
        status: "confirmed",
        confirmed_by: session.id,
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", run_id)
      .in("status", ["ai_computed", "draft"])
      .select()
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) {
      const { data: cur } = await hrSupabaseAdmin
        .from("hr_payroll_runs")
        .select("status")
        .eq("id", run_id)
        .maybeSingle();
      if (!cur) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
      return NextResponse.json(
        { error: `Payroll run is already ${cur.status}; only a computed or draft run can be confirmed.` },
        { status: 409 },
      );
    }

    await logActivity({
      actorId: session.id,
      action: "payroll.confirm",
      module: "hr",
      targetId: run_id,
      targetName: data ? `${data.cycle_type} ${data.period_month}/${data.period_year}` : null,
      details: {
        total_net: data?.total_net,
        total_gross: data?.total_gross,
        // Recorded so an early confirm is auditable after the fact, not just
        // refused up front.
        ...(allow_early_confirm ? { early_confirm: true } : {}),
      },
      request: req,
    });
    return NextResponse.json({ run: data });
  }

  // REVERT — take a confirmed run back to ai_computed so it can be recomputed.
  //
  // This exists because DELETE now refuses confirmed runs (see below). Before,
  // the only way to redo a confirmed month was to delete it outright, which is
  // how the opening balance and then the whole of July 2026 were destroyed on
  // 2026-08-03. Reverting keeps the run and its id; recompute replaces the
  // lines in place.
  //
  // `paid` is not revertable here on purpose: bank files have already been
  // generated from it, so undoing it is a finance decision, not a click.
  if (action === "revert") {
    if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });

    const { data, error } = await hrSupabaseAdmin
      .from("hr_payroll_runs")
      .update({
        status: "ai_computed",
        confirmed_by: null,
        confirmed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", run_id)
      .eq("status", "confirmed")
      .select()
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) {
      const { data: current } = await hrSupabaseAdmin
        .from("hr_payroll_runs").select("status").eq("id", run_id).maybeSingle();
      if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(
        {
          error: current.status === "paid"
            ? "This run is already PAID. Bank files were generated from it — reverting is a finance decision, not a UI action."
            : `Only a confirmed run can be reverted (this one is ${current.status}).`,
          currentStatus: current.status,
        },
        { status: 409 },
      );
    }

    await logActivity({
      actorId: session.id,
      action: "payroll.revert",
      module: "hr",
      targetId: run_id,
      targetName: `${data.cycle_type} ${data.period_month}/${data.period_year}`,
      details: { from: "confirmed", to: "ai_computed", total_net: data.total_net },
      request: req,
    });
    return NextResponse.json({ run: data });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// DELETE /api/hr/payroll?run_id=X — remove a payroll run + its items.
//
// Only `draft` and `ai_computed` runs can be deleted. A CONFIRMED run is the
// thing payslips and bank files are generated from, and this endpoint used to
// wave it through — the guard checked `paid` alone. That cost real data twice
// on 2026-08-03: the `opening_balance` run (taking BrioHR's Jan–Jun YTD for 34
// people, which understated Ariff's July PCB by RM446) and then the entire July
// monthly run, deleted 22 seconds after it was recomputed. Neither delete left
// a trace, because this route never logged one.
//
// To redo a confirmed month, POST action=revert first. That is one deliberate
// extra step, and it keeps the run id and the audit trail.
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = new URL(req.url).searchParams.get("run_id");
  if (!runId) return NextResponse.json({ error: "run_id required" }, { status: 400 });

  const { data: run } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .select("status, cycle_type, period_month, period_year, total_net")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (run.status === "paid" || run.status === "confirmed") {
    return NextResponse.json(
      {
        error: run.status === "paid"
          ? "Cannot delete a PAID payroll run — bank files were generated from it."
          : "Cannot delete a CONFIRMED payroll run. Revert it to ai_computed first (POST action=revert), then recompute — that replaces the lines without destroying the run.",
        currentStatus: run.status,
      },
      { status: 400 },
    );
  }

  // How many lines are about to go, so the log records the size of the loss and
  // not merely that something happened.
  const { count: itemCount } = await hrSupabaseAdmin
    .from("hr_payroll_items")
    .select("id", { count: "exact", head: true })
    .eq("payroll_run_id", runId);

  // Items first (no FK cascade on hr_payroll_items)
  await hrSupabaseAdmin.from("hr_payroll_items").delete().eq("payroll_run_id", runId);
  const { error } = await hrSupabaseAdmin.from("hr_payroll_runs").delete().eq("id", runId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity({
    actorId: session.id,
    action: "payroll.delete",
    module: "hr",
    targetId: runId,
    targetName: `${run.cycle_type} ${run.period_month}/${run.period_year}`,
    details: { status: run.status, items_deleted: itemCount ?? null, total_net: run.total_net },
    request: req,
  });

  return NextResponse.json({ ok: true, itemsDeleted: itemCount ?? null });
}
