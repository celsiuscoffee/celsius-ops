import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";

export const dynamic = "force-dynamic";

// Direct override of any numeric field on a payroll item — basic salary,
// OT amounts/hours, statutory deductions, or specific allowance / other_deduction
// jsonb entries. Used by the run wizard for ad-hoc corrections (e.g. salary
// bump backdated, OT not captured by attendance, statutory cap edge cases).
//
// After write: recompute total_gross / total_deductions / net_pay on the line
// AND bump run-level totals. Sets computation_details.manual_overrides[field]
// = { at, by, prev } so audit trail survives.
//
// PATCH /api/hr/payroll/items/[item_id]
// body: {
//   basic_salary?, total_ot_hours?,
//   ot_1x_amount?, ot_1_5x_amount?, ot_2x_amount?, ot_3x_amount?,
//   epf_employee?, socso_employee?, eis_employee?, pcb_tax?,
//   epf_employer?, socso_employer?, eis_employer?,
//   allowance?: { code, amount },
//   other_deduction?: { code, amount },
//   note?: string,
// }
type OverrideBody = {
  basic_salary?: number;
  total_ot_hours?: number;
  ot_1x_amount?: number;
  ot_1_5x_amount?: number;
  ot_2x_amount?: number;
  ot_3x_amount?: number;
  epf_employee?: number;
  socso_employee?: number;
  eis_employee?: number;
  pcb_tax?: number;
  epf_employer?: number;
  socso_employer?: number;
  eis_employer?: number;
  allowance?: { code: string; amount: number; label?: string };
  other_deduction?: { code: string; amount: number; label?: string };
  note?: string;
};

const NUMERIC_FIELDS: Array<keyof OverrideBody> = [
  "basic_salary",
  "total_ot_hours",
  "ot_1x_amount",
  "ot_1_5x_amount",
  "ot_2x_amount",
  "ot_3x_amount",
  "epf_employee",
  "socso_employee",
  "eis_employee",
  "pcb_tax",
  "epf_employer",
  "socso_employer",
  "eis_employer",
];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ item_id: string }> }) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { item_id } = await params;
  const body = (await req.json()) as OverrideBody;

  const { data: item, error: itemErr } = await hrSupabaseAdmin
    .from("hr_payroll_items")
    .select("*")
    .eq("id", item_id)
    .single();
  if (itemErr || !item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  // Don't allow editing confirmed/paid runs.
  const { data: run } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .select("status, id")
    .eq("id", item.payroll_run_id)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (["confirmed", "paid"].includes(run.status)) {
    return NextResponse.json({ error: `Cannot edit a ${run.status} run` }, { status: 400 });
  }

  // Build patch + audit trail
  const patch: Record<string, number | unknown> = {};
  const overrides: Record<string, { at: string; by: string; prev: number }> = (
    (item.computation_details as { manual_overrides?: Record<string, { at: string; by: string; prev: number }> } | null)
      ?.manual_overrides ?? {}
  );
  const now = new Date().toISOString();

  for (const f of NUMERIC_FIELDS) {
    const next = body[f];
    if (next === undefined) continue;
    if (typeof next !== "number" || isNaN(next) || next < 0) {
      return NextResponse.json({ error: `Invalid ${f}` }, { status: 400 });
    }
    const prev = Number((item as Record<string, unknown>)[f] ?? 0);
    if (Math.abs(prev - next) < 0.005) continue; // no real change
    patch[f] = Math.round(next * 100) / 100;
    overrides[f] = { at: now, by: session.id, prev };
  }

  // Allowance / other_deduction jsonb edit
  type AllowEntry = { amount: number; label?: string; code?: string; note?: string | null };
  const allowances: Record<string, AllowEntry> = (item.allowances as Record<string, AllowEntry>) || {};
  const other: Record<string, unknown> = (item.other_deductions as Record<string, unknown>) || {};

  if (body.allowance) {
    const { code, amount, label } = body.allowance;
    if (typeof amount !== "number" || isNaN(amount)) {
      return NextResponse.json({ error: "allowance.amount must be a number" }, { status: 400 });
    }
    const prev = Number(allowances[code]?.amount ?? 0);
    allowances[code] = {
      ...(allowances[code] || {}),
      amount: Math.round(amount * 100) / 100,
      code,
      label: label ?? allowances[code]?.label ?? code,
    };
    patch.allowances = allowances;
    overrides[`allowance.${code}`] = { at: now, by: session.id, prev };
  }

  if (body.other_deduction) {
    const { code, amount, label } = body.other_deduction;
    if (typeof amount !== "number" || isNaN(amount)) {
      return NextResponse.json({ error: "other_deduction.amount must be a number" }, { status: 400 });
    }
    const existingEntry = other[code];
    const prev = typeof existingEntry === "number"
      ? existingEntry
      : Number((existingEntry as { amount?: number })?.amount ?? 0);
    other[code] = {
      amount: Math.round(amount * 100) / 100,
      label: label ?? (existingEntry as { label?: string })?.label ?? code,
    };
    patch.other_deductions = other;
    overrides[`other_deduction.${code}`] = { at: now, by: session.id, prev };
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Recompute derived totals from the merged state.
  const merged = { ...(item as Record<string, unknown>), ...patch };
  const basic = Number(merged.basic_salary || 0);
  const ot = Number(merged.ot_1x_amount || 0)
    + Number(merged.ot_1_5x_amount || 0)
    + Number(merged.ot_2x_amount || 0)
    + Number(merged.ot_3x_amount || 0);

  // allowances jsonb: positive entries = additions, negative = pre-tax deductions
  let allowancePositive = 0;
  let allowanceNegative = 0;
  for (const v of Object.values(merged.allowances as Record<string, AllowEntry> || {})) {
    const amt = Number((v as { amount?: number })?.amount || 0);
    if (amt >= 0) allowancePositive += amt;
    else allowanceNegative += Math.abs(amt);
  }

  let otherDedTotal = 0;
  for (const v of Object.values(merged.other_deductions as Record<string, unknown> || {})) {
    const amt = typeof v === "number" ? v : Number((v as { amount?: number })?.amount || 0);
    otherDedTotal += amt;
  }

  const newGross = Math.round((basic + ot + allowancePositive - allowanceNegative) * 100) / 100;
  const statutory = Number(merged.epf_employee || 0)
    + Number(merged.socso_employee || 0)
    + Number(merged.eis_employee || 0)
    + Number(merged.pcb_tax || 0);
  const newDeductions = Math.round((statutory + otherDedTotal) * 100) / 100;
  const newNet = Math.round((newGross - newDeductions) * 100) / 100;

  patch.total_gross = newGross;
  patch.total_deductions = newDeductions;
  patch.net_pay = newNet;
  patch.computation_details = {
    ...(item.computation_details as Record<string, unknown> || {}),
    manual_overrides: overrides,
    last_override_note: body.note || null,
    last_override_at: now,
    last_override_by: session.id,
  };

  const { data: updated, error: updErr } = await hrSupabaseAdmin
    .from("hr_payroll_items")
    .update(patch)
    .eq("id", item_id)
    .select()
    .single();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Bump run-level totals.
  const { data: allItems } = await hrSupabaseAdmin
    .from("hr_payroll_items")
    .select("total_gross, total_deductions, net_pay, epf_employer, socso_employer, eis_employer")
    .eq("payroll_run_id", run.id);
  let totalGross = 0, totalDeduct = 0, totalNet = 0, totalEmployerCost = 0;
  for (const it of allItems || []) {
    totalGross += Number(it.total_gross || 0);
    totalDeduct += Number(it.total_deductions || 0);
    totalNet += Number(it.net_pay || 0);
    totalEmployerCost += Number(it.epf_employer || 0) + Number(it.socso_employer || 0) + Number(it.eis_employer || 0);
  }
  await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .update({
      total_gross: Math.round(totalGross * 100) / 100,
      total_deductions: Math.round(totalDeduct * 100) / 100,
      total_net: Math.round(totalNet * 100) / 100,
      total_employer_cost: Math.round(totalEmployerCost * 100) / 100,
      updated_at: now,
    })
    .eq("id", run.id);

  return NextResponse.json({ item: updated });
}
