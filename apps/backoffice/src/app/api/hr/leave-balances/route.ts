import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { LEAVE_TYPES } from "@/lib/hr/constants";
import { prisma } from "@/lib/prisma";

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

    // Insert ONLY missing rows. ignoreDuplicates:true = ON CONFLICT DO NOTHING —
    // with false, this upsert OVERWROTE every existing row (used/pending zeroed,
    // hand-set entitlements flattened to defaults) while the settings-page copy
    // promised "existing balances are preserved". One click mid-year would have
    // destroyed the year's leave accounting with no backup.
    const { count: existingCount } = await hrSupabaseAdmin
      .from("hr_leave_balances")
      .select("id", { count: "exact", head: true })
      .eq("year", targetYear);

    const { error } = await hrSupabaseAdmin
      .from("hr_leave_balances")
      .upsert(rows, { onConflict: "user_id,year,leave_type", ignoreDuplicates: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      success: true,
      initialized: Math.max(0, rows.length - (existingCount ?? 0)),
      preserved: existingCount ?? 0,
      employees: profiles.length,
      year: targetYear,
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
