import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { generateSchedule, STAFFING_MODES, type StaffingMode } from "@/lib/hr/agents/schedule-generator";
import { prisma } from "@/lib/prisma";
import { getAccessibleOutletIds, canAccessOutlet, hasModuleAccess } from "@/lib/hr/scope";
import { sortOutlets } from "@/lib/outlet-order";

export const dynamic = "force-dynamic";

// GET: list schedules (optionally filtered by outlet/week)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await hasModuleAccess(session, "hr:schedules"))) {
    return NextResponse.json({ error: "Forbidden — no access to Schedules" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const requestedOutletId = searchParams.get("outlet_id");
  const weekStart = searchParams.get("week_start");

  // MANAGER sees every outlet they're assigned to (outletId + outletIds[]).
  // OWNER/ADMIN see all. Requested outlet is honored only if accessible.
  const allowedOutletIds = await getAccessibleOutletIds(session);
  const outletId = allowedOutletIds === null
    ? requestedOutletId
    : (requestedOutletId && allowedOutletIds.includes(requestedOutletId)
        ? requestedOutletId
        : allowedOutletIds[0] || null);

  const outlets = sortOutlets(
    await prisma.outlet.findMany({
      where: {
        status: "ACTIVE",
        ...(allowedOutletIds !== null ? { id: { in: allowedOutletIds } } : {}),
      },
      select: { id: true, name: true },
    }),
  );

  if (session.role === "MANAGER" && !outletId) {
    return NextResponse.json({ schedules: [], outlets });
  }

  let query = hrSupabaseAdmin
    .from("hr_schedules")
    .select("*")
    .order("week_start", { ascending: false })
    .limit(20);

  if (outletId) query = query.eq("outlet_id", outletId);
  if (weekStart) query = query.eq("week_start", weekStart);

  const { data, error } = await query;
  if (error) {
    // Even if schedules fail, return outlets so dropdown works
    return NextResponse.json({ schedules: [], outlets, error: error.message });
  }

  return NextResponse.json({ schedules: data, outlets });
}

// POST: generate a schedule or publish one
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await hasModuleAccess(session, "hr:schedules"))) {
    return NextResponse.json({ error: "Forbidden — no access to Schedules" }, { status: 403 });
  }

  const body = await req.json();
  const { action, outlet_id, week_start } = body;
  // Staffing mode for AI Fill (tight | mid | safe); default tight if absent/invalid.
  const mode: StaffingMode = STAFFING_MODES.includes(body.mode) ? body.mode : "tight";
  // PT stage: "open_slots" (default) posts demand gaps as bookable slots for
  // staff to REQUEST (manager assigns); "assign" pre-proposes named PTs.
  // Open-slot creation is off for now (owner 2026-07-22) — default generation
  // proposes PT suggestions to confirm in the grid rather than posting slots.
  const ptMode: "open_slots" | "assign" = body.pt_mode === "open_slots" ? "open_slots" : "assign";

  // MANAGER can only act on outlets they're assigned to (outletId + outletIds[])
  if (session.role === "MANAGER" && outlet_id) {
    const allowed = await canAccessOutlet(session, outlet_id);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden — managers can only generate schedules for their assigned outlets" }, { status: 403 });
    }
  }

  if (action === "generate") {
    if (!outlet_id || !week_start) {
      return NextResponse.json({ error: "outlet_id and week_start required" }, { status: 400 });
    }

    // Log agent run
    const { data: run } = await hrSupabaseAdmin
      .from("hr_agent_runs")
      .insert({
        agent_type: "scheduler",
        triggered_by: "manual",
        triggered_by_user_id: session.id,
        status: "running",
        input_summary: { outlet_id, week_start, mode, pt_mode: ptMode },
      })
      .select()
      .single();

    try {
      const result = await generateSchedule(outlet_id, week_start, mode, ptMode);

      if (run) {
        await hrSupabaseAdmin
          .from("hr_agent_runs")
          .update({
            status: "completed",
            output_summary: result,
            items_processed: result.shifts,
            completed_at: new Date().toISOString(),
          })
          .eq("id", run.id);
      }

      return NextResponse.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (run) {
        await hrSupabaseAdmin
          .from("hr_agent_runs")
          .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
          .eq("id", run.id);
      }
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (action === "publish") {
    // RETIRED. This legacy path published with no labour gate: no blocker
    // check (uncostable shifts sailed through), no amber/red reason, no cost
    // stamp for the variance digest, no staff push. The UI moved to
    // /api/hr/schedules/publish (which does all of that) and nothing in the
    // repo calls this action anymore — keeping it alive meant gate discipline
    // was one curl away from optional.
    return NextResponse.json(
      { error: "This publish path is retired — use POST /api/hr/schedules/publish, which runs the labour gate." },
      { status: 410 },
    );
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
