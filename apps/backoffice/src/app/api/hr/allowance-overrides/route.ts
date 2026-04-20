import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET: list FT-eligible staff with their per-staff allowance overrides.
// Returns global defaults alongside so the UI can render placeholder values.
export async function GET() {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: settings } = await hrSupabaseAdmin
    .from("hr_company_settings")
    .select("attendance_allowance_amount, performance_allowance_amount")
    .limit(1)
    .maybeSingle();
  const defaults = {
    attendance_allowance_amount: Number(settings?.attendance_allowance_amount ?? 100),
    performance_allowance_amount: Number(settings?.performance_allowance_amount ?? 100),
  };

  // All profiles, we filter client-side for employment_type eligibility.
  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, employment_type, schedule_required, attendance_allowance_amount, performance_allowance_amount");

  type ProfileRow = {
    user_id: string;
    employment_type: string | null;
    schedule_required: boolean | null;
    attendance_allowance_amount: number | null;
    performance_allowance_amount: number | null;
  };
  const rows = (profiles || []) as ProfileRow[];

  // Eligible = full-time + schedule_required (exclude HQ/OWNER non-operational)
  const eligibleIds = rows
    .filter((p) => p.employment_type === "full_time" && p.schedule_required !== false)
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
      attendance_allowance_amount: p?.attendance_allowance_amount != null
        ? Number(p.attendance_allowance_amount)
        : null,
      performance_allowance_amount: p?.performance_allowance_amount != null
        ? Number(p.performance_allowance_amount)
        : null,
    };
  });

  return NextResponse.json({ defaults, staff });
}

// PATCH: update the per-staff overrides for one user. Set NULL to revert to default.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { user_id, attendance_allowance_amount, performance_allowance_amount } = body as {
    user_id: string;
    attendance_allowance_amount: number | null;
    performance_allowance_amount: number | null;
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
    attendance_allowance_amount: norm(attendance_allowance_amount),
    performance_allowance_amount: norm(performance_allowance_amount),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .update(patch)
    .eq("user_id", user_id)
    .select("user_id, attendance_allowance_amount, performance_allowance_amount")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Profile not found for user" }, { status: 404 });

  return NextResponse.json({ override: data });
}
