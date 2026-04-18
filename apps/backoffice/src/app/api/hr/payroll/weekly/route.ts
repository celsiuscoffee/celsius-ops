import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
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
    const items = itemsRes.data || [];
    // Enrich with user name + bank details + hourly_rate for display + payment
    const userIds = Array.from(new Set(items.map((i: { user_id: string }) => i.user_id)));
    const [users, profiles] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, fullName: true, bankName: true, bankAccountNumber: true, bankAccountName: true },
      }),
      hrSupabaseAdmin
        .from("hr_employee_profiles")
        .select("user_id, hourly_rate, position, employment_type")
        .in("user_id", userIds),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const profileMap = new Map((profiles.data || []).map((p: { user_id: string }) => [p.user_id, p]));
    const enriched = items.map((item: { user_id: string; [k: string]: unknown }) => {
      const u = userMap.get(item.user_id);
      const p = profileMap.get(item.user_id) as { hourly_rate?: number; position?: string; employment_type?: string } | undefined;
      return {
        ...item,
        name: u?.name || null,
        fullName: u?.fullName || null,
        bankName: u?.bankName || null,
        bankAccountNumber: u?.bankAccountNumber || null,
        bankAccountName: u?.bankAccountName || null,
        hourly_rate: p?.hourly_rate ? Number(p.hourly_rate) : null,
        position: p?.position || null,
        employment_type: p?.employment_type || null,
      };
    });
    return NextResponse.json({ run: runRes.data, items: enriched });
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

  // Mark the run as paid (after bank transfer is done)
  if (action === "mark_paid") {
    if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });
    const { data, error } = await hrSupabaseAdmin
      .from("hr_payroll_runs")
      .update({ status: "paid", ai_notes: `Paid by ${session.id} at ${new Date().toISOString()}` })
      .eq("id", run_id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ run: data });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// PATCH: adjust hours/rate/gross on a single payroll item (manual edit).
// body: { item_id, hours?, hourly_rate?, ot_hours?, notes? }
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const { item_id, hours, hourly_rate, ot_hours, notes } = body as {
    item_id: string; hours?: number; hourly_rate?: number; ot_hours?: number; notes?: string;
  };
  if (!item_id) return NextResponse.json({ error: "item_id required" }, { status: 400 });

  const { data: existing } = await hrSupabaseAdmin
    .from("hr_payroll_items")
    .select("*")
    .eq("id", item_id)
    .single();
  if (!existing) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  const newHours = hours !== undefined ? Number(hours) : Number(existing.total_regular_hours || 0);
  const newRate = hourly_rate !== undefined
    ? Number(hourly_rate)
    : Number(existing.computation_details?.hourly_rate || 0);
  const newOtHours = ot_hours !== undefined ? Number(ot_hours) : Number(existing.total_ot_hours || 0);

  // Recompute gross from hours × rate (+ OT @ 1.5x). Keep it simple for PT.
  const regPay = newHours * newRate;
  const otPay = newOtHours * newRate * 1.5;
  const newGross = Math.round((regPay + otPay) * 100) / 100;

  const compDetails = {
    ...(existing.computation_details || {}),
    hourly_rate: newRate,
    manually_adjusted: true,
    adjusted_by: session.id,
    adjusted_at: new Date().toISOString(),
    adjustment_notes: notes,
  };

  const { data, error } = await hrSupabaseAdmin
    .from("hr_payroll_items")
    .update({
      total_regular_hours: newHours,
      total_ot_hours: newOtHours,
      total_gross: newGross,
      net_pay: newGross, // PT has no statutory deductions
      computation_details: compDetails,
    })
    .eq("id", item_id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Recompute run totals
  const { data: allItems } = await hrSupabaseAdmin
    .from("hr_payroll_items")
    .select("total_gross, net_pay, total_deductions")
    .eq("payroll_run_id", existing.payroll_run_id);
  const totalGross = (allItems || []).reduce((s: number, i: { total_gross: number }) => s + Number(i.total_gross || 0), 0);
  const totalNet = (allItems || []).reduce((s: number, i: { net_pay: number }) => s + Number(i.net_pay || 0), 0);
  const totalDed = (allItems || []).reduce((s: number, i: { total_deductions: number }) => s + Number(i.total_deductions || 0), 0);
  await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .update({
      total_gross: Math.round(totalGross * 100) / 100,
      total_net: Math.round(totalNet * 100) / 100,
      total_deductions: Math.round(totalDed * 100) / 100,
    })
    .eq("id", existing.payroll_run_id);

  return NextResponse.json({ item: data });
}
