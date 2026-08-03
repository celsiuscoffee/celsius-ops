import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { resolveVisibleUserIds } from "@/lib/hr/scope";
import { PT_RATE_SELF_APPROVE_MAX } from "@/lib/hr/constants";

export const dynamic = "force-dynamic";

type Profile = {
  user_id: string;
  employment_type: string | null;
  hourly_rate: number | string | null;
  hourly_rate_weekend: number | string | null;
};

type PendingRow = {
  id: string;
  user_id: string;
  salary_type: string;
  amount: number | string;
  effective_date: string;
  comment: string | null;
  requested_by: string | null;
  created_at: string | null;
};

// GET — the part-timers this session may re-rate, their current weekday/weekend
// rate, and any change still waiting on an owner.
//
// Deliberately narrow: hourly rates only. No bank details, no statutory IDs, no
// monthly salary — none of the payroll PII the employees list withholds from a
// MANAGER. Scope is the caller's own HR subtree.
export async function GET() {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const visibleUserIds = await resolveVisibleUserIds(session);

  const { data: profileRows, error } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, employment_type, hourly_rate, hourly_rate_weekend")
    .eq("employment_type", "part_time");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const inScope = (profileRows || []).filter((p: Profile) =>
    visibleUserIds === null ? true : visibleUserIds.includes(p.user_id),
  ) as Profile[];
  const userIds = inScope.map((p) => p.user_id);

  if (userIds.length === 0) {
    return NextResponse.json({ employees: [], pending: [], selfApproveMax: PT_RATE_SELF_APPROVE_MAX });
  }

  const [users, pendingRes] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, status: true, outlet: { select: { name: true } } },
    }),
    hrSupabaseAdmin
      .from("hr_salary_history")
      .select("id, user_id, salary_type, amount, effective_date, comment, requested_by, created_at")
      .eq("status", "pending")
      .in("user_id", userIds)
      .order("created_at", { ascending: true }),
  ]);

  const userById = new Map(users.map((u) => [u.id, u]));
  const pendingRows = (pendingRes.data || []) as PendingRow[];

  // Resolve requester names in one hit so the queue reads "raised by Ariff".
  const requesterIds = [...new Set(pendingRows.map((p) => p.requested_by).filter(Boolean) as string[])];
  const requesters = requesterIds.length
    ? await prisma.user.findMany({ where: { id: { in: requesterIds } }, select: { id: true, name: true } })
    : [];
  const requesterName = new Map(requesters.map((u) => [u.id, u.name]));

  const pendingByUser = new Map<string, PendingRow[]>();
  for (const row of pendingRows) {
    const list = pendingByUser.get(row.user_id);
    if (list) list.push(row);
    else pendingByUser.set(row.user_id, [row]);
  }

  const num = (v: unknown) => (v == null ? null : Number(v));

  const employees = inScope
    .map((p) => {
      const u = userById.get(p.user_id);
      return {
        user_id: p.user_id,
        name: u?.name ?? null,
        status: u?.status ?? null,
        outlet_name: u?.outlet?.name ?? null,
        hourly_rate: num(p.hourly_rate),
        hourly_rate_weekend: num(p.hourly_rate_weekend),
        pending: (pendingByUser.get(p.user_id) || []).map((r) => ({
          ...r,
          amount: Number(r.amount),
          requested_by_name: r.requested_by ? requesterName.get(r.requested_by) ?? null : null,
        })),
      };
    })
    // Active first, then alphabetical — resigned part-timers stay visible but out of the way.
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "ACTIVE" ? -1 : 1;
      return (a.name || "").localeCompare(b.name || "");
    });

  return NextResponse.json({
    employees,
    pending: employees.flatMap((e) => e.pending.map((p) => ({ ...p, name: e.name }))),
    selfApproveMax: PT_RATE_SELF_APPROVE_MAX,
    canApprove: ["OWNER", "ADMIN"].includes(session.role),
  });
}
