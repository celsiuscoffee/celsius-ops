import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Per-staff FLAT allowance (`hr_employee_profiles.fixed_performance_allowance`).
//
// This route used to read and write `performance_allowance_amount` — a column
// with five writers and ZERO readers: the engine takes the scored pool from
// hr_company_settings and the per-person flat amount from
// `fixed_performance_allowance` (lib/hr/allowances.ts, parseFixedAllowance).
// So the "Per-Staff Allowances" screen was a decoy — an admin could type a
// number that changed nobody's pay, while the column that DOES change pay was
// reachable only by SQL. This repoints the screen at the live column.
//
// Semantics of the live column (see buildFixedAllowanceBreakdown): a value
// pays FLAT — full amount, every month, levers not scored, no attendance or
// review deductions (proration for partial months still applies). NULL means
// the normal scored pool. That is what the UI copy must say.

// GET: list FT-eligible staff with their flat-allowance setting.
export async function GET() {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: settings } = await hrSupabaseAdmin
    .from("hr_company_settings")
    .select("performance_allowance_amount")
    .limit(1)
    .maybeSingle();
  const defaults = {
    // The scored pool a blank row falls back to — shown for context only.
    performance_allowance_amount: Number(settings?.performance_allowance_amount ?? 200),
  };

  // All profiles, we filter client-side for employment_type eligibility.
  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, employment_type, schedule_required, fixed_performance_allowance");

  type ProfileRow = {
    user_id: string;
    employment_type: string | null;
    schedule_required: boolean | null;
    fixed_performance_allowance: number | null;
  };
  const rows = (profiles || []) as ProfileRow[];

  // Eligible = full-time. Unlike the old decoy column, the flat allowance is
  // exactly for roles the levers CANNOT score — unrostered/HQ staff — so
  // schedule_required must not filter anyone out here.
  const eligibleIds = rows
    .filter((p) => p.employment_type === "full_time")
    .map((p) => p.user_id);

  const users = eligibleIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: eligibleIds }, status: "ACTIVE" },
        select: {
          id: true, name: true, fullName: true, role: true,
          outletId: true, outlet: { select: { name: true } },
        },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      })
    : [];

  const profileMap = new Map(rows.map((p) => [p.user_id, p]));
  const staff = users.map((u) => {
    const p = profileMap.get(u.id);
    return {
      userId: u.id,
      name: u.name,
      fullName: u.fullName,
      role: u.role,
      outletName: u.outlet?.name ?? null,
      scheduleRequired: p?.schedule_required !== false,
      fixed_performance_allowance: p?.fixed_performance_allowance != null
        ? Number(p.fixed_performance_allowance)
        : null,
    };
  });

  return NextResponse.json({ defaults, staff });
}

// PATCH: set one user's flat allowance. NULL reverts to the scored pool.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { user_id, fixed_performance_allowance } = body as {
    user_id: string;
    fixed_performance_allowance: number | null;
  };
  if (!user_id) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  // Coerce: empty string / undefined → null; numbers → validated non-negative
  const norm = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  };

  const patch = {
    fixed_performance_allowance: norm(fixed_performance_allowance),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .update(patch)
    .eq("user_id", user_id)
    .select("user_id, fixed_performance_allowance")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Profile not found for user" }, { status: 404 });

  return NextResponse.json({ override: data });
}
