import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { resolveVisibleUserIds } from "@/lib/hr/scope";

export const dynamic = "force-dynamic";

// Manual corrections to the computed performance allowance. Two shapes, one
// route, because the page reads and writes both:
//
//   WHOLE MONTH (no deduction_key) — replaces the entire outcome with one
//   figure. Sets pay outright, so OWNER/ADMIN only.
//
//   ONE LINE (deduction_key) — reduces a single deduction (a late, an absence,
//   a no-show, a negative review) and leaves everything else computing. Bounded
//   to [0, computed] by the engine, so it can only ever give back money the
//   engine took, never invent pay. That bound is why a MANAGER may do it for
//   their own team — the same delegation shape as PT rates.

type OverrideRow = {
  id: string;
  user_id: string;
  period_year: number;
  period_month: number;
  override_amount: number | string;
  computed_amount: number | string | null;
  reason: string;
  created_by: string | null;
  updated_by: string | null;
  updated_at: string | null;
};

type WaiverRow = {
  id: string;
  user_id: string;
  period_year: number;
  period_month: number;
  deduction_key: string;
  waived_amount: number | string;
  computed_amount: number | string | null;
  label: string | null;
  reason: string;
  created_by: string | null;
  updated_by: string | null;
  updated_at: string | null;
};

function parseAmount(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Who this session may correct.
 * - OWNER/ADMIN: everyone, whole-month overrides included.
 * - MANAGER: their own subtree, line waivers only.
 * - anyone else: nobody.
 */
async function resolveScope(session: { role: string; id: string }) {
  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  if (isAdmin) return { isAdmin, allowed: null as string[] | null };
  if (session.role !== "MANAGER") return null;
  return { isAdmin, allowed: (await resolveVisibleUserIds(session)) ?? [] };
}

/** A confirmed or paid run has gone to KWSP/LHDN and the bank — recompute can't reach it. */
async function lockedRunFor(year: number, month: number) {
  const { data } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .select("id, status")
    .eq("period_year", year)
    .eq("period_month", month)
    .in("status", ["confirmed", "paid"])
    .limit(1)
    .maybeSingle();
  return data as { id: string; status: string } | null;
}

// GET /api/hr/performance-overrides?year=2026&month=7
// → { overrides, waivers } for the period, scoped to what the caller may see.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await resolveScope(session);
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const now = new Date();
  const year = parseInt(searchParams.get("year") || String(now.getFullYear()));
  const month = parseInt(searchParams.get("month") || String(now.getMonth() + 1));

  const [ovRes, wvRes] = await Promise.all([
    hrSupabaseAdmin.from("hr_performance_overrides").select("*").eq("period_year", year).eq("period_month", month),
    hrSupabaseAdmin.from("hr_performance_deduction_waivers").select("*").eq("period_year", year).eq("period_month", month),
  ]);
  if (ovRes.error) return NextResponse.json({ error: ovRes.error.message }, { status: 500 });
  if (wvRes.error) return NextResponse.json({ error: wvRes.error.message }, { status: 500 });

  const visible = (userId: string) => scope.allowed === null || scope.allowed.includes(userId);
  const overrides = ((ovRes.data || []) as OverrideRow[]).filter((r) => visible(r.user_id));
  const waivers = ((wvRes.data || []) as WaiverRow[]).filter((r) => visible(r.user_id));

  const actorIds = [
    ...new Set(
      [...overrides, ...waivers].flatMap((r) => [r.created_by, r.updated_by]).filter(Boolean) as string[],
    ),
  ];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : [];
  const actorName = new Map(actors.map((a) => [a.id, a.name]));

  return NextResponse.json({
    period: { year, month },
    canOverrideWholeMonth: scope.isAdmin,
    overrides: overrides.map((r) => ({
      ...r,
      override_amount: Number(r.override_amount),
      computed_amount: r.computed_amount != null ? Number(r.computed_amount) : null,
      updated_by_name: r.updated_by ? actorName.get(r.updated_by) ?? null : null,
    })),
    waivers: waivers.map((r) => ({
      ...r,
      waived_amount: Number(r.waived_amount),
      computed_amount: r.computed_amount != null ? Number(r.computed_amount) : null,
      updated_by_name: r.updated_by ? actorName.get(r.updated_by) ?? null : null,
    })),
  });
}

// POST — upsert one correction.
//   whole month: { user_id, year, month, override_amount, computed_amount?, reason }
//   one line:    { user_id, year, month, deduction_key, waived_amount, computed_amount?, label?, reason }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await resolveScope(session);
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const { user_id, year, month, deduction_key, override_amount, waived_amount, computed_amount, label, reason } =
    body || {};

  if (!user_id || !year || !month) {
    return NextResponse.json({ error: "user_id, year and month are required" }, { status: 400 });
  }
  if (Number(month) < 1 || Number(month) > 12) {
    return NextResponse.json({ error: "month must be 1-12" }, { status: 400 });
  }
  if (scope.allowed !== null && !scope.allowed.includes(user_id)) {
    return NextResponse.json({ error: "This employee is not in your team." }, { status: 403 });
  }
  // An unexplained pay correction is worse than no correction — the DB enforces
  // this too, but reject it here so the message is a sentence, not a 23514.
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return NextResponse.json({ error: "A reason is required." }, { status: 400 });
  }

  const locked = await lockedRunFor(Number(year), Number(month));
  if (locked) {
    return NextResponse.json(
      {
        error: `The ${month}/${year} payroll run is already ${locked.status}. Corrections can't change a run that has been paid out.`,
        reason: "run_locked",
      },
      { status: 409 },
    );
  }

  const nowIso = new Date().toISOString();
  const isLine = typeof deduction_key === "string" && deduction_key.trim().length > 0;

  if (isLine) {
    // waived_amount is what to CHARGE instead, not the discount. Absent means 0
    // (waive the line entirely), which is the common case.
    const charge = waived_amount == null || waived_amount === "" ? 0 : parseAmount(waived_amount);
    if (charge == null) {
      return NextResponse.json({ error: "waived_amount must be a number ≥ 0" }, { status: 400 });
    }
    const { data, error } = await hrSupabaseAdmin
      .from("hr_performance_deduction_waivers")
      .upsert(
        {
          user_id,
          period_year: Number(year),
          period_month: Number(month),
          deduction_key: deduction_key.trim(),
          waived_amount: charge,
          computed_amount: parseAmount(computed_amount),
          label: typeof label === "string" && label.trim() ? label.trim() : null,
          reason: reason.trim(),
          created_by: session.id,
          updated_by: session.id,
          updated_at: nowIso,
        },
        { onConflict: "user_id,period_year,period_month,deduction_key" },
      )
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      waiver: data,
      message:
        charge === 0
          ? "Deduction waived. Recompute the payroll run for it to reach the payslip."
          : `Deduction reduced to RM${charge.toFixed(2)}. Recompute the payroll run for it to reach the payslip.`,
    });
  }

  // Whole-month override — this SETS pay rather than giving back a deduction,
  // so it stays with the people who own the pay decision.
  if (!scope.isAdmin) {
    return NextResponse.json(
      { error: "Only an owner or admin can replace the whole month's amount. You can waive individual deductions." },
      { status: 403 },
    );
  }
  const amount = parseAmount(override_amount);
  if (amount == null) {
    return NextResponse.json({ error: "override_amount must be a number ≥ 0" }, { status: 400 });
  }

  const { data, error } = await hrSupabaseAdmin
    .from("hr_performance_overrides")
    .upsert(
      {
        user_id,
        period_year: Number(year),
        period_month: Number(month),
        override_amount: amount,
        computed_amount: parseAmount(computed_amount),
        reason: reason.trim(),
        created_by: session.id,
        updated_by: session.id,
        updated_at: nowIso,
      },
      { onConflict: "user_id,period_year,period_month" },
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    override: data,
    message: "Saved. Recompute the payroll run for it to reach the payslip.",
  });
}

// DELETE /api/hr/performance-overrides?user_id=..&year=..&month=..[&deduction_key=..]
// With deduction_key: restore that one deduction. Without: drop the whole-month
// override so the lever engine decides again.
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await resolveScope(session);
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("user_id");
  const year = searchParams.get("year");
  const month = searchParams.get("month");
  const deductionKey = searchParams.get("deduction_key");
  if (!userId || !year || !month) {
    return NextResponse.json({ error: "user_id, year and month are required" }, { status: 400 });
  }
  if (scope.allowed !== null && !scope.allowed.includes(userId)) {
    return NextResponse.json({ error: "This employee is not in your team." }, { status: 403 });
  }

  const locked = await lockedRunFor(Number(year), Number(month));
  if (locked) {
    return NextResponse.json(
      { error: `The ${month}/${year} run is already ${locked.status}.`, reason: "run_locked" },
      { status: 409 },
    );
  }

  if (deductionKey) {
    const { error } = await hrSupabaseAdmin
      .from("hr_performance_deduction_waivers")
      .delete()
      .eq("user_id", userId)
      .eq("period_year", Number(year))
      .eq("period_month", Number(month))
      .eq("deduction_key", deductionKey);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, message: "Deduction restored." });
  }

  if (!scope.isAdmin) {
    return NextResponse.json({ error: "Only an owner or admin can remove a whole-month override." }, { status: 403 });
  }
  const { error } = await hrSupabaseAdmin
    .from("hr_performance_overrides")
    .delete()
    .eq("user_id", userId)
    .eq("period_year", Number(year))
    .eq("period_month", Number(month));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, message: "Override removed — the levers decide again." });
}
