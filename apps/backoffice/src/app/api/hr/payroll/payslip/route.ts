import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { generatePayslipPDF, generatePayslipBundlePDF, type PayslipData } from "@/lib/hr/statutory/payslip";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/hr/payroll/payslip?run_id=X[&user_id=Y]
// If user_id omitted → bundle all employees in one PDF.
export async function GET(req: NextRequest) {
  try {
    return await handle(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : "PDF generation failed";
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[payslip] generation error:", stack || message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handle(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const runId = searchParams.get("run_id");
  const userId = searchParams.get("user_id");
  if (!runId) return NextResponse.json({ error: "run_id required" }, { status: 400 });

  // Staff can only view their own; OWNER/ADMIN can view any.
  const canViewAll = ["OWNER", "ADMIN"].includes(session.role);
  const targetUserId = canViewAll ? userId : session.id;
  if (!canViewAll && userId && userId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: run } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const itemsQuery = hrSupabaseAdmin.from("hr_payroll_items").select("*").eq("payroll_run_id", runId);
  if (targetUserId) itemsQuery.eq("user_id", targetUserId);
  const { data: items } = await itemsQuery;
  if (!items || items.length === 0) {
    return NextResponse.json({ error: "No payroll items found" }, { status: 404 });
  }

  // YTD per user for the employee(s)
  const userIds = items.map((i: { user_id: string }) => i.user_id);
  const { data: priorRuns } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .select("id")
    .eq("period_year", run.period_year)
    .lt("period_month", run.period_month)
    .in("status", ["confirmed", "paid"]);
  const priorRunIds = (priorRuns || []).map((r: { id: string }) => r.id);
  const ytdByUser = new Map<string, { gross: number; epf: number; socso: number; pcb: number }>();
  if (priorRunIds.length > 0) {
    const { data: priorItems } = await hrSupabaseAdmin
      .from("hr_payroll_items")
      .select("user_id, total_gross, epf_employee, socso_employee, pcb_tax")
      .in("payroll_run_id", priorRunIds)
      .in("user_id", userIds);
    for (const p of priorItems || []) {
      const ex = ytdByUser.get(p.user_id) || { gross: 0, epf: 0, socso: 0, pcb: 0 };
      ex.gross += Number(p.total_gross || 0);
      ex.epf += Number(p.epf_employee || 0);
      ex.socso += Number(p.socso_employee || 0);
      ex.pcb += Number(p.pcb_tax || 0);
      ytdByUser.set(p.user_id, ex);
    }
  }
  // Include current run in YTD
  for (const it of items) {
    const ex = ytdByUser.get(it.user_id) || { gross: 0, epf: 0, socso: 0, pcb: 0 };
    ex.gross += Number(it.total_gross || 0);
    ex.epf += Number(it.epf_employee || 0);
    ex.socso += Number(it.socso_employee || 0);
    ex.pcb += Number(it.pcb_tax || 0);
    ytdByUser.set(it.user_id, ex);
  }

  // Enrich with user + profile + company
  const [users, profiles, companyRes] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, fullName: true, bankName: true, bankAccountNumber: true, outlet: { select: { name: true } } },
    }),
    hrSupabaseAdmin
      .from("hr_employee_profiles")
      .select("user_id, ic_number, position, epf_number, socso_number, tax_number")
      .in("user_id", userIds),
    hrSupabaseAdmin.from("hr_company_settings").select("*").limit(1).maybeSingle(),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u]));
  const profMap = new Map((profiles.data || []).map((p: { user_id: string }) => [p.user_id, p]));
  const company = companyRes.data;

  const records: PayslipData[] = items.map((it) => {
    const u = userMap.get(it.user_id);
    const p = profMap.get(it.user_id) as
      | { ic_number?: string; position?: string; epf_number?: string; socso_number?: string; tax_number?: string }
      | undefined;
    const ytd = ytdByUser.get(it.user_id);
    const alloc = (it.allowances as Record<string, { amount: number; base?: number }> | null) || {};
    const allowanceList = Object.entries(alloc)
      .map(([k, v]) => ({ label: prettyAllowance(k), amount: Number(v?.amount || 0) }))
      .filter((a) => a.amount > 0);

    // Catch-all for earnings not itemized into OT or allowances.
    // BrioHR-imported rows store the gap in computation_details.gross_additions.
    // Also detect residual gap if none of the itemized lines explain total_gross.
    const compDetails = (it.computation_details as Record<string, unknown> | null) || {};
    const otherEarnings: { label: string; amount: number }[] = [];
    const briohrAdditions = Number(compDetails.gross_additions || 0);
    if (briohrAdditions > 0) {
      const label = compDetails.source === "briohr_import" ? "Additions (imported)" : "Additions";
      otherEarnings.push({ label, amount: briohrAdditions });
    }

    const other = (it.other_deductions as Record<string, unknown>) || {};
    const unpaidLeave = Number(other.unpaid_leave || 0);
    const zakat = Number(other.zakat || 0);
    const reviewPenalty = Number((other.review_penalty as { amount?: number })?.amount || 0);
    const otherDeductions: { label: string; amount: number }[] = [];
    for (const [k, v] of Object.entries(other)) {
      if (["unpaid_leave", "zakat", "review_penalty"].includes(k)) continue;
      const amt = typeof v === "number" ? v : Number((v as { amount?: number })?.amount || 0);
      if (amt > 0) otherDeductions.push({ label: prettyAllowance(k), amount: amt });
    }

    return {
      employeeName: u?.name || "—",
      employeeFullName: u?.fullName || null,
      icNumber: p?.ic_number || null,
      position: p?.position || null,
      outlet: u?.outlet?.name || null,
      epfNumber: p?.epf_number || null,
      socsoNumber: p?.socso_number || null,
      taxNumber: p?.tax_number || null,
      bankName: u?.bankName || null,
      bankAccountNumber: u?.bankAccountNumber || null,
      periodMonth: run.period_month,
      periodYear: run.period_year,
      paymentDate: run.payment_date || null,
      basicSalary: Number(it.basic_salary || 0),
      regularHours: Number(it.total_regular_hours || 0),
      otHours: Number(it.total_ot_hours || 0),
      ot1xAmount: Number(it.ot_1x_amount || 0),
      ot1_5xAmount: Number(it.ot_1_5x_amount || 0),
      ot2xAmount: Number(it.ot_2x_amount || 0),
      ot3xAmount: Number(it.ot_3x_amount || 0),
      allowances: allowanceList,
      otherEarnings,
      gross: Number(it.total_gross || 0),
      epfEmployee: Number(it.epf_employee || 0),
      socsoEmployee: Number(it.socso_employee || 0),
      eisEmployee: Number(it.eis_employee || 0),
      pcbTax: Number(it.pcb_tax || 0),
      zakat,
      unpaidLeave,
      reviewPenalty,
      otherDeductions,
      totalDeductions: Number(it.total_deductions || 0),
      netPay: Number(it.net_pay || 0),
      epfEmployer: Number(it.epf_employer || 0),
      socsoEmployer: Number(it.socso_employer || 0),
      eisEmployer: Number(it.eis_employer || 0),
      ytdGross: ytd?.gross,
      ytdEpf: ytd?.epf,
      ytdSocso: ytd?.socso,
      ytdPcb: ytd?.pcb,
      companyName: company?.company_name || "Celsius Coffee Sdn. Bhd.",
      companySSM: company?.ssm_number || null,
      companyAddress: [company?.address_line1, company?.address_line2, company?.postcode, company?.city, company?.country]
        .filter(Boolean).join(", ") || null,
      companyLhdnE: company?.lhdn_e_number || null,
      disclaimer: company?.payslip_disclaimer_enabled ? company?.payslip_disclaimer_text : null,
    };
  });

  const pdfBytes = records.length === 1
    ? await generatePayslipPDF(records[0])
    : await generatePayslipBundlePDF(records);

  const filename = records.length === 1
    ? `PAYSLIP_${records[0].employeeName.replace(/\s+/g, "_")}_${run.period_year}${String(run.period_month).padStart(2, "0")}.pdf`
    : `PAYSLIPS_${run.period_year}${String(run.period_month).padStart(2, "0")}.pdf`;

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function prettyAllowance(key: string): string {
  const map: Record<string, string> = {
    attendance: "Attendance Allowance",
    performance: "Performance Allowance",
    unpaid_leave: "Unpaid Leave",
    zakat: "Zakat",
    review_penalty: "Review Penalty",
  };
  return map[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
