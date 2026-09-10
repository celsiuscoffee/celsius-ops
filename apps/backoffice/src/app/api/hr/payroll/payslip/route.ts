import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import {
  generatePayslipPDF,
  generatePayslipBundlePDF,
  mapPayslipData,
  computePayslipYtd,
  type PayslipData,
} from "@celsius/shared/src/hr/payslip";
import { logActivity } from "@/lib/activity-log";

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

  // Audit payslip access. Self-views by staff are routine; admin access to
  // another employee's (or the whole-run bundle's) payslip is the trail that
  // matters for accountability.
  if (canViewAll) {
    await logActivity({
      actorId: session.id,
      action: "payroll.payslip.download",
      module: "hr",
      targetId: targetUserId ?? runId,
      targetName: targetUserId ? null : "all-employee bundle",
      details: {
        run_id: runId,
        user_id: targetUserId ?? "ALL",
        ...(searchParams.get("allow_provisional") === "1" ? { allow_provisional: true } : {}),
      },
      request: req,
    });
  }

  const { data: run } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  // Status gate — this route had NONE while the submission-files route 409s on
  // anything unconfirmed. A mid-month preview run (ai_computed, 0 OT, wrong
  // PCB) could be rendered and distributed as a payslip with nothing on the
  // PDF marking it provisional; recomputing later left issued PDFs matching
  // nothing. Staff can never pull an unconfirmed slip; OWNER/ADMIN can pass
  // allow_provisional=1 deliberately (it lands in the download audit entry).
  const allowProvisional = canViewAll && searchParams.get("allow_provisional") === "1";
  if (!["confirmed", "paid"].includes(run.status) && !allowProvisional) {
    return NextResponse.json(
      {
        error: `Run is ${run.status} — payslips come from confirmed runs. ${canViewAll ? "Pass allow_provisional=1 to preview anyway (audit-logged)." : "Ask HR once payroll is confirmed."}`,
        reason: "run_not_confirmed",
      },
      { status: 409 },
    );
  }

  const itemsQuery = hrSupabaseAdmin.from("hr_payroll_items").select("*").eq("payroll_run_id", runId);
  if (targetUserId) itemsQuery.eq("user_id", targetUserId);
  const { data: items } = await itemsQuery;
  if (!items || items.length === 0) {
    return NextResponse.json({ error: "No payroll items found" }, { status: 404 });
  }

  // YTD per user (spans every prior confirmed/paid run in the year, incl. the
  // BrioHR-imported months). Shared with the staff self-service route.
  const userIds = items.map((i: { user_id: string }) => i.user_id);
  const ytdByUser = await computePayslipYtd(hrSupabaseAdmin, {
    periodYear: run.period_year,
    periodMonth: run.period_month,
    userIds,
    currentItems: items,
  });

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
  type ProfileRow = {
    user_id: string;
    ic_number?: string | null;
    position?: string | null;
    epf_number?: string | null;
    socso_number?: string | null;
    tax_number?: string | null;
  };
  const profMap = new Map((profiles.data || []).map((p: ProfileRow) => [p.user_id, p]));
  const company = companyRes.data;

  const records: PayslipData[] = items.map((it) => {
    const u = userMap.get(it.user_id);
    return mapPayslipData(it, {
      run,
      user: u
        ? {
            name: u.name,
            fullName: u.fullName,
            bankName: u.bankName,
            bankAccountNumber: u.bankAccountNumber,
            outletName: u.outlet?.name ?? null,
          }
        : undefined,
      profile: profMap.get(it.user_id),
      company,
      ytd: ytdByUser.get(it.user_id),
    });
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
