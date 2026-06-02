import { NextResponse, NextRequest } from "next/server";
import { createToken, verifyPin, hashPin, COOKIE_NAME, SESSION_MAX_AGE } from "@/lib/pos-auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";

const INV_SUPABASE_URL = process.env.LEGACY_INVENTORY_SUPABASE_URL || "";
const INV_ANON_KEY = process.env.LEGACY_INVENTORY_SUPABASE_ANON_KEY || "";

// ─── Open-Store schedule gate ────────────────────────────────
// Rostered staff may only sign the till in during their scheduled shift
// (HR Schedules). Logging in then auto-opens the store and the returned
// `shiftEnd` drives the till's auto-logout at shift end. Manager-tier roles
// and roster-exempt staff bypass the gate; if no roster is published for the
// outlet/week we fail OPEN so an ops gap never bricks the till.
const MANAGER_ROLES = new Set(["OWNER", "ADMIN", "MANAGER"]);
const PRE_GRACE_MIN = 30; // can open the store up to 30 min before shift start
const POST_GRACE_MIN = 30; // and stay signed in 30 min past shift end to close up

/** "Now" in Malaysia (UTC+8, no DST): today's date + minutes-since-midnight. */
function mytParts(now = new Date()): { date: string; minutes: number } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value])) as Record<string, string>;
  let hh = parseInt(p.hour, 10);
  if (hh === 24) hh = 0; // some runtimes emit "24" at midnight
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: hh * 60 + parseInt(p.minute, 10) };
}

function timeToMin(t: string): number {
  const [h, m] = t.split(":");
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

/** ISO timestamp for `date`@`endTime` MYT, plus a grace buffer. */
function endIso(date: string, endTime: string, graceMin: number): string {
  return new Date(Date.parse(`${date}T${endTime}+08:00`) + graceMin * 60000).toISOString();
}

type Gate =
  | { allowed: true; shiftEnd: string | null; reason: string }
  | { allowed: false; reason: string };

/** Decide whether `userId` may open the till at `outletId` right now. */
async function evaluateScheduleGate(userId: string, role: string, outletId: string | null): Promise<Gate> {
  try {
    if (MANAGER_ROLES.has(role)) return { allowed: true, shiftEnd: null, reason: "manager" };
    if (!outletId) return { allowed: true, shiftEnd: null, reason: "no-outlet" };

    const { date, minutes } = mytParts();

    // Published roster(s) covering today for this outlet.
    const { data: scheds } = await hrSupabaseAdmin
      .from("hr_schedules")
      .select("id")
      .eq("outlet_id", outletId)
      .eq("status", "published")
      .lte("week_start", date)
      .gte("week_end", date);
    const schedIds = (scheds ?? []).map((s: { id: string }) => s.id);
    // No published roster → nothing to gate against; don't brick the till.
    if (schedIds.length === 0) return { allowed: true, shiftEnd: null, reason: "no-published-roster" };

    // Roster-exempt staff (managers' floaters, owners' relatives, etc.) bypass.
    const { data: prof } = await hrSupabaseAdmin
      .from("hr_employee_profiles")
      .select("schedule_required")
      .eq("user_id", userId)
      .maybeSingle();
    if (prof && prof.schedule_required === false) return { allowed: true, shiftEnd: null, reason: "exempt" };

    // This user's shifts today across the published roster(s).
    const { data: shifts } = await hrSupabaseAdmin
      .from("hr_schedule_shifts")
      .select("start_time, end_time, role_type")
      .in("schedule_id", schedIds)
      .eq("user_id", userId)
      .eq("shift_date", date);

    for (const sh of (shifts ?? []) as { start_time: string | null; end_time: string | null; role_type: string | null }[]) {
      if (!sh.start_time || !sh.end_time) continue;
      // HR marks a non-working day as a "Rest Day" shift (start==end==00:00,
      // role_type "Rest Day" — see lib/hr/shift-templates REST_DAY_ID). Approved
      // leave isn't a shift row at all (it lives in hr_leave_requests), so a
      // staffer on leave simply has no working shift today and is gated out.
      if (sh.start_time === sh.end_time) continue;
      if (sh.role_type === "Rest Day") continue;
      const start = timeToMin(sh.start_time);
      const end = timeToMin(sh.end_time);
      if (minutes >= start - PRE_GRACE_MIN && minutes <= end + POST_GRACE_MIN) {
        return { allowed: true, shiftEnd: endIso(date, sh.end_time, POST_GRACE_MIN), reason: "scheduled" };
      }
    }
    return { allowed: false, reason: "not-scheduled" };
  } catch (e) {
    // Never let an HR-query hiccup lock staff out of the till.
    console.warn("[AUTH] schedule gate error (fail-open):", e);
    return { allowed: true, shiftEnd: null, reason: "gate-error" };
  }
}

/** Validate a manager-override PIN. Returns the authorising manager, or null. */
async function resolveManagerOverride(
  overridePin: string,
  outletId: string | null,
): Promise<{ id: string; name: string } | null> {
  if (!overridePin || overridePin.length < 6) return null;
  let candidates: { id: string; name: string; pin: string | null }[] = [];
  try {
    const { prisma } = await import("@/lib/prisma");
    const where: any = {
      pin: { not: null }, status: "ACTIVE", role: { in: ["OWNER", "ADMIN", "MANAGER"] },
    };
    if (outletId) where.OR = [{ outletId: null }, { outletId }];
    candidates = await prisma.user.findMany({ where, select: { id: true, name: true, pin: true } });
  } catch {
    return null;
  }
  for (const u of candidates) {
    if (!u.pin) continue;
    const { match } = await verifyPin(overridePin, u.pin);
    if (match) return { id: u.id, name: u.name };
  }
  return null;
}

async function findActiveUsersWithPin(outletId?: string) {
  if (!INV_SUPABASE_URL || !INV_ANON_KEY) {
    throw new Error("LEGACY_INVENTORY_SUPABASE_URL + LEGACY_INVENTORY_SUPABASE_ANON_KEY env vars required");
  }
  let url = `${INV_SUPABASE_URL}/rest/v1/User?status=eq.ACTIVE&pin=not.is.null&select=id,name,role,pin,outletId`;
  if (outletId) {
    // Match this outlet OR users with no outlet binding (owners/managers).
    // PostgREST OR syntax: or=(outletId.is.null,outletId.eq.<id>)
    url += `&or=(outletId.is.null,outletId.eq.${outletId})`;
  }
  const res = await fetch(url, {
    headers: {
      apikey: INV_ANON_KEY,
      Authorization: `Bearer ${INV_ANON_KEY}`,
    },
  });
  if (!res.ok) {
    console.error("[AUTH] Supabase REST error:", res.status, await res.text().catch(() => ""));
    return [];
  }
  return res.json();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pin, outletId } = body;
    const overridePin: string = (body?.overridePin ?? "").toString();

    if (!pin || pin.length < 6) {
      return NextResponse.json({ error: "PIN required (6 digits)" }, { status: 400 });
    }

    // Scope to outlet if provided — prevents cross-outlet PIN collisions
    let candidates: any[] = [];
    try {
      const { prisma } = await import("@/lib/prisma");
      // Scope: outlet-bound staff (outletId = selected) PLUS cross-outlet
      // roles (outletId IS NULL — owners, managers, head office) who must
      // be able to log in at any terminal. The duplicate-PIN guard below
      // still catches collisions across the merged set.
      const where: any = { pin: { not: null }, status: "ACTIVE" };
      if (outletId) where.OR = [{ outletId: null }, { outletId }];
      candidates = await prisma.user.findMany({
        where,
        include: { outlet: { select: { id: true, name: true } } },
      });
    } catch (prismaErr) {
      console.warn("[AUTH] Prisma fallback to Supabase REST:", prismaErr);
      candidates = await findActiveUsersWithPin(outletId);
    }

    // Find ALL matching PINs (not just first) to detect collisions
    const matches: typeof candidates = [];
    for (const user of candidates) {
      const userPin = user.pin;
      if (!userPin) continue;
      const { match } = await verifyPin(pin, userPin);
      if (match) matches.push(user);
    }

    if (matches.length === 0) {
      return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
    }

    if (matches.length > 1) {
      const names = matches.map((u) => u.name).join(", ");
      console.warn(`[AUTH] Duplicate PIN detected for: ${names}`);
      return NextResponse.json(
        { error: `Duplicate PIN — contact manager (${names})` },
        { status: 409 },
      );
    }

    const user = matches[0];

    // Progressive rehash
    const { needsRehash } = await verifyPin(pin, user.pin);
    if (needsRehash) {
      try {
        const { prisma } = await import("@/lib/prisma");
        const hashed = await hashPin(pin);
        await prisma.user.update({ where: { id: user.id }, data: { pin: hashed } });
      } catch { /* ignore rehash errors */ }
    }

    const outletName = user.outlet?.name ?? null;
    const resolvedOutletId = user.outletId ?? user.outlet?.id ?? null;

    // ─── Open-Store schedule gate ────────────────────────────
    // Rostered staff can only sign in during their scheduled shift. When
    // scheduled, `shiftEnd` is returned so the till auto-logs-out at end of
    // shift. If blocked, a manager PIN (overridePin) can authorise an exception.
    const gate = await evaluateScheduleGate(user.id, user.role, resolvedOutletId);
    let shiftEnd: string | null = null;
    let overrideBy: string | null = null;
    if (gate.allowed) {
      shiftEnd = gate.shiftEnd;
    } else {
      if (!overridePin) {
        return NextResponse.json(
          { error: "You're not scheduled right now. Ask a manager to authorise.", code: "NOT_SCHEDULED" },
          { status: 403 },
        );
      }
      const mgr = await resolveManagerOverride(overridePin, resolvedOutletId);
      if (!mgr || mgr.id === user.id) {
        return NextResponse.json(
          { error: "Manager PIN not recognised.", code: "OVERRIDE_FAILED" },
          { status: 403 },
        );
      }
      overrideBy = mgr.name;
      shiftEnd = null; // override sessions fall back to the till's 2h TTL
      console.warn(`[AUTH] Open-Store override: ${mgr.name} authorised ${user.name} (not scheduled) at outlet ${resolvedOutletId}`);
    }

    const token = await createToken({
      id: user.id,
      name: user.name,
      role: user.role,
      outletId: resolvedOutletId,
      outletName,
    });

    const response = NextResponse.json({
      id: user.id,
      name: user.name,
      role: user.role,
      outletId: resolvedOutletId,
      outletName,
      shiftEnd,    // ISO string when rostered (drives till auto-logout), else null
      overrideBy,  // manager name when login was a not-scheduled override, else null
    });

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
      path: "/",
    });

    return response;
  } catch (err) {
    console.error("[AUTH] PIN login error:", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
