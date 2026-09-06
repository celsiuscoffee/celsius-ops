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
  generatePayrollByOutlet,
  type EmployeeRow,
  type CompanySettings,
} from "@/lib/hr/statutory/files";
import { logActivity } from "@/lib/activity-log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/hr/payroll/submission-files?run_id=...&type=maybank|kwsp|perkeso|cp39|hrdf
/**
 * Shifts worked per outlet in the run's pay period, for the staff whose cost
 * the by-outlet export should SPLIT: rotating multi-outlet staff, anyone who
 * clocked in at more than one outlet, and anyone with no home outlet who
 * worked somewhere. Owner 2026-09-03 (Syafiq): "divided based on the shifts
 * work in each outlet." Real, non-rejected logs only; MYT month bounds.
 */
async function outletSharesForRun(
  run: { period_year: number; period_month: number; period_start?: string | null; period_end?: string | null },
  userIds: string[],
  homeOutlet: Map<string, string | null>,
): Promise<Map<string, Array<{ outlet: string; shifts: number }>>> {
  const out = new Map<string, Array<{ outlet: string; shifts: number }>>();
  if (userIds.length === 0) return out;
  const mm = String(run.period_month).padStart(2, "0");
  const startDate = run.period_start || `${run.period_year}-${mm}-01`;
  const endDate = run.period_end
    ? new Date(Date.parse(`${run.period_end}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    : run.period_month === 12 ? `${run.period_year + 1}-01-01` : `${run.period_year}-${String(run.period_month + 1).padStart(2, "0")}-01`;
  const startIso = new Date(`${startDate}T00:00:00+08:00`).toISOString();
  const endIso = new Date(`${endDate}T00:00:00+08:00`).toISOString();

  const [{ data: logs }, { data: profiles }] = await Promise.all([
    hrSupabaseAdmin
      .from("hr_attendance_logs")
      .select("user_id, outlet_id, final_status, clock_in_method")
      .in("user_id", userIds)
      .gte("clock_in", startIso)
      .lt("clock_in", endIso)
      .neq("clock_in_method", "ot_approval")
      .limit(5000),
    hrSupabaseAdmin
      .from("hr_employee_profiles")
      .select("user_id, is_rotating_multi_outlet")
      .in("user_id", userIds),
  ]);
  const rotating = new Set(
    (profiles || []).filter((p) => p.is_rotating_multi_outlet === true).map((p) => p.user_id as string),
  );

  const counts = new Map<string, Map<string, number>>();
  for (const l of (logs || []) as Array<{ user_id: string; outlet_id: string | null; final_status: string | null }>) {
    if (!l.outlet_id || l.final_status === "rejected") continue;
    const per = counts.get(l.user_id) || new Map<string, number>();
    per.set(l.outlet_id, (per.get(l.outlet_id) || 0) + 1);
    counts.set(l.user_id, per);
  }
  const outletIds = Array.from(new Set([...counts.values()].flatMap((m) => [...m.keys()])));
  const outlets = outletIds.length > 0
    ? await prisma.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true } })
    : [];
  const outletName = new Map(outlets.map((o) => [o.id, o.name]));

  for (const [userId, per] of counts) {
    const split = rotating.has(userId) || per.size > 1 || !homeOutlet.get(userId);
    if (!split) continue;
    out.set(
      userId,
      [...per.entries()]
        .map(([id, shifts]) => ({ outlet: outletName.get(id) || id, shifts }))
        .sort((a, b) => b.shifts - a.shifts),
    );
  }
  return out;
}

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
  // Bank / statutory submission files must never be generated from a draft
  // or ai_computed run — those are still editable and the numbers aren't
  // final. CP39/KWSP/Maybank all assume the run is locked.
  if (!["confirmed", "paid"].includes(run.status)) {
    return NextResponse.json(
      { error: `Run must be confirmed or paid before generating submission files (current: ${run.status})` },
      { status: 409 },
    );
  }

  // Audit every bank/statutory file export — these carry every employee's
  // bank account + statutory contributions.
  await logActivity({
    actorId: session.id,
    action: "payroll.submission-file.download",
    module: "hr",
    targetId: runId,
    targetName: `${type} · ${run.period_month}/${run.period_year}`,
    details: {
      run_id: runId,
      file_type: type,
      // An acknowledged-omissions download is a deliberate decision — keep it
      // visible in the audit trail (see the skipped-staff 409 below).
      ...(searchParams.get("ack_skips") === "1" ? { ack_skips: true } : {}),
    },
    request: req,
  });

  const { data: items } = await hrSupabaseAdmin
    .from("hr_payroll_items")
    .select("*")
    .eq("payroll_run_id", runId);

  const userIds = Array.from(new Set((items || []).map((i: { user_id: string }) => i.user_id)));
  const [users, profiles, companyRes] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, fullName: true, bankName: true, bankAccountNumber: true, bankAccountName: true, outlet: { select: { name: true } } },
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
      // The wage column must be what the contributions were computed ON.
      // KWSP's own check (11% of wage = employee EPF) failed on prorated basic;
      // PERKESO's wage includes OT. Older items without statutory_basis fall
      // back to basic.
      wage: Number(item.computation_details?.statutory_basis ?? item.basic_salary ?? 0),
      socsoWage:
        Number(item.computation_details?.statutory_basis ?? item.basic_salary ?? 0) +
        Number(item.ot_1x_amount || 0) + Number(item.ot_1_5x_amount || 0) + Number(item.ot_2x_amount || 0) + Number(item.ot_3x_amount || 0) -
        Number(item.computation_details?.ph_premium_amount || 0) - Number(item.computation_details?.rest_day_pay_amount || 0),
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
      outlet: u?.outlet?.name ?? null,
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

  // The bank file SILENTLY OMITS anyone with no bank account or net ≤ 0 — and
  // the only signal used to be a count in the X-Summary header, which the UI's
  // navigation-download never read. Finance would upload the file and one
  // staffer just wouldn't get paid, with no visible trace. Now the omission
  // list comes back as a 409 the caller must acknowledge (ack_skips=1) before
  // the file is produced; the acknowledgement lands in the download audit log.
  const ackSkips = searchParams.get("ack_skips") === "1";
  if (type === "maybank" && !ackSkips) {
    const omitted = employees
      .filter((e) => !e.bankAccountNumber || e.netPay <= 0)
      .map((e) => ({
        name: e.fullName || e.name,
        why: !e.bankAccountNumber ? "no bank account on file" : "net pay is zero or negative",
      }));
    if (omitted.length > 0) {
      return NextResponse.json(
        {
          error:
            `This payment file will OMIT ${omitted.length} staff: ` +
            omitted.map((o) => `${o.name} (${o.why})`).join("; ") +
            `. They will not be paid by this upload. Re-request with ack_skips=1 to generate anyway.`,
          reason: "skipped_staff",
          skipped: omitted,
        },
        { status: 409 },
      );
    }
  }

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
    // Finance reconciliation — what each outlet owes HQ. Not a bank upload.
    case "by_outlet": {
      // Rotating / multi-outlet staff are charged to the outlets they actually
      // worked in, pro rata by shifts in the pay period (owner 2026-09-03,
      // Syafiq: "divided based on the shifts work in each outlet"). Everyone
      // else stays on their home outlet.
      const shares = await outletSharesForRun(
        run,
        userIds,
        new Map(users.map((u) => [u.id, u.outlet?.name ?? null])),
      );
      for (const e of employees) {
        const s = shares.get(e.userId);
        if (s && s.length > 0) e.outletShares = s;
      }
      result = generatePayrollByOutlet(runMeta, employees);
      break;
    }
    default:
      return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
  }

  return new NextResponse(result.content, {
    headers: {
      "Content-Type": result.mime,
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      // HTTP headers are ASCII-only; staff full names with accents would
      // throw on header set. URI-encode defensively.
      "X-Summary": encodeURIComponent(JSON.stringify(result.summary)),
    },
  });
}
