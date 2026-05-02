import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Birthdays + work anniversaries in the next ?days=N (default 30).
// Skips resigned staff. Returns per-user payload for an HR widget.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const days = Number(new URL(req.url).searchParams.get("days") || 30);
  const today = new Date();
  const todayMD = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, date_of_birth, join_date, end_date, resigned_at");

  const userIds = (profiles || []).map((p: { user_id: string }) => p.user_id);
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, fullName: true, status: true, outlet: { select: { name: true } } },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const todayStr = today.toISOString().slice(0, 10);
  type Event = {
    user_id: string;
    name: string;
    outlet: string | null;
    type: "birthday" | "anniversary";
    on: string;
    days_until: number;
    years?: number;
  };
  const events: Event[] = [];

  for (const p of profiles || []) {
    const u = userMap.get(p.user_id);
    if (!u || u.status !== "ACTIVE") continue;
    const lastDay = p.end_date || p.resigned_at;
    if (lastDay && lastDay < todayStr) continue;

    if (p.date_of_birth) {
      const next = nextOccurrence(p.date_of_birth);
      const daysUntil = daysBetween(today, next);
      if (daysUntil <= days) {
        events.push({
          user_id: p.user_id,
          name: u.fullName || u.name,
          outlet: u.outlet?.name || null,
          type: "birthday",
          on: next.toISOString().slice(0, 10),
          days_until: daysUntil,
        });
      }
    }
    if (p.join_date) {
      const next = nextOccurrence(p.join_date);
      const daysUntil = daysBetween(today, next);
      if (daysUntil <= days && daysUntil > 0) {
        const years = next.getUTCFullYear() - new Date(p.join_date).getUTCFullYear();
        if (years > 0) {
          events.push({
            user_id: p.user_id,
            name: u.fullName || u.name,
            outlet: u.outlet?.name || null,
            type: "anniversary",
            on: next.toISOString().slice(0, 10),
            days_until: daysUntil,
            years,
          });
        }
      }
    }
  }

  events.sort((a, b) => a.days_until - b.days_until);
  const today_events = events.filter((e) => {
    const eMD = e.on.slice(5);
    return eMD === todayMD;
  });

  return NextResponse.json({
    today: today_events,
    upcoming: events.filter((e) => e.days_until > 0),
    horizon_days: days,
  });
}

function nextOccurrence(dateOfBirth: string): Date {
  const d = new Date(`${dateOfBirth}T00:00:00.000Z`);
  const today = new Date();
  const candidate = new Date(Date.UTC(today.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (candidate < new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))) {
    candidate.setUTCFullYear(candidate.getUTCFullYear() + 1);
  }
  return candidate;
}

function daysBetween(from: Date, to: Date): number {
  const a = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const b = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
