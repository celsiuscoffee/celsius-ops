import { NextResponse, NextRequest } from "next/server";
import type { Prisma, PrismaClient } from "@prisma/client";
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

// Matches a bare Outlet UUID, so a till that sends its UUID directly (rather than
// the "outlet-sa" slug) still resolves for the roster lookups below.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

type ShiftRow = { user_id?: string | null; start_time: string | null; end_time: string | null; role_type: string | null };

/** A real working shift — excludes HR's "Rest Day" markers (start==end==00:00,
 *  role_type "Rest Day" — see lib/hr/shift-templates REST_DAY_ID). Approved
 *  leave isn't a shift row at all (it lives in hr_leave_requests), so a staffer
 *  on leave simply has no working shift today. Shared by the gate AND the
 *  candidate-set expansion so the two can never disagree. */
function isWorkingShift(sh: ShiftRow): boolean {
  if (!sh.start_time || !sh.end_time) return false;
  if (sh.start_time === sh.end_time) return false;
  if (sh.role_type === "Rest Day") return false;
  return true;
}

/** Today's published roster at an outlet, fetched ONCE per login and shared by
 *  the candidate set and the schedule gate (previously the same two HR queries
 *  ran twice per request). null = couldn't load (error / no outlet) — callers
 *  treat that as "no roster info", never as a lockout. */
type TodayRoster = { published: boolean; shiftsByUser: Map<string, ShiftRow[]> };

async function loadTodayRoster(outletUuid: string | null): Promise<TodayRoster | null> {
  if (!outletUuid) return null;
  try {
    const { date } = mytParts();
    const { data: scheds } = await hrSupabaseAdmin
      .from("hr_schedules")
      .select("id")
      .eq("outlet_id", outletUuid)
      .eq("status", "published")
      .lte("week_start", date)
      .gte("week_end", date);
    const schedIds = (scheds ?? []).map((s: { id: string }) => s.id);
    if (schedIds.length === 0) return { published: false, shiftsByUser: new Map() };
    const { data: shifts } = await hrSupabaseAdmin
      .from("hr_schedule_shifts")
      .select("user_id, start_time, end_time, role_type")
      .in("schedule_id", schedIds)
      .eq("shift_date", date);
    const shiftsByUser = new Map<string, ShiftRow[]>();
    for (const sh of (shifts ?? []) as ShiftRow[]) {
      if (!sh.user_id) continue;
      const arr = shiftsByUser.get(sh.user_id) ?? [];
      arr.push(sh);
      shiftsByUser.set(sh.user_id, arr);
    }
    return { published: true, shiftsByUser };
  } catch (e) {
    console.warn("[AUTH] loadTodayRoster error:", e);
    return null;
  }
}

/** user_ids with a WORKING shift on today's roster — the staff who may sign in
 *  at this till even when their home `outletId` is a different branch. Rest-Day
 *  rows are excluded so they can't widen the duplicate-PIN collision surface. */
function rosteredWorkingUserIds(roster: TodayRoster | null): string[] {
  if (!roster) return [];
  const ids: string[] = [];
  for (const [userId, shifts] of roster.shiftsByUser) {
    if (shifts.some(isWorkingShift)) ids.push(userId);
  }
  return ids;
}

/** Decide whether `userId` may open the till at `outletId` right now. Pass the
 *  preloaded `roster` for the same outlet to skip re-querying HR; omit it (or
 *  pass null) and the gate fetches its own. */
async function evaluateScheduleGate(
  userId: string,
  role: string,
  outletId: string | null,
  roster?: TodayRoster | null,
): Promise<Gate> {
  try {
    if (MANAGER_ROLES.has(role)) return { allowed: true, shiftEnd: null, reason: "manager" };
    if (!outletId) return { allowed: true, shiftEnd: null, reason: "no-outlet" };

    const { date, minutes } = mytParts();
    const r = roster ?? (await loadTodayRoster(outletId));
    // Roster unloadable → HR hiccup; never let it lock staff out of the till.
    if (!r) return { allowed: true, shiftEnd: null, reason: "gate-error" };
    // No published roster → nothing to gate against; don't brick the till.
    if (!r.published) return { allowed: true, shiftEnd: null, reason: "no-published-roster" };

    // Roster-exempt staff (managers' floaters, owners' relatives, etc.) bypass.
    const { data: prof } = await hrSupabaseAdmin
      .from("hr_employee_profiles")
      .select("schedule_required")
      .eq("user_id", userId)
      .maybeSingle();
    if (prof && prof.schedule_required === false) return { allowed: true, shiftEnd: null, reason: "exempt" };

    for (const sh of r.shiftsByUser.get(userId) ?? []) {
      if (!isWorkingShift(sh)) continue;
      const start = timeToMin(sh.start_time!);
      const end = timeToMin(sh.end_time!);
      if (minutes >= start - PRE_GRACE_MIN && minutes <= end + POST_GRACE_MIN) {
        return { allowed: true, shiftEnd: endIso(date, sh.end_time!, POST_GRACE_MIN), reason: "scheduled" };
      }
    }
    return { allowed: false, reason: "not-scheduled" };
  } catch (e) {
    // Never let an HR-query hiccup lock staff out of the till.
    console.warn("[AUTH] schedule gate error (fail-open):", e);
    return { allowed: true, shiftEnd: null, reason: "gate-error" };
  }
}

/** The POS sends a STRING outlet id (e.g. "outlet-sa"); staff are bound to the
 *  UUID "Outlet" id. Map string → UUID by matching name so outlet-bound staff
 *  land in the PIN candidate set (without this, only null-outlet owners/managers
 *  matched and outlet baristas couldn't sign in). Returns null when the input is
 *  already a UUID / unmapped — the caller keeps the original value alongside. */
async function resolveOutletUuid(prisma: PrismaClient, outletId: string | null | undefined): Promise<string | null> {
  if (!outletId) return null;
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT o2.id FROM outlets o1 JOIN "Outlet" o2 ON o2.name = o1.name WHERE o1.id = ${outletId} LIMIT 1`;
    const uuid: string | undefined = rows?.[0]?.id;
    return uuid && uuid !== outletId ? uuid : null;
  } catch (e) {
    console.warn("[AUTH] outlet UUID resolve failed:", e);
    return null;
  }
}

/** The till's canonical Outlet UUID, from whatever id form the POS sent.
 *  UUID → passthrough; slug → Prisma name-join; if Prisma is down, the same
 *  name-join via Supabase — so a Prisma outage can't silently downgrade
 *  cross-outlet logins to home-outlet-only. null = genuinely unresolvable. */
async function resolveTillOutletUuid(outletId: string | null): Promise<string | null> {
  if (!outletId) return null;
  if (UUID_RE.test(outletId)) return outletId;
  try {
    const { prisma } = await import("@/lib/prisma");
    const uuid = await resolveOutletUuid(prisma, outletId);
    if (uuid) return uuid;
  } catch {
    /* Prisma unavailable → resolve via Supabase below */
  }
  try {
    const { data: o1 } = await hrSupabaseAdmin.from("outlets").select("name").eq("id", outletId).maybeSingle();
    const name = (o1 as { name?: string } | null)?.name;
    if (!name) return null;
    const { data: o2 } = await hrSupabaseAdmin.from("Outlet").select("id").eq("name", name).maybeSingle();
    return (o2 as { id?: string } | null)?.id ?? null;
  } catch (e) {
    console.warn("[AUTH] till outlet resolve failed:", e);
    return null;
  }
}

/** Validate a manager-override PIN against managers of the till's outlet.
 *  Takes BOTH id forms (the raw slug the POS sent + the resolved UUID) so
 *  managers bound under either form match — no internal re-resolution. */
async function resolveManagerOverride(
  overridePin: string,
  outletSlug: string | null,
  outletUuid: string | null,
): Promise<{ id: string; name: string } | null> {
  if (!overridePin || overridePin.length < 6) return null;
  let candidates: { id: string; name: string; pin: string | null }[] = [];
  try {
    const { prisma } = await import("@/lib/prisma");
    const where: Prisma.UserWhereInput = {
      pin: { not: null }, status: "ACTIVE", role: { in: ["OWNER", "ADMIN", "MANAGER"] },
    };
    if (outletSlug || outletUuid) {
      const or: Prisma.UserWhereInput[] = [{ outletId: null }];
      if (outletSlug) or.push({ outletId: outletSlug });
      if (outletUuid && outletUuid !== outletSlug) or.push({ outletId: outletUuid });
      where.OR = or;
    }
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

async function findActiveUsersWithPin(outletId?: string, rosteredIds: string[] = []) {
  if (!INV_SUPABASE_URL || !INV_ANON_KEY) {
    throw new Error("LEGACY_INVENTORY_SUPABASE_URL + LEGACY_INVENTORY_SUPABASE_ANON_KEY env vars required");
  }
  let url = `${INV_SUPABASE_URL}/rest/v1/User?status=eq.ACTIVE&pin=not.is.null&select=id,name,role,pin,outletId`;
  if (outletId) {
    // Match this outlet OR users with no outlet binding (owners/managers) OR
    // staff rostered at this till today (cross-outlet covers) — mirrors the
    // Prisma path so the candidate set doesn't shrink when Prisma is down.
    // PostgREST OR syntax: or=(outletId.is.null,outletId.eq.<id>,id.in.(...))
    const arms = [`outletId.is.null`, `outletId.eq.${outletId}`];
    if (rosteredIds.length) arms.push(`id.in.(${rosteredIds.join(",")})`);
    url += `&or=(${arms.join(",")})`;
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

    // The till's outlet, resolved ONCE into its canonical UUID, plus today's
    // published roster there — shared by the candidate set, the schedule gate
    // and the manager override (previously the same roster queries ran twice
    // per login and the Prisma-fallback path missed the roster entirely).
    const tillSlug: string | null = typeof outletId === "string" && outletId ? outletId : null;
    const tillOutletUuid = await resolveTillOutletUuid(tillSlug);
    const roster = await loadTodayRoster(tillOutletUuid);
    // Staff with a WORKING shift at this till today — even if their home
    // `outletId` is a different branch. Lets a multi-outlet staffer land in the
    // candidate set wherever they're scheduled; the gate then confirms the shift.
    const rosteredHere = rosteredWorkingUserIds(roster);

    // Scope to outlet if provided — prevents cross-outlet PIN collisions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
    let candidates: any[] = [];
    try {
      const { prisma } = await import("@/lib/prisma");
      // The POS sends a STRING outlet id ("outlet-sa"); staff are bound to the
      // UUID "Outlet" id. Scope by BOTH forms so outlet-bound staff land in the
      // candidate set (without this, only null-outlet owners/managers matched —
      // baristas couldn't sign in). Cross-outlet roles (outletId IS NULL) always
      // match; the duplicate-PIN guard below still catches collisions across
      // the merged set.
      const where: Prisma.UserWhereInput = { pin: { not: null }, status: "ACTIVE" };
      if (tillSlug) {
        const or: Prisma.UserWhereInput[] = [{ outletId: null }, { outletId: tillSlug }];
        if (tillOutletUuid && tillOutletUuid !== tillSlug) or.push({ outletId: tillOutletUuid });
        if (rosteredHere.length) or.push({ id: { in: rosteredHere } });
        where.OR = or;
      }
      candidates = await prisma.user.findMany({
        where,
        include: { outlet: { select: { id: true, name: true } } },
      });
    } catch (prismaErr) {
      console.warn("[AUTH] Prisma fallback to Supabase REST:", prismaErr);
      candidates = await findActiveUsersWithPin(tillSlug ?? undefined, rosteredHere);
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
    // The gate judges the TILL's roster (where they're physically signing in),
    // not their home outlet — so a multi-outlet staffer is allowed wherever
    // they're scheduled that day. An unresolvable till outlet fails OPEN inside
    // the gate ('no-outlet') — never against the home outlet, whose id may be a
    // slug that matches zero hr_schedules rows (a silent fail-open in disguise).
    const gate = await evaluateScheduleGate(user.id, user.role, tillOutletUuid, roster);
    let shiftEnd: string | null = null;
    let overrideBy: string | null = null;
    if (gate.allowed) {
      shiftEnd = gate.shiftEnd;
    } else if (resolvedOutletId == null) {
      // Legacy fail-open: an account with NO home branch (floater) was never
      // schedule-gated before the till-roster change — the gate always saw a
      // null outlet. Keep admitting them (2h till TTL, no shiftEnd) rather than
      // silently flipping policy for floater accounts; the login is logged so
      // the pattern stays visible.
      console.warn(`[AUTH] off-roster login (null-home floater): ${user.name} at outlet ${tillOutletUuid}`);
      shiftEnd = null;
    } else {
      if (!overridePin) {
        return NextResponse.json(
          { error: "You're not scheduled right now. Ask a manager to authorise.", code: "NOT_SCHEDULED" },
          { status: 403 },
        );
      }
      const mgr = await resolveManagerOverride(overridePin, tillSlug, tillOutletUuid);
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
