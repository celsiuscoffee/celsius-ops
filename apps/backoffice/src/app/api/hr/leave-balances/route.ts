import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { LEAVE_TYPES } from "@/lib/hr/constants";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

// GET: leave balances (filterable by user or year)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()));
  const userId = searchParams.get("user_id");

  let query = hrSupabaseAdmin
    .from("hr_leave_balances")
    .select("*")
    .eq("year", year)
    .order("user_id");

  if (userId) query = query.eq("user_id", userId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ balances: data });
}

// POST: initialize or update balances
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { action, year, user_id, balances } = body;

  // ─── Bulk init: give every active employee default balances for a year ───
  if (action === "init_all") {
    const targetYear = year || new Date().getFullYear();

    // Get all active users with HR profiles
    const { data: profiles } = await hrSupabaseAdmin
      .from("hr_employee_profiles")
      .select("user_id, employment_type");

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ error: "No employee profiles found. Set up profiles first." }, { status: 400 });
    }

    const rows: Record<string, unknown>[] = [];
    for (const profile of profiles) {
      const isPartTime = profile.employment_type === "part_time";

      for (const [type, config] of Object.entries(LEAVE_TYPES)) {
        // Part-timers get pro-rated annual leave, no sick leave by default
        let entitled: number = config.defaultDays;
        if (isPartTime) {
          if (type === "annual") entitled = Math.round(config.defaultDays / 2);
          else if (type === "sick") entitled = 0;
          else if (type === "unpaid") entitled = 999;
          else entitled = 0;
        }

        rows.push({
          user_id: profile.user_id,
          year: targetYear,
          leave_type: type,
          entitled_days: entitled,
          used_days: 0,
          pending_days: 0,
          carried_forward: 0,
        });
      }
    }

    // Upsert all rows
    const { error } = await hrSupabaseAdmin
      .from("hr_leave_balances")
      .upsert(rows, { onConflict: "user_id,year,leave_type", ignoreDuplicates: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      success: true,
      initialized: rows.length,
      employees: profiles.length,
      year: targetYear,
    });
  }

  // ─── Year rollover: create next year's rows from this year's ───
  //
  // Nothing else creates next-year balances — before this action existed, the
  // staff app showed ZERO balances for everyone on Jan 1 (its GET filters on
  // the current year) and the only recovery was the destructive default-reset
  // init_all or per-person hand entry. Rollover instead:
  //   - copies each person's CURRENT entitlements (hand-set values and
  //     tenure adjustments survive; init_all would flatten them to defaults)
  //   - computes carried_forward = min(unused AL, carry_cap_days) — cap
  //     defaults to 0 (no carry-over) until the owner sets a policy; sick /
  //     emergency / unpaid never carry
  //   - inserts ONLY missing rows (ignoreDuplicates), so re-running is safe
  //     and never rewrites a year already in use
  if (action === "rollover") {
    const fromYear = year || new Date().getFullYear();
    const toYear = fromYear + 1;
    const carryCapDays = Math.max(0, Number(body.carry_cap_days ?? 0) || 0);

    const { data: fromRows } = await hrSupabaseAdmin
      .from("hr_leave_balances")
      .select("user_id, leave_type, entitled_days, used_days, pending_days, carried_forward")
      .eq("year", fromYear);
    if (!fromRows || fromRows.length === 0) {
      return NextResponse.json({ error: `No ${fromYear} balances to roll over.` }, { status: 400 });
    }

    // Skip people who are no longer active — a resigned staffer needs no next
    // year, and rolling them forward would resurrect them in every list.
    const userIds = Array.from(new Set(fromRows.map((r: { user_id: string }) => r.user_id)));
    const activeUsers = await prisma.user.findMany({
      where: { id: { in: userIds }, status: "ACTIVE" },
      select: { id: true },
    });
    const activeIds = new Set(activeUsers.map((u) => u.id));

    let totalCarried = 0;
    const rows = fromRows
      .filter((r: { user_id: string }) => activeIds.has(r.user_id))
      .map((r: { user_id: string; leave_type: string; entitled_days: number; used_days: number; pending_days: number; carried_forward: number }) => {
        const unused = Math.max(
          0,
          Number(r.entitled_days) + Number(r.carried_forward) - Number(r.used_days) - Number(r.pending_days),
        );
        const carried = r.leave_type === "annual" ? Math.min(unused, carryCapDays) : 0;
        totalCarried += carried;
        return {
          user_id: r.user_id,
          year: toYear,
          leave_type: r.leave_type,
          entitled_days: Number(r.entitled_days),
          used_days: 0,
          pending_days: 0,
          carried_forward: carried,
        };
      });

    const { count: existingCount } = await hrSupabaseAdmin
      .from("hr_leave_balances")
      .select("id", { count: "exact", head: true })
      .eq("year", toYear);

    const { error } = await hrSupabaseAdmin
      .from("hr_leave_balances")
      .upsert(rows, { onConflict: "user_id,year,leave_type", ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logActivity({
      actorId: session.id,
      action: "leave.rollover",
      module: "hr",
      targetId: null,
      targetName: `${fromYear} → ${toYear}`,
      details: {
        from_year: fromYear,
        to_year: toYear,
        carry_cap_days: carryCapDays,
        rows: rows.length,
        preserved_existing: existingCount ?? 0,
        total_carried_days: totalCarried,
      },
      request: req,
    });

    return NextResponse.json({
      success: true,
      from_year: fromYear,
      to_year: toYear,
      rolled: Math.max(0, rows.length - (existingCount ?? 0)),
      preserved: existingCount ?? 0,
      carry_cap_days: carryCapDays,
      total_carried_days: totalCarried,
    });
  }

  // ─── Update a specific employee's balances ───
  if (action === "update" && user_id && balances) {
    const targetYear = year || new Date().getFullYear();
    const rows = (balances as Array<{ leave_type: string; entitled_days: number; carried_forward?: number }>).map((b) => ({
      user_id,
      year: targetYear,
      leave_type: b.leave_type,
      entitled_days: b.entitled_days,
      carried_forward: b.carried_forward || 0,
    }));

    const { error } = await hrSupabaseAdmin
      .from("hr_leave_balances")
      .upsert(rows, { onConflict: "user_id,year,leave_type" });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
