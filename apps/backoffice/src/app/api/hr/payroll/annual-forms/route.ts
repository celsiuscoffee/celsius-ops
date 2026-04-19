import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import {
  generateEAFormCSV,
  generateFormE_CP8D,
  type EARecord,
} from "@/lib/hr/statutory/annual";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/hr/payroll/annual-forms?year=2026&type=ea|forme|cp8d
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()));
  const type = searchParams.get("type") || "ea";

  // Pull all completed runs for the year
  const { data: runs } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .select("id")
    .eq("period_year", year)
    .in("status", ["confirmed", "paid"]);

  const runIds = (runs || []).map((r: { id: string }) => r.id);
  if (runIds.length === 0) {
    return NextResponse.json({ error: `No confirmed payroll runs found for ${year}` }, { status: 404 });
  }

  // Sum payroll items by user_id across all runs
  const { data: items } = await hrSupabaseAdmin
    .from("hr_payroll_items")
    .select("*")
    .in("payroll_run_id", runIds);

  const byUser = new Map<string, EARecord>();
  for (const item of items || []) {
    const existing = byUser.get(item.user_id);
    const zakat = Number((item.other_deductions as Record<string, unknown>)?.zakat || 0);
    const alloc = item.allowances as Record<string, { amount?: number }> | null;

    // Map BrioHR-style EA categories. B.1(a) = main remuneration, B.1(b) = fees/bonus/profit,
    // B.1(c) = allowances. For now, approximate from existing payroll_items shape.
    const grossBasic = Number(item.basic_salary || 0)
      + Number(item.ot_1x_amount || 0) + Number(item.ot_1_5x_amount || 0)
      + Number(item.ot_2x_amount || 0) + Number(item.ot_3x_amount || 0);

    const allowanceTotal = Object.values(alloc || {})
      .reduce((s, v) => s + Number(v?.amount || 0), 0);

    if (existing) {
      existing.grossRemuneration += grossBasic;
      existing.otherAllowances += allowanceTotal;
      existing.epfEmployee += Number(item.epf_employee || 0);
      existing.socsoEmployee += Number(item.socso_employee || 0);
      existing.pcbTax += Number(item.pcb_tax || 0);
      existing.zakat += zakat;
    } else {
      byUser.set(item.user_id, {
        userId: item.user_id,
        name: "",  // enriched below
        fullName: null,
        icNumber: null,
        taxNumber: null,
        epfNumber: null,
        socsoNumber: null,
        commencementDate: null,
        ceasedDate: null,
        cp8dStatus: "Permanent",
        grossRemuneration: grossBasic,
        feesCommissions: 0,
        otherAllowances: allowanceTotal,
        esopBenefit: 0,
        bikValue: 0,
        livingAccommodation: 0,
        epfEmployee: Number(item.epf_employee || 0),
        socsoEmployee: Number(item.socso_employee || 0),
        pcbTax: Number(item.pcb_tax || 0),
        cp38Deduction: 0,
        zakat,
      });
    }
  }

  // Enrich with User + profile data
  const userIds = Array.from(byUser.keys());
  const [users, profiles] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, fullName: true },
    }),
    hrSupabaseAdmin
      .from("hr_employee_profiles")
      .select("user_id, ic_number, epf_number, socso_number, tax_number, join_date, cp8d_employment_status")
      .in("user_id", userIds),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u]));
  const profMap = new Map((profiles.data || []).map((p: { user_id: string }) => [p.user_id, p]));

  for (const rec of byUser.values()) {
    const u = userMap.get(rec.userId);
    const p = profMap.get(rec.userId) as
      | { ic_number?: string; epf_number?: string; socso_number?: string; tax_number?: string; join_date?: string; cp8d_employment_status?: string }
      | undefined;
    rec.name = u?.name || "";
    rec.fullName = u?.fullName || null;
    rec.icNumber = p?.ic_number || null;
    rec.epfNumber = p?.epf_number || null;
    rec.socsoNumber = p?.socso_number || null;
    rec.taxNumber = p?.tax_number || null;
    rec.commencementDate = p?.join_date || null;
    rec.cp8dStatus = p?.cp8d_employment_status || "Permanent";
  }

  // Company settings
  const { data: companyRow } = await hrSupabaseAdmin
    .from("hr_company_settings")
    .select("*")
    .limit(1)
    .maybeSingle();
  const company = {
    name: companyRow?.company_name || "Celsius Coffee Sdn. Bhd.",
    ssm: companyRow?.ssm_number || null,
    employerNo: companyRow?.lhdn_e_number || null,
  };

  const employees = Array.from(byUser.values()).sort((a, b) =>
    (a.fullName || a.name).localeCompare(b.fullName || b.name),
  );

  if (type === "ea") {
    const result = generateEAFormCSV(year, employees, company);
    return new NextResponse(result.content, {
      headers: {
        "Content-Type": result.mime,
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "X-Summary": JSON.stringify(result.summary),
      },
    });
  }

  if (type === "forme" || type === "cp8d") {
    const bundle = generateFormE_CP8D(year, employees, company);
    const file = type === "forme" ? bundle.formE : bundle.cp8d;
    return new NextResponse(file.content, {
      headers: {
        "Content-Type": file.mime,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "X-Summary": JSON.stringify(bundle.summary),
      },
    });
  }

  return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
}
