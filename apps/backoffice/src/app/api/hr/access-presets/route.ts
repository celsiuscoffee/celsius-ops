import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import {
  applyStaffPreset,
  matchesStaffPreset,
  staffPresetDiff,
  tierForPosition,
  type ModuleAccess,
  type StaffAccess,
} from "@/lib/staff-access-presets";

export const dynamic = "force-dynamic";

type StaffRow = {
  id: string;
  name: string;
  role: string;
  position: string | null;
  current: StaffAccess;
};

async function loadStaff(): Promise<StaffRow[]> {
  const [users, profiles] = await Promise.all([
    prisma.user.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, role: true, appAccess: true, moduleAccess: true },
      orderBy: { name: "asc" },
    }),
    hrSupabaseAdmin.from("hr_employee_profiles").select("user_id, position"),
  ]);
  const posById = new Map(
    ((profiles.data as { user_id: string; position: string | null }[] | null) ?? []).map((p) => [
      p.user_id,
      p.position,
    ]),
  );
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    position: posById.get(u.id) ?? null,
    current: {
      appAccess: (u.appAccess as string[]) ?? [],
      moduleAccess: (u.moduleAccess as ModuleAccess) ?? {},
    },
  }));
}

// GET — deviation report: every active staff member, their position/tier, and
// whether their staff-app access matches their position preset (+ the diff).
export async function GET() {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const staff = await loadStaff();
  const rows = staff.map((s) => {
    const matches = matchesStaffPreset(s.current, s.position);
    return {
      id: s.id,
      name: s.name,
      role: s.role,
      position: s.position,
      tier: tierForPosition(s.position),
      matches,
      diff: matches ? [] : staffPresetDiff(s.current, s.position),
    };
  });
  return NextResponse.json({
    total: rows.length,
    deviating: rows.filter((r) => !r.matches).length,
    staff: rows,
  });
}

// POST — apply a position preset. Body: { userId } for one, or { applyAll: true }
// for every deviating staff member. Pass { dryRun: true } to preview the diff
// without writing.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { userId?: string; applyAll?: boolean; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const staff = await loadStaff();
  const targets = body.applyAll
    ? staff.filter((s) => !matchesStaffPreset(s.current, s.position))
    : staff.filter((s) => s.id === body.userId);

  if (!body.applyAll && targets.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const changes = targets.map((s) => ({
    id: s.id,
    name: s.name,
    position: s.position,
    tier: tierForPosition(s.position),
    diff: staffPresetDiff(s.current, s.position),
    next: applyStaffPreset(s.current, s.position),
  }));

  if (body.dryRun) {
    return NextResponse.json({ dryRun: true, count: changes.length, changes: changes.map(({ next: _n, ...c }) => c) });
  }

  let applied = 0;
  for (const c of changes) {
    await prisma.user.update({
      where: { id: c.id },
      data: { appAccess: c.next.appAccess, moduleAccess: c.next.moduleAccess },
    });
    applied += 1;
  }
  return NextResponse.json({
    applied,
    changes: changes.map(({ next: _n, ...c }) => c),
  });
}
