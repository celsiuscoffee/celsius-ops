import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
// Service-role client: these hr_* tables are RLS-enabled with no policies, so the
// anon client reads zero rows (screen shows empty). Access stays scoped by the
// getSession gate + the per-user filters below.
import { supabaseAdmin as supabase } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET: my availability records
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || new Date().toISOString().slice(0, 10);
  const toDate = new Date(from);
  toDate.setMonth(toDate.getMonth() + 3);
  const to = searchParams.get("to") || toDate.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("hr_staff_availability")
    .select("*")
    .eq("user_id", session.id)
    .gte("date", from)
    .lte("date", to)
    .order("date");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ availability: data || [] });
}

// POST: set/toggle availability for a date
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { date, availability, reason } = body as {
    date: string;
    availability: "unavailable" | "preferred" | "available";
    reason?: string;
  };

  if (!date || !availability) {
    return NextResponse.json({ error: "date and availability required" }, { status: 400 });
  }

  // Don't allow setting blockout dates in the past
  const today = new Date().toISOString().slice(0, 10);
  if (date < today) {
    return NextResponse.json({ error: "Cannot set availability for past dates" }, { status: 400 });
  }

  // Blocking a date that ALREADY holds a published shift is a conflict the
  // roster owner must hear about — silently accepting it is how a shift ended
  // up live-but-invisible under a BLOCKED cell (field report 2026-08-15). The
  // block is still ACCEPTED: a staffer's constraint is information we never
  // want to suppress, and the shift stands until a manager changes it. But the
  // staffer is told that, and the manager gets a push.
  let rosteredConflict: { shifts: Array<{ shift_date: string; start_time: string; end_time: string }>; message: string } | null = null;
  if (availability === "unavailable") {
    const { data: conflicts } = await supabase
      .from("hr_schedule_shifts")
      .select("shift_date, start_time, end_time, notes, hr_schedules!inner(status)")
      .eq("user_id", session.id)
      .eq("shift_date", date)
      .eq("hr_schedules.status", "published")
      .neq("start_time", "00:00");
    const real = ((conflicts || []) as Array<{ shift_date: string; start_time: string; end_time: string; notes: string | null }>)
      .filter((s) => s.notes !== "rest_day");
    if (real.length > 0) {
      rosteredConflict = {
        shifts: real.map(({ shift_date, start_time, end_time }) => ({ shift_date, start_time, end_time })),
        message:
          "You are already rostered on this date. Your block has been recorded, but the shift stands until a manager changes the roster — please also tell your manager directly.",
      };
      // Best-effort Expo push to the staffer's manager (fallback: outlet
      // managers) — same token store + API the backoffice ops-push uses.
      // A push failure must never fail the availability write.
      try {
        const { data: prof } = await supabase
          .from("hr_employee_profiles")
          .select("manager_user_id")
          .eq("user_id", session.id)
          .maybeSingle();
        let targetIds: string[] = prof?.manager_user_id ? [prof.manager_user_id] : [];
        if (targetIds.length === 0 && session.outletId) {
          const managers = await prisma.user.findMany({
            where: { status: "ACTIVE", role: "MANAGER", OR: [{ outletId: session.outletId }, { outletIds: { has: session.outletId } }] },
            select: { id: true },
          });
          targetIds = managers.map((m) => m.id);
        }
        if (targetIds.length > 0) {
          const { data: tokens } = await supabase
            .from("hr_push_tokens")
            .select("token")
            .in("user_id", targetIds);
          const messages = (tokens || []).map((t: { token: string }) => ({
            to: t.token,
            title: "Roster conflict",
            body: `${session.name || "A staffer"} blocked ${date} but is rostered ${real[0].start_time.slice(0, 5)}-${real[0].end_time.slice(0, 5)} that day. Adjust the roster.`,
            data: { kind: "roster_conflict", date },
          }));
          if (messages.length > 0) {
            await fetch("https://exp.host/--/api/v2/push/send", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(messages),
            });
          }
        }
      } catch (e) {
        console.error("[availability] conflict push failed:", e);
      }
    }
  }

  // Upsert
  const { data, error } = await supabase
    .from("hr_staff_availability")
    .upsert(
      {
        user_id: session.id,
        date,
        availability,
        reason: reason || null,
      },
      { onConflict: "user_id,date" },
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ availability: data, rostered_conflict: rosteredConflict });
}

// DELETE: remove an availability record
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");

  if (!date) return NextResponse.json({ error: "date required" }, { status: 400 });

  const { error } = await supabase
    .from("hr_staff_availability")
    .delete()
    .eq("user_id", session.id)
    .eq("date", date);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
