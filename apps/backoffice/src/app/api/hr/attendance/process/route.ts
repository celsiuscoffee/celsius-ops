import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { processAttendance } from "@/lib/hr/agents/attendance-processor";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { checkCronAuth } from "@celsius/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST: trigger the AI attendance processor
export async function POST(req: Request) {
  // Allow cron or authenticated admin. Fail closed: with CRON_SECRET unset the
  // old compare was `undefined === undefined`, so a request with no header at
  // all counted as the cron.
  const isCron = !!req.headers.get("authorization") && checkCronAuth(req.headers).ok;

  let userId: string | null = null;
  if (!isCron) {
    const session = await getSession();
    if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    userId = session.id;
  }

  // Log agent run
  const { data: run } = await hrSupabaseAdmin
    .from("hr_agent_runs")
    .insert({
      agent_type: "attendance_processor",
      triggered_by: isCron ? "cron" : "manual",
      triggered_by_user_id: userId,
      status: "running",
    })
    .select()
    .single();

  try {
    const result = await processAttendance();

    // Update agent run log
    if (run) {
      await hrSupabaseAdmin
        .from("hr_agent_runs")
        .update({
          status: result.errors.length > 0 ? "failed" : "completed",
          output_summary: result,
          items_processed: result.processed,
          items_flagged: result.flagged,
          items_auto_approved: result.autoApproved,
          error_message: result.errors.length > 0 ? result.errors.join("; ") : null,
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
