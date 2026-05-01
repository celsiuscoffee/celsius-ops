import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Pre-run readiness check. For each employee that *would* be in the run, list
// blocking issues (won't compute) + warnings (will compute but data missing).
// Surfaced in the run wizard before "Preview Compute" so HR can fix data
// before producing a wrong cycle.
//
// GET /api/hr/payroll/preflight?month=YYYY-MM
type Issue = { code: string; severity: "block" | "warn"; message: string };

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const month = Number(searchParams.get("month"));
  const year = Number(searchParams.get("year"));
  if (!month || !year) {
    return NextResponse.json({ error: "month and year required" }, { status: 400 });
  }
  const cycleStart = `${year}-${String(month).padStart(2, "0")}-01`;

  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("*");

  const userIds = (profiles || []).map((p: { user_id: string }) => p.user_id);
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          name: true,
          fullName: true,
          status: true,
          bankName: true,
          bankAccountNumber: true,
        },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  type Profile = {
    user_id: string;
    employment_type: string | null;
    schedule_required: boolean | null;
    basic_salary: string | number | null;
    hourly_rate: string | number | null;
    ic_number: string | null;
    epf_number: string | null;
    socso_number: string | null;
    tax_number: string | null;
    socso_category: string | null;
    eis_enabled: boolean | null;
    end_date: string | null;
    resigned_at: string | null;
  };

  // Monthly cycle is full-timers only. Part-timers / contract / intern run
  // via the weekly cycle and aren't shown here.
  const fullTimeProfiles = (profiles || []).filter(
    (p: Profile) => p.employment_type === "full_time",
  );
  const excludedNonFullTime = (profiles || []).length - fullTimeProfiles.length;

  // Cycle end (inclusive). Used to flag resigners whose last working day is
  // within this cycle as "final payroll" — they ARE included in the run with
  // prorate, and HR should verify leave encashment / notice pay before approving.
  const lastDay = new Date(year, month, 0).getDate();
  const cycleEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const rows = (fullTimeProfiles as Profile[]).map((p) => {
    const u = userMap.get(p.user_id);
    const issues: Issue[] = [];
    // Use end_date (last working day) for payroll cutoff, not letter-submission date.
    const resignDate = p.end_date || p.resigned_at || null;
    const resignedBefore = resignDate && resignDate < cycleStart;
    const isFinalCycle = !!resignDate && !resignedBefore && resignDate <= cycleEnd;

    // Skipped — won't appear in the run at all (resigned in a prior cycle)
    if (resignedBefore) {
      return {
        user_id: p.user_id,
        name: u?.fullName || u?.name || p.user_id.slice(0, 8),
        employment_type: p.employment_type,
        skipped: true,
        skip_reason: `resigned ${resignDate} (paid in prior cycle)`,
        issues: [] as Issue[],
        status: "skipped" as const,
      };
    }
    // Note: we deliberately do NOT skip on user.status !== "ACTIVE" here.
    // The resignation cron auto-deactivates staff at the end of their last
    // working day, but the calculator still includes them via resigned_at —
    // this cycle is their FINAL payroll. Surface that as a warning instead.
    if (isFinalCycle) {
      issues.push({
        code: "final_payroll",
        severity: "warn",
        message: `Final payroll (resign ${resignDate}). Verify leave encashment / notice pay before approving.`,
      });
    }

    // Blocking — calculator skips these
    if (
      p.schedule_required !== false
      && (p.basic_salary == null || Number(p.basic_salary) === 0)
    ) {
      issues.push({ code: "missing_basic_salary", severity: "block", message: "Full-timer has no basic salary" });
    }

    // Warning — will compute but downstream files fail or PCB filing breaks
    if (!u?.bankName || !u?.bankAccountNumber) {
      issues.push({ code: "missing_bank", severity: "warn", message: "No bank account on file (Maybank file will skip)" });
    }
    if (!p.ic_number) {
      issues.push({ code: "missing_ic", severity: "warn", message: "No IC number (statutory filings need this)" });
    }
    if (!p.epf_number) {
      issues.push({ code: "missing_epf_no", severity: "warn", message: "No EPF number (KWSP submission missing)" });
    }
    if (p.socso_category !== "exempt" && !p.socso_number) {
      issues.push({ code: "missing_socso_no", severity: "warn", message: "No SOCSO number (PERKESO submission missing)" });
    }
    if (!p.tax_number) {
      issues.push({ code: "missing_tax_no", severity: "warn", message: "No LHDN tax number (PCB CP39 missing)" });
    }

    const blocked = issues.some((i) => i.severity === "block");
    return {
      user_id: p.user_id,
      name: u?.fullName || u?.name || p.user_id.slice(0, 8),
      employment_type: p.employment_type,
      skipped: false,
      skip_reason: null,
      issues,
      status: blocked ? ("blocked" as const) : issues.length > 0 ? ("warning" as const) : ("ready" as const),
    };
  });

  const finalPayrollCount = rows.filter(
    (r) => r.issues.some((i) => i.code === "final_payroll"),
  ).length;

  const summary = {
    total: rows.length,
    ready: rows.filter((r) => r.status === "ready").length,
    warning: rows.filter((r) => r.status === "warning").length,
    blocked: rows.filter((r) => r.status === "blocked").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    excluded_non_full_time: excludedNonFullTime,
    final_payroll: finalPayrollCount,
  };

  return NextResponse.json({ summary, rows });
}
