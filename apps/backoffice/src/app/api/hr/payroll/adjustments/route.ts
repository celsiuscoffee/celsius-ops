import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";

export const dynamic = "force-dynamic";

// Ad-hoc per-run adjustments: edit a single payroll-item's allowances or
// other_deductions jsonb, then recompute that item's total_gross,
// total_deductions, net_pay. Statutory contributions (EPF/SOCSO/EIS/PCB) are
// NOT recomputed here — operators should run a full Recompute on the cycle if
// they need statutory math to follow the change. The endpoint flips a flag in
// computation_details so the wizard can warn when statutory is stale.
//
// Action: 'add' | 'remove'
// Kind:   'allowance' (additions / pre-tax deductions stored in allowances jsonb)
//       | 'deduction' (post-tax deductions stored in other_deductions jsonb)
// Body for 'add': { run_id, item_id, kind, code, label, amount, note? }
// Body for 'remove': { run_id, item_id, kind, code }

type Allowances = Record<string, { amount: number; label?: string; code?: string; note?: string | null }>;
type OtherDeductions = Record<string, unknown>;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { action, run_id, item_id, kind, code, label, amount, note } = body || {};

  if (!run_id || !item_id || !kind || !code) {
    return NextResponse.json({ error: "run_id, item_id, kind, code required" }, { status: 400 });
  }
  if (!["allowance", "deduction"].includes(kind)) {
    return NextResponse.json({ error: "kind must be 'allowance' or 'deduction'" }, { status: 400 });
  }
  if (!["add", "remove"].includes(action)) {
    return NextResponse.json({ error: "action must be 'add' or 'remove'" }, { status: 400 });
  }

  // Don't allow editing confirmed or paid runs.
  const { data: run } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .select("status")
    .eq("id", run_id)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (["confirmed", "paid"].includes(run.status)) {
    return NextResponse.json({ error: `Cannot edit a ${run.status} run` }, { status: 400 });
  }

  const { data: item, error: itemErr } = await hrSupabaseAdmin
    .from("hr_payroll_items")
    .select("*")
    .eq("id", item_id)
    .eq("payroll_run_id", run_id)
    .single();
  if (itemErr || !item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  const allowances: Allowances = (item.allowances as Allowances) || {};
  const other: OtherDeductions = (item.other_deductions as OtherDeductions) || {};

  if (action === "add") {
    if (amount == null || isNaN(Number(amount))) {
      return NextResponse.json({ error: "amount required" }, { status: 400 });
    }
    const numAmount = Number(amount);
    if (numAmount < 0) {
      return NextResponse.json({ error: "amount must be ≥ 0" }, { status: 400 });
    }
    if (kind === "allowance") {
      allowances[code] = { amount: numAmount, label: label || code, code, note: note || null };
    } else {
      other[code] = { amount: numAmount, label: label || code, note: note || null };
    }
  } else {
    // remove
    if (kind === "allowance") delete allowances[code];
    else delete other[code];
  }

  // Recompute totals for this item.
  // total_gross = basic + OT + sum(allowance amounts that are positive)
  // total_deductions = statutory (EPF + SOCSO + EIS + PCB) + sum(other_deductions amounts) + abs(sum negative allowances)
  // net_pay = total_gross - total_deductions
  const basic = Number(item.basic_salary || 0);
  const ot = Number(item.ot_1x_amount || 0)
    + Number(item.ot_1_5x_amount || 0)
    + Number(item.ot_2x_amount || 0)
    + Number(item.ot_3x_amount || 0);

  let allowancePositive = 0;
  let allowanceNegative = 0; // pre-tax deductions stored as negative entries in allowances
  for (const v of Object.values(allowances)) {
    const amt = Number((v as { amount?: number })?.amount || 0);
    if (amt >= 0) allowancePositive += amt;
    else allowanceNegative += Math.abs(amt);
  }

  let otherDedTotal = 0;
  for (const v of Object.values(other)) {
    const amt = typeof v === "number" ? v : Number((v as { amount?: number })?.amount || 0);
    otherDedTotal += amt;
  }

  const newGross = Math.round((basic + ot + allowancePositive - allowanceNegative) * 100) / 100;
  const statutory = Number(item.epf_employee || 0)
    + Number(item.socso_employee || 0)
    + Number(item.eis_employee || 0)
    + Number(item.pcb_tax || 0);
  const newDeductions = Math.round((statutory + otherDedTotal) * 100) / 100;
  const newNet = Math.round((newGross - newDeductions) * 100) / 100;

  // Flag statutory as stale when totals diverge from the original — the
  // operator can decide whether to re-run the full Recompute.
  const compDetails = (item.computation_details as Record<string, unknown> | null) || {};
  const previousGross = Number(item.total_gross || 0);
  const grossChanged = Math.abs(previousGross - newGross) > 0.005;

  const { data: updated, error: updErr } = await hrSupabaseAdmin
    .from("hr_payroll_items")
    .update({
      allowances,
      other_deductions: other,
      total_gross: newGross,
      total_deductions: newDeductions,
      net_pay: newNet,
      computation_details: {
        ...compDetails,
        statutory_stale: grossChanged ? true : compDetails.statutory_stale || false,
      },
    })
    .eq("id", item_id)
    .select()
    .single();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Bump run-level totals — gross / deductions / net are re-summed from the
  // items. total_employer_cost is deliberately NOT: the calculator builds it
  // from EPF + SOCSO + EIS + HRDF employer, and HRDF has no per-item column,
  // so re-summing here silently deleted the HRDF levy from the run header on
  // every adjustment (the same bug items/[item_id] documents, RM635 on July
  // 2026). An allowance / other-deduction adjustment changes no employer
  // statutory component, so the stored header value is left as is.
  const { data: allItems } = await hrSupabaseAdmin
    .from("hr_payroll_items")
    .select("total_gross, total_deductions, net_pay")
    .eq("payroll_run_id", run_id);

  let totalGross = 0, totalDeduct = 0, totalNet = 0;
  for (const it of allItems || []) {
    totalGross += Number(it.total_gross || 0);
    totalDeduct += Number(it.total_deductions || 0);
    totalNet += Number(it.net_pay || 0);
  }

  await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .update({
      total_gross: Math.round(totalGross * 100) / 100,
      total_deductions: Math.round(totalDeduct * 100) / 100,
      total_net: Math.round(totalNet * 100) / 100,
      updated_at: new Date().toISOString(),
    })
    .eq("id", run_id);

  return NextResponse.json({ item: updated });
}
