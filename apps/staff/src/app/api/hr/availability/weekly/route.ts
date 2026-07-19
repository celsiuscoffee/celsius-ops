import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
// Service-role client: these hr_* tables are RLS-enabled with no policies, so the
// anon client reads zero rows. Access stays scoped by the getSession gate + the
// per-user filters below.
import { supabaseAdmin as supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Weekly recurring availability — the pattern the AI scheduler fills against.
// Semantics (same as the backoffice Assist + generator): NO rows at all means
// "flexible, any day any time"; once rows exist they are a whitelist — days
// without a row are treated as unavailable. available_from/until NULL = whole
// day. This route is self-only; managers edit staff patterns in the backoffice.

type DayInput = {
  day_of_week: number; // 0=Sun … 6=Sat
  available_from: string | null; // "HH:MM" | null = from open
  available_until: string | null; // "HH:MM" | null = to close
};

// GET: my weekly pattern
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("hr_staff_weekly_availability")
    .select("id, day_of_week, available_from, available_until, is_preferred, max_shifts_per_week, notes")
    .eq("user_id", session.id)
    .order("day_of_week");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ weekly: data || [] });
}

// POST: replace my whole weekly pattern (wholesale, same as the WhatsApp PT
// loop does — no per-row PATCH, the pattern is small enough to resubmit).
// Body: { days: DayInput[], max_shifts_per_week?: number|null }
// An empty days array clears the pattern back to "flexible".
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as { days?: DayInput[]; max_shifts_per_week?: number | null };
  const days = Array.isArray(body.days) ? body.days : null;
  if (!days) return NextResponse.json({ error: "days array required" }, { status: 400 });
  if (days.length > 7) return NextResponse.json({ error: "at most 7 days" }, { status: 400 });

  const timeRe = /^\d{2}:\d{2}$/;
  const seen = new Set<number>();
  for (const d of days) {
    if (!Number.isInteger(d.day_of_week) || d.day_of_week < 0 || d.day_of_week > 6) {
      return NextResponse.json({ error: "day_of_week must be 0-6" }, { status: 400 });
    }
    if (seen.has(d.day_of_week)) {
      return NextResponse.json({ error: "duplicate day_of_week" }, { status: 400 });
    }
    seen.add(d.day_of_week);
    for (const t of [d.available_from, d.available_until]) {
      if (t != null && !timeRe.test(t)) {
        return NextResponse.json({ error: "times must be HH:MM" }, { status: 400 });
      }
    }
    if (d.available_from && d.available_until && d.available_from >= d.available_until) {
      return NextResponse.json({ error: "available_from must be before available_until" }, { status: 400 });
    }
  }
  let maxShifts: number | null = null;
  if (body.max_shifts_per_week != null) {
    const n = Number(body.max_shifts_per_week);
    if (!Number.isInteger(n) || n < 1 || n > 7) {
      return NextResponse.json({ error: "max_shifts_per_week must be 1-7" }, { status: 400 });
    }
    maxShifts = n;
  }

  // Replace wholesale (matches pt-loop inbound.ts) — delete then insert.
  const { error: delErr } = await supabase
    .from("hr_staff_weekly_availability")
    .delete()
    .eq("user_id", session.id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  if (days.length > 0) {
    // Live table has NOT NULL from/until — "any time" is stored as the explicit
    // full-day window 00:00–23:59 (readers treat it the same as unconstrained).
    const { error: insErr } = await supabase.from("hr_staff_weekly_availability").insert(
      days.map((d) => ({
        user_id: session.id,
        day_of_week: d.day_of_week,
        available_from: d.available_from ?? "00:00",
        available_until: d.available_until ?? "23:59",
        is_preferred: false,
        max_shifts_per_week: maxShifts,
      })),
    );
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, days: days.length });
}
