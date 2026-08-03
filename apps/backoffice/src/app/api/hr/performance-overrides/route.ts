import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";

export const dynamic = "force-dynamic";

// Manual per-person, per-month override of the computed performance allowance.
// OWNER/ADMIN only — this sets pay, and a manager already has the PT-rate
// delegation with its own ceiling.

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

function parseAmount(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// GET /api/hr/performance-overrides?year=2026&month=7
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const now = new Date();
  const year = parseInt(searchParams.get("year") || String(now.getFullYear()));
  const month = parseInt(searchParams.get("month") || String(now.getMonth() + 1));

  const { data, error } = await hrSupabaseAdmin
    .from("hr_performance_overrides")
    .select("*")
    .eq("period_year", year)
    .eq("period_month", month);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data || []) as OverrideRow[];
  const actorIds = [...new Set(rows.flatMap((r) => [r.created_by, r.updated_by]).filter(Boolean) as string[])];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : [];
  const actorName = new Map(actors.map((a) => [a.id, a.name]));

  return NextResponse.json({
    period: { year, month },
    overrides: rows.map((r) => ({
      ...r,
      override_amount: Number(r.override_amount),
      computed_amount: r.computed_amount != null ? Number(r.computed_amount) : null,
      updated_by_name: r.updated_by ? actorName.get(r.updated_by) ?? null : null,
    })),
  });
}

// POST — upsert one person's override for one month.
// body: { user_id, year, month, override_amount, computed_amount?, reason }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const { user_id, year, month, override_amount, computed_amount, reason } = body || {};

  if (!user_id || !year || !month) {
    return NextResponse.json({ error: "user_id, year and month are required" }, { status: 400 });
  }
  if (Number(month) < 1 || Number(month) > 12) {
    return NextResponse.json({ error: "month must be 1-12" }, { status: 400 });
  }
  const amount = parseAmount(override_amount);
  if (amount == null) {
    return NextResponse.json({ error: "override_amount must be a number ≥ 0" }, { status: 400 });
  }
  // An unexplained pay override is worse than no override — the DB enforces
  // this too, but reject it here so the message is a sentence, not a 23514.
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return NextResponse.json({ error: "A reason is required for a manual override." }, { status: 400 });
  }

  // Refuse to edit a month that is already locked in — a confirmed or paid run
  // has been reported to KWSP/LHDN and sent to the bank. Recompute won't reach
  // it, so an override here would silently disagree with what was paid.
  const { data: lockedRun } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .select("id, status")
    .eq("period_year", Number(year))
    .eq("period_month", Number(month))
    .in("status", ["confirmed", "paid"])
    .limit(1)
    .maybeSingle();
  if (lockedRun) {
    return NextResponse.json(
      {
        error: `The ${month}/${year} payroll run is already ${lockedRun.status}. Overrides can't change a run that has been paid out.`,
        reason: "run_locked",
      },
      { status: 409 },
    );
  }

  const nowIso = new Date().toISOString();
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

// DELETE /api/hr/performance-overrides?user_id=..&year=..&month=..
// Removes the override so the lever engine decides again.
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("user_id");
  const year = searchParams.get("year");
  const month = searchParams.get("month");
  if (!userId || !year || !month) {
    return NextResponse.json({ error: "user_id, year and month are required" }, { status: 400 });
  }

  const { data: lockedRun } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .select("id, status")
    .eq("period_year", Number(year))
    .eq("period_month", Number(month))
    .in("status", ["confirmed", "paid"])
    .limit(1)
    .maybeSingle();
  if (lockedRun) {
    return NextResponse.json(
      { error: `The ${month}/${year} run is already ${lockedRun.status}.`, reason: "run_locked" },
      { status: 409 },
    );
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
