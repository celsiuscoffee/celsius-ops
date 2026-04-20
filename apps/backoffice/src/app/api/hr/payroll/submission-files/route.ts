import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import {
  generateMaybankM2uBiz,
  generateKwspFormA,
  generatePerkesoLampiranA,
  generateCP39,
  generateHRDFLevy,
  type EmployeeRow,
  type CompanySettings,
} from "@/lib/hr/statutory/files";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/hr/payroll/submission-files?run_id=...&type=maybank|kwsp|perkeso|cp39|hrdf
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const runId = searchParams.get("run_id");
  const type = searchParams.get("type");
  if (!runId || !type) {
    return NextResponse.json({ error: "run_id and type required" }, { status: 400 });
  }

  // Load run, items, employees, company settings
  const { data: run } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const { data: items } = await hrSupabaseAdmin
    .from("hr_payroll_items")
    .select("*")
    .eq("payroll_run_id", runId);

  const userIds = Array.from(new Set((items || []).map((i: { user_id: string }) => i.user_id)));
  const [users, profiles, companyRes] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, fullName: true, bankName: true, bankAccountNumber: true, bankAccountName: true },
    }),
    hrSupabaseAdmin
      .from("hr_employee_profiles")
      .select("user_id, ic_number, epf_number, socso_number, eis_number, tax_number")
      .in("user_id", userIds),
    hrSupabaseAdmin.from("hr_company_settings").select("*").limit(1).maybeSingle(),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u]));
  const profileMap = new Map(
    (profiles.data || []).map((p: { user_id: string }) => [p.user_id, p]),
  );

  const company: CompanySettings = {
    companyName: companyRes.data?.company_name || "Celsius Coffee Sdn. Bhd.",
    ssmNumber: companyRes.data?.ssm_number || null,
    lhdnENumber: companyRes.data?.lhdn_e_number || null,
    lhdnCNumber: companyRes.data?.lhdn_c_number || null,
    employerEpfNumber: companyRes.data?.employer_epf_number || null,
    employerSocsoNumber: companyRes.data?.employer_socso_number || null,
    employerBankAccount: companyRes.data?.bank_account_number || null,
    employerBankAccountHolder: companyRes.data?.bank_account_holder || null,
    hrdfNumber: companyRes.data?.hrdf_number || null,
  };

  const employees: EmployeeRow[] = (items || []).map((item) => {
    const u = userMap.get(item.user_id);
    const p = profileMap.get(item.user_id) as
      | { ic_number?: string; epf_number?: string; socso_number?: string; eis_number?: string; tax_number?: string }
      | undefined;
    const zakat = Number((item.other_deductions as Record<string, unknown>)?.zakat || 0);
    return {
      userId: item.user_id,
      name: u?.name || "",
      fullName: u?.fullName || null,
      icNumber: p?.ic_number || null,
      epfNumber: p?.epf_number || null,
      socsoNumber: p?.socso_number || null,
      eisNumber: p?.eis_number || null,
      taxNumber: p?.tax_number || null,
      bankName: u?.bankName || null,
      bankAccountNumber: u?.bankAccountNumber || null,
      bankAccountName: u?.bankAccountName || null,
      wage: Number(item.basic_salary || 0),
      epfEmployee: Number(item.epf_employee || 0),
      epfEmployer: Number(item.epf_employer || 0),
      socsoEmployee: Number(item.socso_employee || 0),
      socsoEmployer: Number(item.socso_employer || 0),
      eisEmployee: Number(item.eis_employee || 0),
      eisEmployer: Number(item.eis_employer || 0),
      pcbTax: Number(item.pcb_tax || 0),
      zakat,
      netPay: Number(item.net_pay || 0),
      gross: Number(item.total_gross || 0),
    };
  });

  // Fallback payment date: 3rd of the month AFTER the payroll period. Guard
  // December so month+1 doesn't produce an invalid "YYYY-13-03". Use
  // Date arithmetic which handles the year rollover cleanly.
  let fallbackPaymentDate = run.payment_date as string | null;
  if (!fallbackPaymentDate) {
    const nextPeriod = new Date(Date.UTC(run.period_year, run.period_month, 3));
    fallbackPaymentDate = nextPeriod.toISOString().slice(0, 10);
  }
  const runMeta = {
    period_month: run.period_month,
    period_year: run.period_year,
    payment_date: fallbackPaymentDate,
  };

  let result;
  switch (type) {
    case "maybank":
      result = generateMaybankM2uBiz(runMeta, employees, company);
      break;
    case "kwsp":
      result = generateKwspFormA(runMeta, employees, company);
      break;
    case "perkeso":
      result = generatePerkesoLampiranA(runMeta, employees, company);
      break;
    case "cp39":
      result = generateCP39(runMeta, employees, company);
      break;
    case "hrdf":
      result = generateHRDFLevy(runMeta, employees, company);
      break;
    default:
      return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
  }

  return new NextResponse(result.content, {
    headers: {
      "Content-Type": result.mime,
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "X-Summary": JSON.stringify(result.summary),
    },
  });
}
