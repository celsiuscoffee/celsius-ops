import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { resolveVisibleUserIds } from "@/lib/hr/scope";

export const dynamic = "force-dynamic";

// Hand edits to one LINE of a computed performance allowance — a lever the
// engine couldn't score fairly, or a deduction that shouldn't stand.
//
// There is no whole-month replace any more (owner 2026-08-03: "make the lever
// edit manual, remove the replace the whole month"). Every correction now names
// the thing it is correcting, so the reason sits next to the line it explains
// and the rest of the scoring survives.
//
// The engine clamps what it reads: a deduction edit to [0, computed] and a
// lever edit to [0, pool]. Those bounds are what make this delegable to a
// MANAGER for their own team — no edit can inflate a month past the allowance.

type OverrideRow = {
  id: string;
  user_id: string;
  period_year: number;
  period_month: number;
  line_key: string;
  amount: number | string;
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
 * - OWNER / ADMIN: everyone.
 * - MANAGER: their own subtree.
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
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await resolveScope(session);
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const now = new Date();
  const year = parseInt(searchParams.get("year") || String(now.getFullYear()));
  const month = parseInt(searchParams.get("month") || String(now.getMonth() + 1));

  const { data, error } = await hrSupabaseAdmin
    .from("hr_performance_line_overrides")
    .select("*")
    .eq("period_year", year)
    .eq("period_month", month);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = ((data || []) as OverrideRow[]).filter(
    (r) => scope.allowed === null || scope.allowed.includes(r.user_id),
  );

  const actorIds = [...new Set(rows.flatMap((r) => [r.created_by, r.updated_by]).filter(Boolean) as string[])];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : [];
  const actorName = new Map(actors.map((a) => [a.id, a.name]));

  // Whether the month is editable at all, so the page can say so up front
  // rather than letting someone type a reason into a form that will 409.
  const locked = await lockedRunFor(year, month);

  return NextResponse.json({
    period: { year, month },
    locked: locked ? { status: locked.status } : null,
    overrides: rows.map((r) => ({
      ...r,
      amount: Number(r.amount),
      computed_amount: r.computed_amount != null ? Number(r.computed_amount) : null,
      updated_by_name: r.updated_by ? actorName.get(r.updated_by) ?? null : null,
    })),
  });
}

// POST — upsert one line edit.
// body: { user_id, year, month, line_key, amount, computed_amount?, label?, reason }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await resolveScope(session);
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const { user_id, year, month, line_key, amount, computed_amount, label, reason } = body || {};

  if (!user_id || !year || !month) {
    return NextResponse.json({ error: "user_id, year and month are required" }, { status: 400 });
  }
  if (Number(month) < 1 || Number(month) > 12) {
    return NextResponse.json({ error: "month must be 1-12" }, { status: 400 });
  }
  if (typeof line_key !== "string" || !line_key.trim()) {
    return NextResponse.json({ error: "line_key is required" }, { status: 400 });
  }
  if (scope.allowed !== null && !scope.allowed.includes(user_id)) {
    return NextResponse.json({ error: "This employee is not in your team." }, { status: 403 });
  }
  // An unexplained pay correction is worse than no correction — the DB enforces
  // this too, but reject it here so the message is a sentence, not a 23514.
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return NextResponse.json({ error: "Say why this line is being changed." }, { status: 400 });
  }
  // Absent amount means 0 — waiving a deduction outright, the common case.
  const value = amount == null || amount === "" ? 0 : parseAmount(amount);
  if (value == null) {
    return NextResponse.json({ error: "amount must be a number ≥ 0" }, { status: 400 });
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

  const { data, error } = await hrSupabaseAdmin
    .from("hr_performance_line_overrides")
    .upsert(
      {
        user_id,
        period_year: Number(year),
        period_month: Number(month),
        line_key: line_key.trim(),
        amount: value,
        computed_amount: parseAmount(computed_amount),
        label: typeof label === "string" && label.trim() ? label.trim() : null,
        reason: reason.trim(),
        created_by: session.id,
        updated_by: session.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,period_year,period_month,line_key" },
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const isLever = line_key.startsWith("lever|");
  return NextResponse.json({
    override: data,
    message: isLever
      ? `Set to RM${value.toFixed(2)}. Recompute the run for it to reach the payslip.`
      : value === 0
        ? "Deduction waived. Recompute the run for it to reach the payslip."
        : `Deduction reduced to RM${value.toFixed(2)}. Recompute the run for it to reach the payslip.`,
  });
}

// DELETE /api/hr/performance-overrides?user_id=..&year=..&month=..&line_key=..
// Hands the line back to the engine.
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = await resolveScope(session);
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("user_id");
  const year = searchParams.get("year");
  const month = searchParams.get("month");
  const lineKey = searchParams.get("line_key");
  if (!userId || !year || !month || !lineKey) {
    return NextResponse.json({ error: "user_id, year, month and line_key are required" }, { status: 400 });
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

  const { error } = await hrSupabaseAdmin
    .from("hr_performance_line_overrides")
    .delete()
    .eq("user_id", userId)
    .eq("period_year", Number(year))
    .eq("period_month", Number(month))
    .eq("line_key", lineKey);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, message: "Back to the computed figure." });
}
