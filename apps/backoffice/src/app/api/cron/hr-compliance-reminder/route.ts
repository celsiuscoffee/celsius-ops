import { NextRequest, NextResponse } from "next/server";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { checkCronAuth } from "@celsius/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Daily cron — flips compliance events to "overdue" once their due_date has
// passed without being marked done, and surfaces a digest of upcoming items
// inside their reminder window. Notification delivery (email/Slack) is left
// as a follow-up — for now, this just keeps the calendar status accurate so
// the HR dashboard widget renders the right colours.
//
// Auth: Bearer CRON_SECRET (Vercel auto-sets).
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const today = new Date().toISOString().slice(0, 10);

  // 1. Mark overdue: due_date < today, status = pending → overdue
  const { data: overdueRows, error: overdueErr } = await hrSupabaseAdmin
    .from("hr_compliance_events")
    .update({ status: "overdue", updated_at: new Date().toISOString() })
    .eq("status", "pending")
    .lt("due_date", today)
    .select("id, title, due_date");
  if (overdueErr) {
    return NextResponse.json({ error: overdueErr.message }, { status: 500 });
  }

  // 2. Items inside the reminder window (due_date - reminder_days <= today < due_date)
  // We can't compute "due_date - reminder_days" cleanly in a single Supabase
  // query, so we fetch pending events ≤ 30 days out and filter in code.
  const horizon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const { data: upcoming } = await hrSupabaseAdmin
    .from("hr_compliance_events")
    .select("id, title, category, due_date, reminder_days")
    .eq("status", "pending")
    .gte("due_date", today)
    .lte("due_date", horizon);

  const inWindow = (upcoming || []).filter((e: { due_date: string; reminder_days: number }) => {
    const reminderStart = new Date(Date.parse(e.due_date) - (e.reminder_days || 14) * 86400000);
    return reminderStart.toISOString().slice(0, 10) <= today;
  });

  return NextResponse.json({
    today,
    flipped_overdue: (overdueRows || []).length,
    in_reminder_window: inWindow.length,
    items: {
      overdue: (overdueRows || []).map((r: { id: string; title: string; due_date: string }) => ({
        id: r.id, title: r.title, due_date: r.due_date,
      })),
      upcoming: inWindow.map((r: { id: string; title: string; category: string; due_date: string }) => ({
        id: r.id, title: r.title, category: r.category, due_date: r.due_date,
      })),
    },
  });
}
