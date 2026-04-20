import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { generateSchedule } from "@/lib/hr/agents/schedule-generator";
import { linkChecklistsToSchedule } from "@/lib/hr/agents/checklist-linker";
import { prisma } from "@/lib/prisma";
import { getAccessibleOutletIds, canAccessOutlet, hasModuleAccess } from "@/lib/hr/scope";

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

  const outlets = await prisma.outlet.findMany({
    where: {
      status: "ACTIVE",
      ...(allowedOutletIds !== null ? { id: { in: allowedOutletIds } } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

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
  const { action, outlet_id, week_start, schedule_id } = body;

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
        input_summary: { outlet_id, week_start },
      })
      .select()
      .single();

    try {
      const result = await generateSchedule(outlet_id, week_start);

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
    if (!schedule_id) {
      return NextResponse.json({ error: "schedule_id required" }, { status: 400 });
    }

    const { data, error } = await hrSupabaseAdmin
      .from("hr_schedules")
      .update({
        status: "published",
        published_by: session.id,
        published_at: new Date().toISOString(),
      })
      .eq("id", schedule_id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Auto-link checklists to the published schedule shifts
    let checklistResult = null;
    try {
      checklistResult = await linkChecklistsToSchedule(schedule_id);
    } catch (err) {
      console.error("Checklist linking failed:", err);
    }

    return NextResponse.json({ schedule: data, checklists: checklistResult });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
