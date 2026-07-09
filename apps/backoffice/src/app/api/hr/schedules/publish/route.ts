import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { linkChecklistsToSchedule } from "@/lib/hr/agents/checklist-linker";
import { canAccessOutlet, hasModuleAccess } from "@/lib/hr/scope";
import { gateSchedule } from "@/lib/hr/labour-gate";
import { sendOpsPush } from "@/lib/ops-push";

export const dynamic = "force-dynamic";

// POST: preview, publish, or unpublish a weekly schedule.
// Body: { outlet_id, week_start, action: 'preview' | 'publish' | 'unpublish',
//         reason?, override_reason? }
//
// Publish runs the labour-cost gate (docs/design/people-cost-gating-loop.md):
//   green   → publishes
//   amber   → publishes only with a typed `reason` (logged on the schedule)
//   red     → OWNER only, with `override_reason` (logged)
//   unknown → no revenue history; treated like amber
// Data blockers (shift for a profile-less or rate-less person) refuse publish
// outright — a gate on an undercounted roster would lie.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await hasModuleAccess(session, "hr:schedules"))) {
    return NextResponse.json({ error: "Forbidden — no access to Schedules" }, { status: 403 });
  }

  const body = await req.json();
  const { outlet_id, week_start, action, reason, override_reason } = body as {
    outlet_id: string;
    week_start: string;
    action: string;
    reason?: string;
    override_reason?: string;
  };

  // MANAGER can only act on outlets they're assigned to
  if (session.role === "MANAGER") {
    const allowed = await canAccessOutlet(session, outlet_id);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden — managers can only publish their assigned outlets" }, { status: 403 });
    }
  }

  if (action === "preview") {
    const gate = await gateSchedule(outlet_id, week_start);
    return NextResponse.json({ gate });
  }

  const { data: schedule } = await hrSupabaseAdmin
    .from("hr_schedules")
    .select("id, status, ai_notes")
    .eq("outlet_id", outlet_id)
    .eq("week_start", week_start)
    .maybeSingle();

  if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  if (action === "publish") {
    const gate = await gateSchedule(outlet_id, week_start);

    if (gate.blockers.length > 0) {
      return NextResponse.json(
        { error: "Roster has uncostable shifts — fix HR profiles/rates first", gate },
        { status: 422 },
      );
    }

    const pctLabel = gate.pct == null ? "n/a" : `${(gate.pct * 100).toFixed(1)}%`;
    let gateNote: string;
    if (gate.verdict === "green") {
      gateNote = `green ${pctLabel}`;
    } else if (gate.verdict === "amber" || gate.verdict === "unknown") {
      if (!reason || reason.trim().length < 5) {
        return NextResponse.json(
          {
            error:
              gate.verdict === "unknown"
                ? "No revenue history to budget against — a reason is required to publish"
                : `Roster is ${pctLabel} of forecast (target ${(gate.targetPct * 100).toFixed(0)}%) — a reason is required to publish over target`,
            gate,
          },
          { status: 422 },
        );
      }
      gateNote = `${gate.verdict} ${pctLabel} reason: ${reason.trim()}`;
    } else {
      // red — over ceiling. Interim policy (owner, 2026-07-05): a typed
      // reason publishes, from any role allowed here — still logged loudly
      // as an override so the weekly variance digest surfaces it.
      const redReason = (override_reason ?? reason ?? "").trim();
      if (redReason.length < 5) {
        return NextResponse.json(
          {
            error: `Roster is ${pctLabel} of forecast — over the ${(gate.ceilingPct * 100).toFixed(0)}% ceiling. A reason is required to publish.`,
            gate,
          },
          { status: 422 },
        );
      }
      gateNote = `RED OVERRIDE ${pctLabel} by ${session.role.toLowerCase()}: ${redReason}`;
    }
    for (const w of gate.warnings) gateNote += ` | ${w}`;

    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const note = `[labour-gate ${stamp}] ${gateNote}`;
    const aiNotes = schedule.ai_notes ? `${schedule.ai_notes}\n${note}` : note;

    const { error } = await hrSupabaseAdmin
      .from("hr_schedules")
      .update({
        status: "published",
        published_by: session.id,
        published_at: new Date().toISOString(),
        estimated_labor_cost: gate.rosterCost,
        total_labor_hours: gate.rosterHours,
        ai_notes: aiNotes,
      })
      .eq("id", schedule.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Notify everyone rostered this week that their shifts are live (best-effort,
    // same push channel as the ops workspace). Tap routes to My Shifts. Skip
    // "00:00" placeholder rows so only real shift-holders are pinged.
    const { data: shiftRows } = await hrSupabaseAdmin
      .from("hr_schedule_shifts")
      .select("user_id")
      .eq("schedule_id", schedule.id)
      .neq("start_time", "00:00");
    const affected = [
      ...new Set(
        (shiftRows ?? [])
          .map((r) => r.user_id as string)
          .filter(Boolean),
      ),
    ];
    await Promise.allSettled(
      affected.map((uid) =>
        sendOpsPush({
          userId: uid,
          kind: "shift",
          title: "Schedule published",
          body: "Your new shifts have been published.",
        }),
      ),
    );

    // Auto-link SOPs/checklists to shifts
    let checklistResult = null;
    try {
      checklistResult = await linkChecklistsToSchedule(schedule.id);
    } catch (err) {
      console.error("Checklist linking failed:", err);
    }

    return NextResponse.json({ success: true, gate, checklists: checklistResult });
  }

  if (action === "unpublish") {
    const { error } = await hrSupabaseAdmin
      .from("hr_schedules")
      .update({ status: "draft", published_at: null })
      .eq("id", schedule.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
