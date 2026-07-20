// AI Schedule Generator — rewrite (2026-07, people-cost gating loop).
//
// The previous greedy generator treated FT and PT as interchangeable slot
// fillers and persisted by DELETE-then-INSERT, which wiped the week when a
// run failed mid-way. This version follows the owner's rostering rules:
//
//   1. Default shift templates only (the outlet's morning/middle/closing
//      from shift-templates.ts) — no invented time ranges.
//   2. Full-timers first: they are salaried (sunk cost), so they carry the
//      floor. Each FT gets 6 working days ≈ 45h/week (Employment Act cap).
//   3. Every FT gets an explicit rest day (profile rest_day if set, else
//      staggered Mon–Thu — full crew stays on Fri–Sun, per the manpower
//      workbook).
//   4. Part-timers are SUGGESTIONS, not commitments: PT is the only spend
//      that moves labour % (FT is fixed), so PT slots are chosen inside the
//      remaining budget envelope (target% × forecast − FT cost − rover
//      share) and inserted with notes='pt_suggestion' for the manager to
//      confirm or delete in the grid.
//
// The "agentic" part: an LLM pass proposes WHERE the PT hours do the most
// good — it sees the demand curve (hourly sales), each PT's rate and recent
// hours (fairness), leave, and the budget — but every proposal is validated
// in code against the hard constraints before it is saved. The model
// proposes; the validator disposes. With no API key (or on any model
// failure) a greedy fallback fills the largest demand gaps with the
// cheapest available PT, so generation never depends on the model.
//
// Persistence is atomic (single transaction): the old week is only replaced
// together with the successful insert of the new one. A published week is
// never touched — unpublish first.

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { hrSupabaseAdmin } from "../supabase";
import { templatesForOutlet, workingHours, type ShiftTemplate } from "../shift-templates";
import {
  weeklySalaryShare,
  shiftHours,
  OUTLET_BUDGETS,
  DEFAULT_BUDGET,
  borrowedFtCharge,
  lentFtCredit,
  isManagementPosition,
} from "../labour-gate-lib";
import { ptRateForDate } from "../pt-rate";
import { forecastWeek } from "../labour-gate";
import {
  computeDailyManHours,
  itemsPerManHourFor,
  DEFAULT_BLENDED_RATE,
  type DailyManHours,
} from "../man-hours";
import { computePtPerformance } from "../pt-performance";
import { planFlexPlacement, type FlexPerson } from "../flex-placement";
import { allocateStationCounts, STATION_ANCHOR_TARGET } from "../shift-allocation";
// Station demand + serve-time calibration live in the SHARED demand model
// (lib/hr/demand.ts) — same computation feeds the grid's per-day shortfall.
import { computeWeekDemand, SERVICE_FLOOR } from "../demand";

const MODEL = "claude-sonnet-4-6";
const PT_MAX_HOURS_PER_WEEK = 24;
const PT_MAX_DAYS_PER_WEEK = 5;

const ROVER_POSITIONS = new Set(["manager", "area manager", "head of department", "barista lead"]);

// Staffing mode — a coverage buffer laid ON TOP of the demand-sized heads. The
// sizing (barista/kitchen throughput → heads/hr, floored) is identical in all
// three modes; the mode only decides how much slack to add for breaks/no-shows.
//   tight — no buffer. Staff exactly to the sized heads: serve ~15 min at peak,
//           labour ~target%. No cover for a break or a no-show.
//   mid   — +1 head across the day's PEAK BLOCK (the hours at that day's peak
//           demand). Relief at the busy window; labour ~1 point higher.
//   safe  — +1 head across the ENTIRE open window: break cover all day plus one
//           no-show of slack. Serve <12 min at peak; labour a few points higher.
// The buffer flows through one place (the hourly head count), so required
// man-hours, the peak note, the PT demand gaps and the PT top-up target all move
// together. tight returns 0 everywhere → byte-for-byte the prior behaviour.
export type StaffingMode = "tight" | "mid" | "safe";
export const STAFFING_MODES: StaffingMode[] = ["tight", "mid", "safe"];

type Staff = {
  id: string;
  name: string;
  position: string | null;
  employment_type: string;
  basic_salary: number;
  epf_employer_rate: number | null; // employer EPF from the profile (real rate, not the default)
  hourly_rate: number | null; // PT weekday base
  hourly_rate_weekend: number | null; // PT Sat/Sun rate (null → base)
  rest_day: number | null; // 0=Sun … 6=Sat
  gender: string | null; // profile values: M/F (HR) or male/female (staff app)
  religion: string | null; // staff-app vocabulary: islam/buddhism/…/none
  // "Primary outlet wins": a shared staffer is auto-rostered (FT floor / PT
  // suggestions) only where this is their primary outlet. Elsewhere they must
  // be borrowed manually. True when User.outletId === the outlet being built.
  isPrimaryHere: boolean;
};

type ShiftRow = {
  user_id: string;
  shift_date: string;
  start_time: string; // HH:MM:SS
  end_time: string;
  role_type: string;
  break_minutes: number;
  notes: string | null;
};

type GenerateResult = {
  scheduleId: string;
  mode: StaffingMode;
  shifts: number;
  ptSuggestions: number;
  openSlots: number;
  totalHours: number;
  estimatedCost: number;
  notes: string[];
  manHours: DailyManHours[];
};

// ─── helpers ─────────────────────────────────────────────────────────

function weekDates(weekStart: string): string[] {
  const out: string[] = [];
  const start = new Date(weekStart + "T00:00:00Z");
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function dow(date: string): number {
  return new Date(date + "T00:00:00Z").getUTCDay(); // 0=Sun … 6=Sat
}

function hhmmss(t: string): string {
  return t.length === 5 ? `${t}:00` : t;
}

function isBOH(position: string | null): boolean {
  const p = (position ?? "").toLowerCase();
  return p.includes("kitchen") || p.includes("chef") || p.includes("boh");
}

// Friday prayer (solat Jumaat, ~13:00–14:15): Muslim men leave the floor for
// it, so Friday shifts that span the window are staffed women/non-Muslim
// first (owner rule 2026-07-18). Unknown gender or religion counts as
// ATTENDING — the safe planning assumption; the profile fixes it.
export function attendsFridayPrayer(gender: string | null, religion: string | null): boolean {
  const g = (gender ?? "").trim().toLowerCase();
  const r = (religion ?? "").trim().toLowerCase();
  const female = g.startsWith("f");
  const muslim = r === "" || r === "islam" || r === "muslim";
  return !female && muslim;
}
const FRIDAY = 5;
// A window needs prayer-proofing when it spans the whole ~13:00–14:15 slot.
function coversFridayPrayer(t: ShiftTemplate): boolean {
  return Number(t.start_time.slice(0, 2)) <= 13 && Number(t.end_time.slice(0, 2)) >= 14;
}

// Which station a PT can cover: a kitchen gap needs a kitchen-capable
// position; a barista/counter gap takes anyone who isn't kitchen-only (a
// hybrid "PT Barista/Kitchen" fits both stations).
function fitsStation(position: string | null, station: "kitchen" | "barista"): boolean {
  const p = (position ?? "").toLowerCase();
  return station === "kitchen" ? isBOH(position) : !isBOH(position) || p.includes("barista");
}

// Load the outlet's working templates — the SAME list the grid's shift
// picker shows: DB `hr_shift_templates` (outlet-specific + generic, active)
// first, code fallback when the table is empty. Sorted by start time:
// earliest = opening, latest = closing, everything between = middles
// (e.g. "Middle 1/2/3") — FT anchors on opening/closing; every middle is a
// candidate slot for PT suggestions.
async function loadTemplates(
  outletId: string,
  code: string,
): Promise<{ opening: ShiftTemplate; middles: ShiftTemplate[]; closing: ShiftTemplate }> {
  const { data: dbTemplates } = await hrSupabaseAdmin
    .from("hr_shift_templates")
    .select("id, label, start_time, end_time, break_minutes")
    .eq("is_active", true)
    .or(`outlet_id.eq.${outletId},outlet_id.is.null`)
    .order("start_time");

  type DbTpl = { id: string; label: string; start_time: string; end_time: string; break_minutes: number | null };
  let all: ShiftTemplate[] = ((dbTemplates ?? []) as DbTpl[]).map((t) => ({
    id: t.id,
    label: t.label,
    start_time: t.start_time.slice(0, 5),
    end_time: t.end_time.slice(0, 5),
    break_minutes: t.break_minutes ?? 30,
    color: "gray",
  }));
  if (all.length === 0) {
    all = templatesForOutlet(code)
      .filter((t) => t.id !== "full_day")
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }
  if (all.length === 0) {
    const fallback = templatesForOutlet(code)[0];
    return { opening: fallback, middles: [], closing: fallback };
  }
  if (all.length === 1) return { opening: all[0], middles: [], closing: all[0] };
  return { opening: all[0], middles: all.slice(1, -1), closing: all[all.length - 1] };
}

// ─── generator ───────────────────────────────────────────────────────

// ptMode (owner 2026-07-19: "can ai fill open the slots first before we
// assign anyone?"):
//  - "open_slots" (default): the PT stage assigns NOBODY — every demand gap
//    is posted to hr_open_shifts for staff to book first-come-first-served;
//    the manager assigns whatever is still unbooked closer to the week.
//  - "assign": the previous behaviour — the fill proposes named PTs
//    (pt_suggestion cells) and only leftover gaps become open slots.
export async function generateSchedule(
  outletId: string,
  weekStart: string,
  mode: StaffingMode = "tight",
  ptMode: "open_slots" | "assign" = "open_slots",
): Promise<GenerateResult> {
  const notes: string[] = [];
  const dates = weekDates(weekStart);
  const weekEnd = dates[6];

  // Outlet + budget
  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    select: { id: true, code: true, name: true, loyaltyOutletId: true, daysOpen: true, openTime: true, closeTime: true },
  });
  if (!outlet) throw new Error("Outlet not found");
  const budget = OUTLET_BUDGETS[outlet.code ?? ""] ?? DEFAULT_BUDGET;
  const daysOpen = new Set(outlet.daysOpen?.length ? outlet.daysOpen.map((d) => d % 7) : [0, 1, 2, 3, 4, 5, 6]);
  const tpl = await loadTemplates(outletId, outlet.code ?? "");

  // A published week is the manager's committed roster — never regenerate over it.
  const { data: existing } = await hrSupabaseAdmin
    .from("hr_schedules")
    .select("id, status")
    .eq("outlet_id", outletId)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (existing?.status === "published") {
    throw new Error("This week is published — unpublish it before regenerating");
  }

  // Staff + profiles
  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ outletId }, { outletIds: { has: outletId } }],
      role: { in: ["STAFF", "MANAGER"] },
    },
    select: { id: true, name: true, outletId: true },
  });
  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, position, employment_type, basic_salary, hourly_rate, hourly_rate_weekend, epf_employer_rate, schedule_required, rest_day, gender, religion, join_date, end_date")
    .in("user_id", users.length ? users.map((u) => u.id) : ["-"]);
  type ProfileRow = {
    user_id: string; position: string | null; employment_type: string;
    basic_salary: number | null; hourly_rate: number | null; hourly_rate_weekend: number | null;
    epf_employer_rate: number | null;
    schedule_required: boolean | null; rest_day: number | null;
    gender: string | null; religion: string | null;
    join_date: string | null; end_date: string | null;
  };
  const profileMap = new Map<string, ProfileRow>(((profiles ?? []) as ProfileRow[]).map((p) => [p.user_id, p]));

  const staff: Staff[] = users
    .filter((u) => profileMap.get(u.id)?.schedule_required !== false)
    // Employment window: someone whose last day is BEFORE this week (the
    // deactivate cron only flips User.status after end_date passes) or whose
    // join_date is AFTER it must not be rostered at all. Partial weeks (last
    // day / first day mid-week) are handled per-date below via the onLeave
    // rail (owner 2026-07-19: "check the starting date logic and last day
    // logic during scheduling").
    .filter((u) => {
      const p = profileMap.get(u.id);
      if (p?.end_date && p.end_date < weekStart) return false;
      if (p?.join_date && p.join_date > weekEnd) return false;
      return true;
    })
    .map((u) => {
      const p = profileMap.get(u.id);
      return {
        id: u.id,
        name: u.name,
        position: p?.position ?? null,
        employment_type: p?.employment_type ?? "full_time",
        basic_salary: Number(p?.basic_salary) || 0,
        epf_employer_rate: p?.epf_employer_rate == null ? null : Number(p.epf_employer_rate),
        hourly_rate: p?.hourly_rate == null ? null : Number(p.hourly_rate),
        hourly_rate_weekend: p?.hourly_rate_weekend == null ? null : Number(p.hourly_rate_weekend),
        rest_day: p?.rest_day ?? null,
        gender: p?.gender ?? null,
        religion: p?.religion ?? null,
        isPrimaryHere: u.outletId === outletId,
      };
    })
    // Rovers are placed separately below (2 days/outlet-week); HoD stays HQ.
    .filter((s) => !ROVER_POSITIONS.has((s.position ?? "").trim().toLowerCase()));

  // Rovers — ONLY the rover lead (Barista Lead) auto-rotates 2 days/week at
  // each outlet. Managers / Area Managers are NEVER auto-scheduled (owner rule
  // 2026-07-17): they plan their own floor days and are added manually in the
  // grid. All rover/manager cost is HQ overhead — RM0 to the outlet.
  const { data: roverProfiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, position, basic_salary, epf_employer_rate")
    .in("position", ["Barista Lead"])
    .is("end_date", null);
  type RoverProfile = { user_id: string; position: string; basic_salary: number | null; epf_employer_rate: number | null };
  const roverIds = ((roverProfiles ?? []) as RoverProfile[]).map((p) => p.user_id);
  const roverUsers = roverIds.length
    ? await prisma.user.findMany({ where: { id: { in: roverIds }, status: "ACTIVE" }, select: { id: true, name: true } })
    : [];
  const roverPositionOf = new Map(((roverProfiles ?? []) as RoverProfile[]).map((p) => [p.user_id, p.position]));
  // Rover lead cost follows their hours too (same rotation-cost rule as shared
  // FT): each outlet pays share × (hours here ÷ 45). Managers stay RM0/HQ.
  const roverShareOf = new Map(((roverProfiles ?? []) as RoverProfile[]).map((p) => [p.user_id, weeklySalaryShare(Number(p.basic_salary) || 0, p.epf_employer_rate == null ? null : Number(p.epf_employer_rate))]));

  // "Primary outlet wins": a full-timer carries their 6-day floor only at their
  // primary outlet. A shared FT whose primary is elsewhere is NOT auto-rostered
  // here (their committed hours live at home) — borrow them manually via the
  // grid if needed; the cell/assign routes block a cross-outlet double-book.
  const isFt = (s: Staff) => s.employment_type === "full_time" || s.employment_type === "contract";
  const fullTimers = staff.filter((s) => isFt(s) && s.isPrimaryHere);
  const sharedFtElsewhere = staff.filter((s) => isFt(s) && !s.isPrimaryHere);
  // Part-timers rotate by design — a shared PT stays an eligible suggestion at
  // every outlet they're assigned to, bounded below by cross-outlet caps.
  const partTimers = staff.filter((s) => s.employment_type === "part_time" || s.employment_type === "intern");
  if (fullTimers.length === 0 && partTimers.length === 0) {
    throw new Error(`No schedulable staff at ${outlet.name}`);
  }
  notes.push(`${fullTimers.length} FT + ${partTimers.length} PT schedulable (rovers excluded)`);
  if (sharedFtElsewhere.length > 0) {
    notes.push(`${sharedFtElsewhere.length} shared FT (primary elsewhere) available to fill here as free coverage: ${sharedFtElsewhere.map((s) => s.name).join(", ")}`);
  }

  // Approved leave
  const { data: leaves } = await hrSupabaseAdmin
    .from("hr_leave_requests")
    .select("user_id, start_date, end_date")
    .in("status", ["approved", "ai_approved"])
    .lte("start_date", weekEnd)
    .gte("end_date", weekStart);
  const onLeave = new Set<string>();
  for (const l of (leaves ?? []) as { user_id: string; start_date: string; end_date: string }[]) {
    for (const d of dates) if (d >= l.start_date && d <= l.end_date) onLeave.add(`${l.user_id}:${d}`);
  }

  // Partial employment weeks ride the onLeave rail — every placement site
  // (FT working/resting, rover free days, PT greedy + validator) already
  // consults it, so days before join_date / after end_date are simply never
  // schedulable. A note keeps the manager oriented.
  for (const s of staff) {
    const p = profileMap.get(s.id);
    if (!p?.join_date && !p?.end_date) continue;
    const blockedDays = dates.filter(
      (d) => (p.join_date != null && d < p.join_date) || (p.end_date != null && d > p.end_date),
    );
    if (blockedDays.length === 0) continue;
    for (const d of blockedDays) onLeave.add(`${s.id}:${d}`);
    if (p.end_date && p.end_date >= weekStart && p.end_date <= weekEnd) {
      notes.push(`${s.name}: LAST DAY ${p.end_date} — not scheduled after it.`);
    }
    if (p.join_date && p.join_date > weekStart && p.join_date <= weekEnd) {
      notes.push(`${s.name}: starts ${p.join_date} — not scheduled before it.`);
    }
  }

  // Declared PT availability — fed by the staff apps' "My Availability" input.
  // Weekly rows are a whitelist: a PT WITH rows is only proposable on days that
  // have a row whose window contains the whole shift (same semantics as the
  // Assist candidates route). A PT with NO rows stays unconstrained — the
  // historic default, so an empty table changes nothing. Per-date rows marked
  // unavailable/off block that single date.
  const ptIdsAvail = partTimers.length ? partTimers.map((p) => p.id) : ["-"];
  const { data: wkAvailRows } = await hrSupabaseAdmin
    .from("hr_staff_weekly_availability")
    .select("user_id, day_of_week, available_from, available_until, max_shifts_per_week")
    .in("user_id", ptIdsAvail);
  type WkAvailRow = { user_id: string; day_of_week: number; available_from: string | null; available_until: string | null; max_shifts_per_week: number | null };
  const wkAvailByUser = new Map<string, WkAvailRow[]>();
  for (const a of (wkAvailRows ?? []) as WkAvailRow[]) {
    (wkAvailByUser.get(a.user_id) ?? wkAvailByUser.set(a.user_id, []).get(a.user_id)!).push(a);
  }
  const { data: dateBlocks } = await hrSupabaseAdmin
    .from("hr_staff_availability")
    .select("user_id, date, availability")
    .in("user_id", ptIdsAvail)
    .gte("date", weekStart)
    .lte("date", weekEnd);
  const blockedDates = new Set(
    ((dateBlocks ?? []) as { user_id: string; date: string; availability: string }[])
      .filter((b) => b.availability === "unavailable" || b.availability === "off")
      .map((b) => `${b.user_id}:${b.date}`),
  );
  const toMinHM = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const ptAvailableFor = (userId: string, date: string, startHM: string, endHM: string): boolean => {
    if (blockedDates.has(`${userId}:${date}`)) return false;
    const availRows = wkAvailByUser.get(userId);
    if (!availRows || availRows.length === 0) return true;
    const dw = dow(date);
    return availRows.some((r) => {
      if (r.day_of_week !== dw) return false;
      const from = r.available_from ? toMinHM(r.available_from) : 0;
      const until = r.available_until ? toMinHM(r.available_until) : 24 * 60;
      return from <= toMinHM(startHM) && until >= toMinHM(endHM);
    });
  };
  // max_shifts_per_week (smallest declared) tightens the global 5-day cap.
  const ptMaxDays = (userId: string): number => {
    const caps = (wkAvailByUser.get(userId) ?? [])
      .map((r) => r.max_shifts_per_week)
      .filter((n): n is number => n != null && n > 0);
    return caps.length ? Math.min(PT_MAX_DAYS_PER_WEEK, ...caps) : PT_MAX_DAYS_PER_WEEK;
  };
  if (wkAvailByUser.size > 0) {
    notes.push(`${wkAvailByUser.size} PT with declared availability — fill restricted to their windows`);
  }

  // Cross-outlet bookings this week (rotation): every real shift these staff
  // already hold on ANOTHER outlet's schedule for this same week. Used to
  //   (a) never double-book a shared staffer on a day, and
  //   (b) seed their weekly PT caps so a two-outlet PT can't exceed the
  //       24h / 5-day limit COMBINED across outlets.
  // Rest-day markers (00:00) are skipped; the current outlet's own draft is
  // excluded (it's being rebuilt below).
  const poolIds = users.map((u) => u.id);
  const { data: crossShifts } = poolIds.length
    ? await hrSupabaseAdmin
        .from("hr_schedule_shifts")
        .select("user_id, shift_date, start_time, end_time, break_minutes, schedule_id, hr_schedules!inner(outlet_id, week_start)")
        .in("user_id", poolIds)
        .eq("hr_schedules.week_start", weekStart)
        .neq("start_time", "00:00")
    : { data: [] as unknown[] };
  type CrossRow = {
    user_id: string; shift_date: string; start_time: string; end_time: string;
    break_minutes: number | null; schedule_id: string;
    hr_schedules: { outlet_id: string } | { outlet_id: string }[];
  };
  const bookedElsewhere = new Map<string, Set<string>>();   // user → dates already worked at another outlet
  const hoursElsewhere = new Map<string, number>();          // user → PT hours already committed elsewhere
  for (const r of ((crossShifts ?? []) as unknown as CrossRow[])) {
    const sched = Array.isArray(r.hr_schedules) ? r.hr_schedules[0] : r.hr_schedules;
    const otherOutlet = sched?.outlet_id;
    if (!otherOutlet || otherOutlet === outletId) continue;   // only OTHER outlets
    if (r.schedule_id === existing?.id) continue;             // not this outlet's own draft
    (bookedElsewhere.get(r.user_id) ?? bookedElsewhere.set(r.user_id, new Set()).get(r.user_id)!).add(r.shift_date);
    const h = shiftHours(hhmmss(r.start_time.slice(0, 5)), hhmmss(r.end_time.slice(0, 5))) - (r.break_minutes ?? 0) / 60;
    if (h > 0) hoursElsewhere.set(r.user_id, (hoursElsewhere.get(r.user_id) ?? 0) + h);
  }

  // ── Stage 1: FT skeleton — templates, 45h, rest days ────────────────
  const rows: ShiftRow[] = [];
  // Rest days: profile value wins; otherwise stagger Mon(1)–Thu(4) so the
  // full crew is on Fri–Sun. Sorted by name for a stable rotation.
  // Demand is sized by THROUGHPUT (items made), not ringgit, and SPLIT BY STATION
  // — a barista makes drinks, a kitchen hand makes food, and they peak at
  // different times. Trailing 28 days of item counts per (dow, hour), averaged
  // over the 4 weeks, split barista vs kitchen. Heads/hour = ceil(barista ÷ 8) +
  // ceil(kitchen ÷ 6), floored at the service minimum — sized to hold the
  // 15-minute serve target. (Same model as the HOO staffing report.)
  // Shared demand model (lib/hr/demand.ts) — the SAME computation the labour
  // gate uses for the grid's per-day shortfall, so "what the grid says is
  // short" and "what AI Fill staffs to" can never drift apart.
  const weekDemand = await computeWeekDemand(outlet, weekStart);
  const { demand, itemsByDow, peakByDow, baristaRate, kitchenRate } = weekDemand;
  notes.push(weekDemand.calibrationNote);

  // Staffing-mode buffer (heads added on top of the sized demand for this hour).
  //   tight → 0; safe → +1 every open hour; mid → +1 across the day's peak block
  //   (hours at that day's peak head count). Consumed by required man-hours, the
  //   peak note, the PT demand gaps and the PT top-up target — one lever, applied
  //   uniformly. Only called inside the open-hours loops, so "every open hour"
  //   stays bounded to trading hours.
  const bufferHeads = (dwN: number, hr: number): number => {
    if (mode === "tight") return 0;
    if (mode === "safe") return 1;
    const peak = peakByDow.get(dwN)?.heads;
    if (peak == null) return 0; // no sales that day → nothing to buffer
    const heads = demand.get(`${dwN}:${hr}`) ?? SERVICE_FLOOR;
    return heads >= peak ? 1 : 0; // mid: buffer the peak block only
  };
  notes.push(
    mode === "tight"
      ? "Mode: TIGHT — staffed exactly to sized demand (no break/no-show slack)"
      : mode === "mid"
        ? "Mode: MID — +1 head across each day's peak block (break relief at the busy window)"
        : "Mode: SAFE — +1 head across the whole open window (break cover all day + one no-show of slack)",
  );

  // Per-DAY revenue forecast (recency-weighted per weekday, holidays excluded
  // from the baseline and applied to any holiday in this week). Feeds both the
  // "affordable man-hours" side (per date) and the PT budget envelope (weekly),
  // so coverage sizing and the cost target come from ONE forecast.
  const weekForecast = await forecastWeek(outlet, weekStart);
  const revByDate = new Map<string, number>(weekForecast.byDate.map((d) => [d.date, d.forecast]));
  if (weekForecast.holidayNote) notes.push(`Holiday-aware forecast: ${weekForecast.holidayNote}`);
  // Public holidays this week — PT hours on those days cost 2× (owner rule
  // 2026-07-18), same math the weekly payroll calculator pays out.
  const holidayDates = new Set(weekForecast.byDate.filter((d) => d.isHoliday).map((d) => d.date));

  // Man-hours per open day: what the volume REQUIRES (throughput, floored at the
  // service minimum) vs what target-% revenue can AFFORD. A positive gap flags a
  // day where coverage and the cost target can't both be met — floor-bound days
  // are a revenue problem, demand-bound gaps a low-average-ticket one.
  const openH = outlet.openTime ? Number(outlet.openTime.slice(0, 2)) : 8;
  const closeH = outlet.closeTime ? Number(outlet.closeTime.slice(0, 2)) : 22;
  const openHours = Math.max(1, closeH - openH);
  // Required man-hours per day = SUM of the hourly station-head demand across the
  // open window (captures peaks, not a daily average) — the report's number.
  const requiredByDate = new Map<string, number>();
  for (const d of dates) {
    if (!daysOpen.has(dow(d))) continue;
    let req = 0;
    for (let h = openH; h < closeH; h++) req += (demand.get(`${dow(d)}:${h}`) ?? SERVICE_FLOOR) + bufferHeads(dow(d), h);
    requiredByDate.set(d, req);
  }
  const manHours: DailyManHours[] = dates
    .filter((d) => daysOpen.has(dow(d)))
    .map((d) => {
      const base = computeDailyManHours({
        date: d,
        forecastItems: itemsByDow.get(dow(d)) ?? 0,
        forecastRevenue: revByDate.get(d) ?? 0,
        itemsPerManHour: itemsPerManHourFor(outlet.code),
        serviceMinHeads: SERVICE_FLOOR,
        openHours,
        targetPct: budget.target,
        blendedRate: DEFAULT_BLENDED_RATE,
      });
      const requiredHours = requiredByDate.get(d) ?? base.requiredHours;
      return { ...base, requiredHours, gapHours: Math.round((requiredHours - base.affordableHours) * 10) / 10 };
    });
  const overBudgetDays = manHours.filter((m) => m.gapHours > 0);
  if (manHours.length > 0) {
    const totReq = Math.round(manHours.reduce((s, m) => s + m.requiredHours, 0));
    const totAff = Math.round(manHours.reduce((s, m) => s + m.affordableHours, 0));
    notes.push(
      `Man-hours/wk: required ${totReq}h (station-sized, 15-min serve target) vs affordable ${totAff}h ` +
        `(barista ${baristaRate}/hr, kitchen ${kitchenRate}/hr serve-calibrated, ${SERVICE_FLOOR}-head floor)` +
        (overBudgetDays.length
          ? ` — ${overBudgetDays.length} day(s) over target to cover: ` +
            overBudgetDays.map((m) => `${m.date} +${Math.round(m.gapHours)}h`).join(", ")
          : " — every open day covers within target"),
    );
  }
  // Peak-hour headcount + station split per open day — the "when you need a 4th,
  // it's barista-vs-kitchen" picture the report explains.
  const peakLines = dates
    .filter((d) => daysOpen.has(dow(d)))
    .map((d) => {
      const p = peakByDow.get(dow(d));
      if (!p) return null;
      const heads = p.heads + bufferHeads(dow(d), p.hr); // include the mode buffer at the peak hour
      const buf = heads - p.heads;
      return `${d} ${heads}${p.heads > SERVICE_FLOOR ? ` (${p.bar}bar+${p.kit}kit @${p.hr}:00${buf ? `, +${buf} buffer` : ""})` : buf ? ` (+${buf} buffer)` : ""}`;
    })
    .filter(Boolean);
  if (peakLines.length) notes.push(`Peak heads/day (serve-time model): ${peakLines.join(", ")}`);

  const sortedFT = [...fullTimers].sort((a, b) => a.name.localeCompare(b.name));

  // ── Demand-aware rest days ──────────────────────────────────────────
  // Each FT works 6 days and rests 1 (Employment Act). WHICH day they rest is
  // decided from the outlet's OWN demand data — items sold per weekday — not a
  // fixed rule: more people rest on the QUIETEST days so working heads track
  // demand (the busy weekend keeps a full crew; quiet midweek sheds a few).
  // This costs nothing — every FT still works 6 days — it only rebalances
  // coverage across the week, fixing the old flat/inverted spread.
  const openDaysList = [0, 1, 2, 3, 4, 5, 6].filter((d) => daysOpen.has(d));
  const N = sortedFT.length;
  const dayItems = (d: number) => Math.max(itemsByDow.get(d) ?? 0, 0);

  // ── Fairness memory: each FT's recent history (last 4 weeks) ─────────
  // Drives long-run fairness so it isn't reset every week: openings & closings
  // continue balancing from how much each person has recently carried; weekend
  // rests rotate to whoever's had the fewest; rest days avoid repeating last
  // week's day; and a Sunday close seeds Monday's clopening guard.
  const ftIds = sortedFT.map((s) => s.id);
  const sundayBefore = addDaysStr(weekStart, -1);
  const { data: histShifts } = ftIds.length
    ? await hrSupabaseAdmin
        .from("hr_schedule_shifts")
        .select("user_id, shift_date, role_type, notes, hr_schedules!inner(week_start)")
        .in("user_id", ftIds)
        .gte("hr_schedules.week_start", addDaysStr(weekStart, -28))
        .lt("hr_schedules.week_start", weekStart)
    : { data: [] as unknown[] };
  type HistRow = { user_id: string; shift_date: string; role_type: string | null; notes: string | null; hr_schedules: { week_start: string } | { week_start: string }[] };
  const recentClose = new Map<string, number>();
  const recentOpen = new Map<string, number>();
  const weekendRestCount = new Map<string, number>();
  const lastRestByUser = new Map<string, { week: string; dow: number }>();
  const prevShiftSeed = new Map<string, "open" | "close" | "mid" | "off">();
  for (const h of (histShifts ?? []) as unknown as HistRow[]) {
    const role = (h.role_type ?? "").toLowerCase();
    const wd = new Date(h.shift_date + "T00:00:00Z").getUTCDay();
    const wk = Array.isArray(h.hr_schedules) ? h.hr_schedules[0]?.week_start : h.hr_schedules?.week_start;
    if (h.notes === "rest_day" || role.includes("rest")) {
      if (wd === 0 || wd === 6) weekendRestCount.set(h.user_id, (weekendRestCount.get(h.user_id) ?? 0) + 1);
      const prev = lastRestByUser.get(h.user_id);
      if (wk && (!prev || wk > prev.week)) lastRestByUser.set(h.user_id, { week: wk, dow: wd });
    } else if (role.includes("clos")) {
      recentClose.set(h.user_id, (recentClose.get(h.user_id) ?? 0) + 1);
      if (h.shift_date === sundayBefore) prevShiftSeed.set(h.user_id, "close");
    } else if (role.includes("open")) {
      recentOpen.set(h.user_id, (recentOpen.get(h.user_id) ?? 0) + 1);
      if (h.shift_date === sundayBefore) prevShiftSeed.set(h.user_id, "open");
    }
  }

  // Rest days — placed PER STATION against that station's own demand curve.
  // Two owner catches shaped this (2026-07-18):
  //   1. Items-share rests dug holes PT then bought back on the same day
  //      (paying twice for the identical hours) → slack-greedy vs demand.
  //   2. Day-level slack was STATION-BLIND: Sunday looked slack because its
  //      barista side is the week's lightest, so two rests landed there — and
  //      both went to KITCHEN crew on the #2 cooked-items day, leaving 2 cooks
  //      for 86 kitchen items. Kitchen rests must be judged by the KITCHEN
  //      curve, FOH rests by the barista curve.
  // Each station's rests go greedily to that station's most-surplus day
  // ((station FT still working × 7.5h) − station man-hours needed), capped so
  // the station never drops below its structural minimum (2 cooks for the
  // kitchen anchors; 3 FOH for the floor). Weekend-rest fairness and profile
  // rest days are honoured within each station.
  const SHIFT_H = 7.5;
  const kitNeedHOf = (dwN: number): number => {
    let s = 0;
    for (let h = openH; h < closeH; h++) s += weekDemand.kitHeadsByHour.get(`${dwN}:${h}`) ?? 0;
    return s;
  };
  const barNeedHOf = (dwN: number): number => {
    let s = 0;
    for (let h = openH; h < closeH; h++) {
      const kit = weekDemand.kitHeadsByHour.get(`${dwN}:${h}`) ?? 0;
      s +=
        Math.max(weekDemand.barHeadsByHour.get(`${dwN}:${h}`) ?? SERVICE_FLOOR, SERVICE_FLOOR - kit) +
        bufferHeads(dwN, h);
    }
    return s;
  };
  const weekendDays: number[] = openDaysList.filter((d) => d === 0 || d === 6);
  const restTarget = new Map<number, number>(openDaysList.map((d) => [d, 0])); // combined, for notes/QA
  const restDayOf = new Map<string, number>();

  const placeStationRests = (group: Staff[], needOf: (d: number) => number, minOnDuty: number) => {
    const Ng = group.length;
    if (Ng === 0) return;
    const capG = Math.max(1, Ng - minOnDuty);
    const target = new Map<number, number>(openDaysList.map((d) => [d, 0]));
    // Profile rest days are hard constraints.
    const flexible: Staff[] = [];
    for (const s of group) {
      if (s.rest_day != null && daysOpen.has(s.rest_day)) {
        restDayOf.set(s.id, s.rest_day);
        target.set(s.rest_day, (target.get(s.rest_day) ?? 0) + 1);
      } else {
        flexible.push(s);
      }
    }
    const slack = (d: number) => (Ng - (target.get(d) ?? 0)) * SHIFT_H - needOf(d);
    for (let i = 0; i < flexible.length; i++) {
      let best: number | null = null;
      for (const d of openDaysList) {
        if ((target.get(d) ?? 0) >= capG) continue;
        if (best == null || slack(d) > slack(best) || (slack(d) === slack(best) && dayItems(d) < dayItems(best))) {
          best = d;
        }
      }
      if (best == null) best = openDaysList[i % openDaysList.length]; // every day capped — overflow round-robin
      target.set(best, (target.get(best) ?? 0) + 1);
    }
    // Weekend fairness within the station: if someone here is owed a weekend
    // rest and this station has no weekend slot, move one rest from the
    // slackest weekday-loser to the slackest weekend day (cap respected).
    const owed = flexible.some((s) => (weekendRestCount.get(s.id) ?? 0) === 0);
    const hasWkndSlot = weekendDays.some((d) => (target.get(d) ?? 0) > 0);
    if (owed && !hasWkndSlot && weekendDays.length) {
      const wknd = [...weekendDays].filter((d) => (target.get(d) ?? 0) < capG).sort((a, b) => slack(b) - slack(a))[0];
      const donor = [...openDaysList]
        .filter((d) => !weekendDays.includes(d) && (target.get(d) ?? 0) > 0)
        .sort((a, b) => slack(a) - slack(b))[0];
      if (wknd != null && donor != null) {
        target.set(wknd, (target.get(wknd) ?? 0) + 1);
        target.set(donor, (target.get(donor) ?? 0) - 1);
      }
    }
    // WHO rests when: weekend slots to the fewest-recent-weekend-rests first;
    // everyone else avoids last week's day (variety), then the slackest day.
    const remaining = new Map(target);
    for (const s of group) {
      if (restDayOf.has(s.id) && s.rest_day != null) {
        remaining.set(s.rest_day, (remaining.get(s.rest_day) ?? 0) - 1);
      }
    }
    const byWkndDebt = [...flexible].sort(
      (a, b) => (weekendRestCount.get(a.id) ?? 0) - (weekendRestCount.get(b.id) ?? 0),
    );
    for (const d of [...weekendDays].sort((a, b) => (remaining.get(b) ?? 0) - (remaining.get(a) ?? 0))) {
      while ((remaining.get(d) ?? 0) > 0) {
        const person = byWkndDebt.find((s) => !restDayOf.has(s.id));
        if (!person) break;
        restDayOf.set(person.id, d);
        weekendRestCount.set(person.id, (weekendRestCount.get(person.id) ?? 0) + 1);
        remaining.set(d, (remaining.get(d) ?? 0) - 1);
      }
    }
    // FRIDAY rest slots go to prayer-goers first (owner rule 2026-07-18):
    // resting a Muslim man on Friday dissolves his Jumaat conflict, and keeps
    // women/non-Muslim staff available for the prayer-window shifts. (Caught
    // live: the gender-blind assignment rested Aliana — one of two FOH women —
    // on the exact day the prayer rule needed her.)
    while ((remaining.get(FRIDAY) ?? 0) > 0) {
      const goer = flexible.find((s) => !restDayOf.has(s.id) && attendsFridayPrayer(s.gender, s.religion));
      if (!goer) break;
      restDayOf.set(goer.id, FRIDAY);
      remaining.set(FRIDAY, (remaining.get(FRIDAY) ?? 0) - 1);
    }
    for (const s of flexible) {
      if (restDayOf.has(s.id)) continue;
      // Prayer-free staff avoid a Friday rest when any other day has room.
      const avoidFri = !attendsFridayPrayer(s.gender, s.religion);
      const lastDow = lastRestByUser.get(s.id)?.dow;
      const day =
        openDaysList
          .filter((d) => (remaining.get(d) ?? 0) > 0)
          .sort(
            (a, b) =>
              (avoidFri ? (a === FRIDAY ? 1 : 0) - (b === FRIDAY ? 1 : 0) : 0) ||
              (a === lastDow ? 1 : 0) - (b === lastDow ? 1 : 0) ||
              slack(b) - slack(a),
          )[0] ??
        openDaysList[0] ??
        1;
      restDayOf.set(s.id, day);
      remaining.set(day, (remaining.get(day) ?? 0) - 1);
    }
    for (const d of openDaysList) restTarget.set(d, (restTarget.get(d) ?? 0) + (target.get(d) ?? 0));
  };

  const bohFT = sortedFT.filter((s) => isBOH(s.position));
  const fohFT = sortedFT.filter((s) => !isBOH(s.position));
  placeStationRests(bohFT, kitNeedHOf, 2); // never below the 2 kitchen anchors
  placeStationRests(fohFT, barNeedHOf, 3); // never below the FOH floor
  notes.push(
    "Rest placement (per-station slack vs demand): " +
      openDaysList
        .map((d) => {
          const kitR = bohFT.filter((s) => restDayOf.get(s.id) === d).length;
          const fohR = fohFT.filter((s) => restDayOf.get(s.id) === d).length;
          return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]} kit${kitR}/foh${fohR} (need ${Math.round(kitNeedHOf(d))}+${Math.round(barNeedHOf(d))}h)`;
        })
        .join(", "),
  );
  // Surface the resulting FT working-heads-per-day vs demand for QA.
  const DOW_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  notes.push(
    "FT working heads/day (demand-balanced): " +
      openDaysList
        .map((d) => `${DOW_LABEL[d]} ${N - (restTarget.get(d) ?? 0)}h-crew/${Math.round(dayItems(d))}it`)
        .join(", "),
  );

  // Fatigue + shift-fairness memory across the week. weekOpen/weekClose balance
  // the unsociable anchors evenly WITHIN the week; recentOpen/recentClose break
  // ties by long-run load; prevDayShift enforces no close→open (clopening),
  // seeded from last Sunday's shift so the week boundary is covered too.
  const ftHours = new Map<string, number>();
  const weekOpen = new Map<string, number>();
  const weekClose = new Map<string, number>();
  const prevDayShift = new Map<string, "open" | "close" | "mid" | "off">(prevShiftSeed);
  const closeKey = (s: Staff) => (weekClose.get(s.id) ?? 0) * 1000 + (recentClose.get(s.id) ?? 0);
  const openKey = (s: Staff) => (weekOpen.get(s.id) ?? 0) * 1000 + (recentOpen.get(s.id) ?? 0);
  const closedYesterday = (s: Staff) => prevDayShift.get(s.id) === "close";
  for (const date of dates) {
    if (!daysOpen.has(dow(date))) continue;
    const working = sortedFT.filter(
      (s) => restDayOf.get(s.id) !== dow(date) && !onLeave.has(`${s.id}:${date}`) && !bookedElsewhere.get(s.id)?.has(date),
    );
    const resting = sortedFT.filter((s) => restDayOf.get(s.id) === dow(date) && !onLeave.has(`${s.id}:${date}`));

    // Two-step day split — COUNTS from demand, then PEOPLE by fairness — run
    // PER STATION (owner rule 2026-07-17: "run based on item per station"):
    //  1. HOW MANY: kitchen crew counts come from the KITCHEN item curve
    //     (cooked food peaks mid-morning/lunch → BOH front-loads onto opening
    //     and early middles), barista/FOH counts from the barista curve plus
    //     the service floor and the mode buffer (the cushion is counter/
    //     service, not the kitchen). A BOH middle now exists only when cooked
    //     items actually need one — it's no longer a surplus artifact.
    //  2. Anchors are STRUCTURAL (owner rule): open carries prep/setup and
    //     close carries cleaning + dishwashing that items can't see, so each
    //     station seeds up to 2 at opening AND 2 at closing before its curve
    //     places anyone else (1 head opens; 2 split 1/1; 3 → 2 open/1 close).
    //  3. WHO fills each slot keeps the fatigue/fairness rules within each
    //     station: never open someone who closed last night (clopening) unless
    //     there's literally no one else, and the unsociable anchors rotate to
    //     whoever has carried them least.
    const boh = working.filter((s) => isBOH(s.position));
    const foh = working.filter((s) => !isBOH(s.position));
    const kitToday: Record<number, number> = {};
    const barToday: Record<number, number> = {};
    for (let h = openH; h < closeH; h++) {
      const kit = weekDemand.kitHeadsByHour.get(`${dow(date)}:${h}`) ?? 0;
      // Barista/counter carries the service floor (the store never trades below
      // SERVICE_FLOOR total heads) and the tight/mid/safe buffer.
      kitToday[h] = kit;
      barToday[h] =
        Math.max(weekDemand.barHeadsByHour.get(`${dow(date)}:${h}`) ?? SERVICE_FLOOR, SERVICE_FLOOR - kit) +
        bufferHeads(dow(date), h);
    }
    const winOf = (key: string, t: ShiftTemplate) => ({ key, startH: Number(t.start_time.slice(0, 2)), endH: Number(t.end_time.slice(0, 2)) });
    const windows = [
      winOf("open", tpl.opening),
      ...tpl.middles.map((m, i) => winOf(`mid${i}`, m)),
      winOf("close", tpl.closing),
    ];
    const kitCounts = allocateStationCounts({ heads: boh.length, windows, demandByHour: kitToday });
    const fohCounts = allocateStationCounts({ heads: foh.length, windows, demandByHour: barToday });

    const opening: Staff[] = [];
    const closing: Staff[] = [];
    const midCrews: Staff[][] = tpl.middles.map(() => []);
    const claimed = new Set<string>();
    const take = (arr: Staff[], s: Staff) => { arr.push(s); claimed.add(s.id); };

    // Place one station's crew into the day's windows per that station's counts.
    // FRIDAY (owner rule 2026-07-18): the opening shift spans Friday prayer
    // (~13:00–14:15), which Muslim men leave the floor for — so Friday openings
    // take women/non-Muslim staff FIRST, and the closing shift (which starts
    // after prayer) absorbs the prayer-goers. If the crew mix still forces a
    // prayer-goer onto a prayer-spanning shift, an ai_note flags who needs
    // midday relief.
    const isFriday = dow(date) === FRIDAY;
    // THURSDAY closing also matters: whoever closes Thursday night is
    // clopening-blocked from Friday's opening — which is exactly where the
    // prayer-free staff are needed. So Thursday's closing prefers prayer-goers
    // too, keeping women/non-Muslims eligible to open on Friday. (Caught live:
    // Iffa closed Thu 23:30, the clopening guard rightly refused her the Fri
    // 07:30 open, and the opening fell to Muslim men.)
    const isThursday = dow(date) === FRIDAY - 1;
    const prayerBound = (s: Staff) => (attendsFridayPrayer(s.gender, s.religion) ? 1 : 0);
    const fillStation = (group: Staff[], counts: Map<string, number>) => {
      const unclaimed = () => group.filter((s) => !claimed.has(s.id));
      const openTarget = counts.get("open") ?? 0;
      const closeTarget = counts.get("close") ?? 0;
      const fridayOpenRule = isFriday && coversFridayPrayer(tpl.opening);
      // OPENING first (non-clopeners are the scarce resource), fewest openings
      // first; clopeners only as a last resort to reach the demanded count.
      let took = 0;
      for (const s of unclaimed()
        .filter((s) => !closedYesterday(s))
        .sort((a, b) => (fridayOpenRule ? prayerBound(a) - prayerBound(b) : 0) || openKey(a) - openKey(b))) {
        if (took >= openTarget) break;
        take(opening, s);
        took++;
      }
      for (const s of unclaimed().sort(
        (a, b) => (fridayOpenRule ? prayerBound(a) - prayerBound(b) : 0) || openKey(a) - openKey(b),
      )) {
        if (took >= openTarget) break;
        take(opening, s);
        took++;
      }
      // CLOSING: fewest closings first; on Friday prayer-goers first (the
      // closing window starts after Jumaat, so it's where they belong) — and
      // on THURSDAY too, so prayer-free staff aren't clopening-blocked from
      // Friday's opening.
      took = 0;
      for (const s of unclaimed().sort(
        (a, b) => (isFriday || isThursday ? prayerBound(b) - prayerBound(a) : 0) || closeKey(a) - closeKey(b),
      )) {
        if (took >= closeTarget) break;
        take(closing, s);
        took++;
      }
      // MIDDLES: the remainder, per this station's window counts (round-robin
      // any excess so no one is left unassigned even if counts drift).
      const midTargets = tpl.middles.map((_, i) => counts.get(`mid${i}`) ?? 0);
      const midTaken = tpl.middles.map(() => 0);
      let mi = 0;
      for (const s of unclaimed()) {
        if (tpl.middles.length === 0) {
          // No middles at this outlet → balance the thinner anchor; a clopener
          // always closes.
          if (closedYesterday(s) || closing.length <= opening.length) take(closing, s);
          else take(opening, s);
          continue;
        }
        for (let tries = 0; tries < tpl.middles.length; tries++) {
          const idx = (mi + tries) % tpl.middles.length;
          if (midTaken[idx] < midTargets[idx] || tries === tpl.middles.length - 1) {
            take(midCrews[idx], s);
            midTaken[idx]++;
            mi = idx + 1;
            break;
          }
        }
      }
    };
    fillStation(boh, kitCounts);
    fillStation(foh, fohCounts);

    // Record the day's assignments into the fatigue/fairness memory.
    for (const s of opening) { weekOpen.set(s.id, (weekOpen.get(s.id) ?? 0) + 1); prevDayShift.set(s.id, "open"); }
    for (const s of closing) { weekClose.set(s.id, (weekClose.get(s.id) ?? 0) + 1); prevDayShift.set(s.id, "close"); }
    for (const crew of midCrews) for (const s of crew) prevDayShift.set(s.id, "mid");

    // Friday-prayer QA note: who's still rostered ACROSS the prayer window.
    if (isFriday) {
      const exposed = [
        ...(coversFridayPrayer(tpl.opening) ? opening : []),
        ...midCrews.flatMap((crew, i) => (coversFridayPrayer(tpl.middles[i]) ? crew : [])),
      ].filter((s) => attendsFridayPrayer(s.gender, s.religion));
      notes.push(
        exposed.length
          ? `Fri ${date}: ${exposed.map((s) => s.name.split(" ")[0]).join(", ")} rostered over Friday prayer (~13:00–14:15) — not enough women/non-Muslim crew to avoid it; arrange midday relief`
          : `Fri ${date}: prayer-window shifts staffed by women/non-Muslim crew; Muslim men on closing (Jumaat rule)`,
      );
    }

    const dayGroups: Array<[Staff[], ShiftTemplate]> = [
      [opening, tpl.opening],
      [closing, tpl.closing],
      ...midCrews.map((crew, i): [Staff[], ShiftTemplate] => [crew, tpl.middles[i]]),
    ];
    for (const [group, t] of dayGroups) {
      for (const s of group) {
        // Same row shape as a manual picker selection (cell route):
        // role_type = template label, notes = template id.
        rows.push({
          user_id: s.id,
          shift_date: date,
          start_time: hhmmss(t.start_time),
          end_time: hhmmss(t.end_time),
          role_type: t.label,
          break_minutes: t.break_minutes,
          notes: t.id,
        });
        ftHours.set(s.id, (ftHours.get(s.id) ?? 0) + workingHours(t));
      }
    }
    for (const s of resting) {
      rows.push({
        user_id: s.id,
        shift_date: date,
        start_time: "00:00:00",
        end_time: "00:00:00",
        role_type: "Rest Day",
        break_minutes: 0,
        notes: "rest_day",
      });
      prevDayShift.set(s.id, "off"); // a rest day clears the clopening guard
    }
  }
  const under45 = sortedFT.filter((s) => (ftHours.get(s.id) ?? 0) < 40);
  if (under45.length > 0) {
    notes.push(`⚠ under 45h/wk (leave or closed days): ${under45.map((s) => `${s.name} ${Math.round(ftHours.get(s.id) ?? 0)}h`).join(", ")}`);
  }

  // ── Flex heads: the outlet's FREE sunk/HQ capacity beyond the primary-FT
  // skeleton — rovers (managers/leads who float across outlets) + SHARED FT
  // whose primary is another outlet. Both cost RM0 to this outlet (rover is
  // HQ-costed; a shared FT's salary is booked at their home outlet), so they are
  // pure added coverage. Two fixes over the old per-rover pass:
  //   1. They're placed by ONE demand-spread pass (`planFlexPlacement`) — the
  //      day with the highest demand-per-head fills first and each placement
  //      lowers that day's priority — so heads spread across distinct days
  //      instead of two rovers stacking onto the same busy Thursday.
  //   2. Shared FT are actually rostered here now (they used to sit idle), up to
  //      the 6-day combined weekly cap.
  // Owner rule: FT salaries are sunk — FILL UP ALL THE FT, in every mode. So
  // shared FT are always rostered to their full free capacity (6-day combined
  // cap) and rovers always get their workbook 2 days/outlet-week. The staffing
  // MODE does not gate people; it only scales the demand buffer (sizing) and PT.
  const openDatesList = dates.filter((d) => daysOpen.has(dow(d)));
  const roverIdSet = new Set(roverUsers.map((r) => r.id));
  // Hours each BORROWED shared FT / rover lead is placed here — drives the
  // pro-rata cost charge below (cost follows work, per the rotation-cost rule).
  const borrowedFtHours = new Map<string, number>();
  const roverHours = new Map<string, number>();
  if (roverUsers.length > 0 || sharedFtElsewhere.length > 0) {
    // Days each flex person already works at ANOTHER outlet this week (+ leave).
    const flexIds = [...new Set([...roverUsers.map((r) => r.id), ...sharedFtElsewhere.map((s) => s.id)])];
    const { data: elsewhere } = flexIds.length
      ? await hrSupabaseAdmin
          .from("hr_schedule_shifts")
          .select("user_id, shift_date, schedule_id, hr_schedules!inner(week_start)")
          .in("user_id", flexIds)
          .eq("hr_schedules.week_start", weekStart)
          .neq("start_time", "00:00")
      : { data: [] as Array<{ user_id: string; shift_date: string; schedule_id: string }> };
    const busyDays = new Map<string, Set<string>>();
    for (const s of (elsewhere ?? []) as Array<{ user_id: string; shift_date: string; schedule_id: string }>) {
      if (s.schedule_id === existing?.id) continue; // this outlet's own draft
      (busyDays.get(s.user_id) ?? busyDays.set(s.user_id, new Set()).get(s.user_id)!).add(s.shift_date);
    }

    const demandByDate: Record<string, number> = {};
    const baseHeadsByDate: Record<string, number> = {};
    for (const d of openDatesList) {
      demandByDate[d] = Math.max(dayItems(dow(d)), 1);
      baseHeadsByDate[d] = rows.filter((r) => r.shift_date === d && r.notes !== "rest_day").length;
    }

    const flex: FlexPerson[] = [];
    const flexMeta = new Map<string, { name: string; rover: boolean }>();
    for (const r of roverUsers) {
      const bd = busyDays.get(r.id) ?? new Set();
      const free = openDatesList.filter((d) => !bd.has(d) && !onLeave.has(`${r.id}:${d}`));
      flex.push({ id: r.id, freeDays: free, budget: 2 }); // workbook: 2 days/outlet-week
      flexMeta.set(r.id, { name: r.name, rover: true });
    }
    for (const s of sharedFtElsewhere) {
      const bd = busyDays.get(s.id) ?? new Set();
      const budget = Math.max(0, 6 - bd.size); // fill to the 6-day combined weekly cap
      const free = openDatesList.filter((d) => !bd.has(d) && !onLeave.has(`${s.id}:${d}`));
      flex.push({ id: s.id, freeDays: free, budget });
      flexMeta.set(s.id, { name: s.name, rover: false });
    }

    const placement = planFlexPlacement({ flex, demandByDate, baseHeadsByDate });
    const flexDays = new Map<string, string[]>();
    borrowedFtHours.clear();
    roverHours.clear();
    // Deterministic emit order: by date, then rovers before shared FT.
    for (const date of Object.keys(placement).sort()) {
      const ids = [...placement[date]].sort((a, b) => Number(!roverIdSet.has(a)) - Number(!roverIdSet.has(b)));
      for (const id of ids) {
        // Join the anchor with the larger remaining DEMAND shortfall — not the
        // one with fewer heads, which would fight the demand-shaped counts (a
        // morning-peaked day legitimately carries more openers; the flex head
        // should reinforce the morning, not "balance" it away to closing).
        const shortfall = (t: ShiftTemplate): number => {
          const startH = Number(t.start_time.slice(0, 2));
          const endH = Number(t.end_time.slice(0, 2));
          let s = 0;
          for (let h = startH; h < endH; h++) {
            const need = (demand.get(`${dow(date)}:${h}`) ?? SERVICE_FLOOR) + bufferHeads(dow(date), h);
            const have = rows.filter(
              (r) => r.shift_date === date && r.notes !== "rest_day" &&
                Number(r.start_time.slice(0, 2)) <= h && Number(r.end_time.slice(0, 2)) > h,
            ).length;
            s += Math.max(0, need - have);
          }
          return s;
        };
        const openShort = shortfall(tpl.opening);
        const closeShort = shortfall(tpl.closing);
        const openHeads = rows.filter((r) => r.shift_date === date && r.notes !== "rest_day" && r.start_time === hhmmss(tpl.opening.start_time)).length;
        const closeHeads = rows.filter((r) => r.shift_date === date && r.notes !== "rest_day" && r.start_time === hhmmss(tpl.closing.start_time)).length;
        // Tie on shortfall (usually both 0 on surplus days) → thinner anchor.
        const t = openShort > closeShort || (openShort === closeShort && openHeads <= closeHeads) ? tpl.opening : tpl.closing;
        rows.push({
          user_id: id,
          shift_date: date,
          start_time: hhmmss(t.start_time),
          end_time: hhmmss(t.end_time),
          role_type: t.label,
          break_minutes: t.break_minutes,
          notes: t.id,
        });
        if (flexMeta.get(id)?.rover) {
          roverHours.set(id, (roverHours.get(id) ?? 0) + workingHours(t));
        } else {
          ftHours.set(id, (ftHours.get(id) ?? 0) + workingHours(t));
          borrowedFtHours.set(id, (borrowedFtHours.get(id) ?? 0) + workingHours(t));
        }
        (flexDays.get(id) ?? flexDays.set(id, []).get(id)!).push(date);
      }
    }
    for (const [id, days] of flexDays) {
      const meta = flexMeta.get(id)!;
      days.sort();
      notes.push(
        meta.rover
          ? `Rover ${meta.name} (${roverPositionOf.get(id)}): ${days.join(", ")} — costed here pro-rata by hours (rotation-cost rule)`
          : `Shared FT ${meta.name} filled here: ${days.join(", ")} — primary elsewhere; their cost for these hours is charged HERE, credited at home (rotation-cost rule)`,
      );
    }
    const unfilledShared = sharedFtElsewhere.filter((s) => !flexDays.has(s.id));
    if (unfilledShared.length > 0) {
      notes.push(
        `${unfilledShared.length} shared FT not rostered here (fully booked at their other outlet(s) or on leave): ${unfilledShared.map((s) => s.name).join(", ")}`,
      );
    }
  }

  // ── Stage 2: PT budget envelope — the only spend that moves labour % ─
  // Same forecast the man-hours side used (recency-weighted, holiday-aware).
  const forecast = Math.round(weekForecast.weekly);
  // FT cost, split by WHERE the hours land (owner's rotation-cost rule):
  //   • primary FT: full weekly share MINUS the pro-rata slice for hours they
  //     work at other outlets this week (that slice is charged there instead);
  //   • borrowed shared FT: pro-rata share for the hours placed HERE.
  // Manager / Area Manager / rover cost is HQ overhead — RM0 to the outlet.
  const primaryFtCost = fullTimers.reduce((sum, s) => {
    const share = weeklySalaryShare(s.basic_salary, s.epf_employer_rate);
    return sum + share - lentFtCredit(share, hoursElsewhere.get(s.id) ?? 0);
  }, 0);
  const borrowedFtCost = sharedFtElsewhere.reduce(
    (sum, s) => sum + borrowedFtCharge(weeklySalaryShare(s.basic_salary, s.epf_employer_rate), borrowedFtHours.get(s.id) ?? 0),
    0,
  );
  // Rover lead (Barista Lead) hours here, same pro-rata rule. Managers = HQ, RM0.
  const roverCost = [...roverHours.entries()].reduce(
    (sum, [id, h]) => sum + borrowedFtCharge(roverShareOf.get(id) ?? 0, h),
    0,
  );
  const ftCost = Math.round(primaryFtCost + borrowedFtCost + roverCost);
  // PT money aims at the TARGET (18%). But when the sunk FT floor alone
  // already consumes the target, the old behaviour (envelope RM0 → zero PT
  // anywhere, weekends starved) protected a number that was already breached
  // while costing coverage on the busiest days. The owner's band is
  // target–ceiling (18–20%), so in that case the envelope opens up to the
  // CEILING. The labour gate still prices the final roster: landing between
  // target and ceiling reads AMBER at publish (typed reason), never silent.
  const targetEnvelope = Math.round(budget.target * forecast - ftCost);
  const ceilingEnvelope = Math.round(budget.ceiling * forecast - ftCost);
  const ptBudget = targetEnvelope > 0 ? targetEnvelope : Math.max(0, ceilingEnvelope);
  const usedCeiling = targetEnvelope <= 0 && ptBudget > 0;
  notes.push(
    `Budget: forecast RM${forecast.toLocaleString()} × ${(budget.target * 100).toFixed(0)}% = RM${Math.round(budget.target * forecast).toLocaleString()}; ` +
      `FT RM${ftCost.toLocaleString()} (primary RM${Math.round(primaryFtCost).toLocaleString()}` +
      (borrowedFtCost > 0 ? ` + borrowed-hours RM${Math.round(borrowedFtCost).toLocaleString()}` : "") +
      (roverCost > 0 ? ` + rover-hours RM${Math.round(roverCost).toLocaleString()}` : "") +
      `; rotation cost follows hours, manager cost = HQ) → PT envelope RM${ptBudget.toLocaleString()}` +
      (usedCeiling ? ` (target consumed by FT floor — opened to the ${(budget.ceiling * 100).toFixed(0)}% ceiling, publish will read amber)` : ""),
  );
  // Sunk-FT reality: when the fixed FT floor alone is already at/over target, the
  // week is revenue-constrained — no amount of rostering fixes it, and benching
  // FT saves nothing (their salary is booked either way). Flag it so the % isn't
  // "corrected" by cutting FT hours.
  const ftFloorPct = forecast > 0 ? ftCost / forecast : null;
  if (targetEnvelope <= 0 && ftFloorPct != null) {
    notes.push(
      `⚠ FT floor alone is ${(ftFloorPct * 100).toFixed(1)}% of forecast (≥ ${(budget.target * 100).toFixed(0)}% target) — revenue-constrained week. ` +
        `FT salary is sunk, so schedule them FULLY (benching cuts coverage, not cost); the levers are revenue or lending an FT to a busier outlet.` +
        (ptBudget > 0 ? ` PT capped at the ${(budget.ceiling * 100).toFixed(0)}% ceiling envelope (RM${ptBudget.toLocaleString()}).` : ""),
    );
  }

  // PT gaps + per-day top-up targets — from THE demand model (the same
  // station-split heads the day-split and the grid's "short Xh" chips use),
  // NOT the old items-per-man-hour formula. That formula called quiet weekdays
  // "covered" by the FT base while the coverage chips showed hours below the
  // 3-head service floor, so Mon–Wed never drew a PT suggestion (Shah Alam QA,
  // 2026-07-17). Gaps are STATION-TAGGED so a kitchen hole is only offered to
  // kitchen-capable PT, and the structural anchor rule (each station wants 2
  // at opening AND 2 at closing — prep/cleaning the item curve can't see)
  // generates anchor gaps the curve alone wouldn't.
  const posById = new Map<string, string | null>(staff.map((s) => [s.id, s.position]));
  for (const [id, pos] of roverPositionOf) if (!posById.has(id)) posById.set(id, pos);
  const kitNeedAt = (d: string, h: number) => weekDemand.kitHeadsByHour.get(`${dow(d)}:${h}`) ?? 0;
  const barNeedAt = (d: string, h: number) => {
    const kit = kitNeedAt(d, h);
    return (
      Math.max(weekDemand.barHeadsByHour.get(`${dow(d)}:${h}`) ?? SERVICE_FLOOR, SERVICE_FLOOR - kit) +
      bufferHeads(dow(d), h)
    );
  };
  const staffedAt = (d: string, h: number, station: "kitchen" | "barista") =>
    rows.filter((r) => {
      if (r.shift_date !== d || r.notes === "rest_day") return false;
      if (Number(r.start_time.slice(0, 2)) > h || Number(r.end_time.slice(0, 2)) <= h) return false;
      const pos = posById.get(r.user_id) ?? null;
      // Management shifts are not man-hours (owner rule 2026-07-18) — a rover
      // manager on the grid must not hide a real PT gap.
      if (isManagementPosition(pos)) return false;
      return station === "kitchen" ? isBOH(pos) : !isBOH(pos);
    }).length;

  type Gap = { date: string; template: ShiftTemplate; slot: string; gapHours: number; station: "kitchen" | "barista" };
  const gaps: Gap[] = [];
  // Every picker template is a candidate PT slot, keyed by template id —
  // middles first, since a mid shift bridging lunch is usually the cheapest
  // way to cover a trough between two peaks (workbook Mid-Shift Analysis).
  const candidates: Array<[string, ShiftTemplate]> = [
    ...tpl.middles.map((m) => [m.id, m] as [string, ShiftTemplate]),
    [tpl.opening.id, tpl.opening],
    [tpl.closing.id, tpl.closing],
  ];
  const anchorIds = new Set([tpl.opening.id, tpl.closing.id]);
  const ptTargetByDate = new Map<string, number>();
  for (const date of dates) {
    if (!daysOpen.has(dow(date))) continue;
    let anchorShort = 0;
    for (const [slot, t] of candidates) {
      const startH = Number(t.start_time.slice(0, 2));
      const endH = Number(t.end_time.slice(0, 2));
      for (const station of ["kitchen", "barista"] as const) {
        let gapHours = 0;
        let minStaffed = Infinity;
        let anyNeed = false;
        for (let h = startH; h < endH; h++) {
          const need = station === "kitchen" ? kitNeedAt(date, h) : barNeedAt(date, h);
          if (need > 0) anyNeed = true;
          const have = staffedAt(date, h, station);
          minStaffed = Math.min(minStaffed, have);
          if (need > have) gapHours += need - have;
        }
        // Structural anchors: opening/closing want STATION_ANCHOR_TARGET of
        // each station across the whole window (when the station trades at
        // all), regardless of what the item curve says.
        if (anchorIds.has(t.id) && anyNeed && Number.isFinite(minStaffed) && minStaffed < STATION_ANCHOR_TARGET) {
          const structural = (STATION_ANCHOR_TARGET - minStaffed) * (endH - startH);
          anchorShort += structural;
          gapHours = Math.max(gapHours, structural);
        }
        if (gapHours > 0) gaps.push({ date, template: t, slot, gapHours, station });
      }
    }
    // Day target = station-split head-hours short of demand after the FT
    // skeleton, or the structural anchor shortfall when that binds harder.
    let hourlyShort = 0;
    for (let h = openH; h < closeH; h++) {
      hourlyShort +=
        Math.max(0, kitNeedAt(date, h) - staffedAt(date, h, "kitchen")) +
        Math.max(0, barNeedAt(date, h) - staffedAt(date, h, "barista"));
    }
    ptTargetByDate.set(date, Math.max(hourlyShort, anchorShort));
  }
  const ptTargetTotal = Math.round([...ptTargetByDate.values()].reduce((s, v) => s + v, 0));
  if (ptTargetTotal > 0) {
    const perDay = dates
      .filter((d) => (ptTargetByDate.get(d) ?? 0) > 0)
      .map((d) => `${d} +${Math.round(ptTargetByDate.get(d) ?? 0)}h`);
    notes.push(`PT top-up target (demand-model shortfall after FT): ${ptTargetTotal}h — ${perDay.join(", ")}`);
  }
  // Days furthest below their coverage target fill first, then by hourly gap
  // size within a day.
  gaps.sort(
    (a, b) =>
      (ptTargetByDate.get(b.date) ?? 0) - (ptTargetByDate.get(a.date) ?? 0) || b.gapHours - a.gapHours,
  );

  // Fairness input: confirmed PT hours over the last 4 weeks.
  const { data: recentPt } = await hrSupabaseAdmin
    .from("hr_schedule_shifts")
    .select("user_id, start_time, end_time, hr_schedules!inner(outlet_id, week_start)")
    .in("user_id", partTimers.length ? partTimers.map((p) => p.id) : ["-"])
    .gte("hr_schedules.week_start", addDaysStr(weekStart, -28))
    .lt("hr_schedules.week_start", weekStart);
  const recentHours = new Map<string, number>();
  for (const r of (recentPt ?? []) as Array<{ user_id: string; start_time: string; end_time: string }>) {
    const h = (Number(r.end_time.slice(0, 2)) * 60 + Number(r.end_time.slice(3, 5)) - Number(r.start_time.slice(0, 2)) * 60 - Number(r.start_time.slice(3, 5))) / 60;
    if (h > 0) recentHours.set(r.user_id, (recentHours.get(r.user_id) ?? 0) + h);
  }

  // Performance input: each PT's reliability over the last 60 days — on-time rate
  // (clock-in vs scheduled) blended with checklist-completion rate. Between two
  // equally under-worked part-timers the more reliable one is suggested first;
  // it never hard-blocks anyone (thin/no history sits at a neutral prior).
  const perfById = await computePtPerformance(partTimers.map((p) => p.id), weekStart);

  // ── Stage 3: agentic PT proposal, validated in code ──────────────────
  type Proposal = { user_id: string; date: string; slot: string; reason?: string };
  let proposals: Proposal[] = [];
  let agentUsed = false;
  const eligiblePt = partTimers.filter((p) => p.hourly_rate && p.hourly_rate > 0);
  const skippedPt = partTimers.length - eligiblePt.length;
  if (skippedPt > 0) notes.push(`⚠ ${skippedPt} PT skipped — no hourly rate on profile`);
  if (eligiblePt.length > 0) {
    const ranked = [...eligiblePt]
      .map((p) => ({ p, perf: perfById.get(p.id) }))
      .sort((a, b) => (b.perf?.score ?? 0) - (a.perf?.score ?? 0))
      .map(({ p, perf }) => {
        const sample = (perf?.attendanceSample ?? 0) + (perf?.checklistSample ?? 0);
        return `${p.name} ${Math.round((perf?.score ?? 0.7) * 100)}%${sample === 0 ? " (no history)" : ` (on-time ${Math.round((perf?.onTimeRate ?? 0) * 100)}%, checklist ${Math.round((perf?.checklistRate ?? 0) * 100)}%)`}`;
      });
    notes.push(`PT performance (60d, weighted into suggestions): ${ranked.join("; ")}`);
  }

  if (ptMode === "assign" && eligiblePt.length > 0 && ptBudget > 0 && gaps.length > 0 && process.env.ANTHROPIC_API_KEY) {
    try {
      proposals = await proposePtWithModel({
        outletName: outlet.name,
        ptBudget,
        gaps: gaps.slice(0, 30).map((g) => ({ date: g.date, slot: g.slot, station: g.station, gapHours: Math.round(g.gapHours * 10) / 10 })),
        partTimers: eligiblePt.map((p) => {
          const perf = perfById.get(p.id);
          return {
            user_id: p.id,
            name: p.name,
            position: p.position,
            hourly_rate: p.hourly_rate!,
            recent_4wk_hours: Math.round(recentHours.get(p.id) ?? 0),
            on_time_pct: perf ? Math.round(perf.onTimeRate * 100) : null,
            checklist_pct: perf ? Math.round(perf.checklistRate * 100) : null,
            reliability: perf ? Math.round(perf.score * 100) / 100 : null,
            leave_dates: dates.filter((d) => onLeave.has(`${p.id}:${d}`)),
          };
        }),
        slots: Object.fromEntries(
          candidates.map(([slot, t]) => [slot, `${t.label} ${t.start_time}-${t.end_time} (${workingHours(t)}h)`]),
        ),
      });
      agentUsed = true;
    } catch (err) {
      notes.push(`Agent pass failed (${err instanceof Error ? err.message : "error"}) — greedy fallback used`);
    }
  }
  if (ptMode === "assign" && proposals.length === 0 && eligiblePt.length > 0 && ptBudget > 0) {
    // Greedy fallback: fill the biggest gaps first, and for each gap pick the PT
    // with the best blend of PERFORMANCE (reliability), FAIRNESS (fewest hours so
    // far) and COST (cheaper first). Fairness updates live as we propose — a PT's
    // fairness drops with every shift we hand them this run — so the load still
    // spreads instead of piling every gap onto the single top performer.
    const maxRate = Math.max(1, ...eligiblePt.map((p) => p.hourly_rate!));
    const fairCap = 4 * PT_MAX_HOURS_PER_WEEK; // 4-week horizon of the recentHours signal
    const proposedH = new Map<string, number>(); // hours proposed to each PT this run
    const W_PERF = 0.5, W_FAIR = 0.35, W_COST = 0.15;
    const priority = (p: Staff) => {
      const worked = (recentHours.get(p.id) ?? 0) + (proposedH.get(p.id) ?? 0) * 4; // this-week hours weighted onto the 4-week scale
      const fairnessNorm = 1 - Math.min(1, worked / fairCap);
      const costNorm = p.hourly_rate! / maxRate;
      const perf = perfById.get(p.id)?.score ?? 0.7;
      return W_PERF * perf + W_FAIR * fairnessNorm - W_COST * costNorm;
    };
    const proposedByDay = new Map<string, Set<string>>(); // date → PTs already proposed that day
    const proposedDays = new Map<string, number>(); // PT → days proposed this run
    // BREADTH-FIRST across days: when the envelope can't cover every gap, a
    // waterfall fill (deepest day to 100%, then the next) starves the tail —
    // Tamarind 2026-07-20 put 4-5 PT on each of four quiet-ish days and left
    // SATURDAY (busiest, 245 items) with one shift and Friday with none.
    // Interleaving one gap per day per round means every day gets its deepest
    // hole plugged before any day gets its fourth top-up. Days keep their
    // target-desc order within each round; per-day targets still cap totals.
    // KITCHEN GAPS FIRST within each day: kitchen-capable PTs are the scarce
    // resource (often 2 people = 6 shifts/week), and an unmanned kitchen is a
    // closed kitchen — Tamarind 2026-07-20: barista gaps in the early rounds
    // consumed the kitchen PTs' caps on Mon–Fri and left SAT+SUN with zero
    // kitchen staff after 15:30 (owner: "close the kitchen?").
    const gapsByDate = new Map<string, Gap[]>();
    for (const g of gaps) (gapsByDate.get(g.date) ?? gapsByDate.set(g.date, []).get(g.date)!).push(g);
    for (const dayGaps of gapsByDate.values()) {
      dayGaps.sort((a, b) => (a.station === "kitchen" ? 0 : 1) - (b.station === "kitchen" ? 0 : 1) || b.gapHours - a.gapHours);
    }
    const interleaved: Gap[] = [];
    for (let round = 0, added = true; added; round++) {
      added = false;
      for (const dayGaps of gapsByDate.values()) {
        if (dayGaps[round]) { interleaved.push(dayGaps[round]); added = true; }
      }
    }
    // Cap-aware picking: a PT at the weekly hour/day cap is skipped HERE, so
    // the pick cascades down the priority list instead of proposing capped
    // people the validator silently drops. (Shah Alam catch 2026-07-18: the
    // 5 reliable PTs maxed out on Sun/Sat/Tue, then Mon/Wed got NOTHING while
    // RM373 of envelope sat unspent and 4 other PTs sat unused.)
    for (const g of interleaved) {
      const day = proposedByDay.get(g.date) ?? proposedByDay.set(g.date, new Set()).get(g.date)!;
      const gapH = workingHours(g.template);
      const pick = eligiblePt
        .filter(
          (p) =>
            fitsStation(p.position, g.station) &&
            !day.has(p.id) && !bookedElsewhere.get(p.id)?.has(g.date) && !onLeave.has(`${p.id}:${g.date}`) &&
            ptAvailableFor(p.id, g.date, g.template.start_time, g.template.end_time) &&
            (hoursElsewhere.get(p.id) ?? 0) + (proposedH.get(p.id) ?? 0) + gapH <= PT_MAX_HOURS_PER_WEEK &&
            (proposedDays.get(p.id) ?? 0) < ptMaxDays(p.id),
        )
        .sort((a, b) => priority(b) - priority(a))[0];
      if (!pick) continue;
      day.add(pick.id);
      proposedH.set(pick.id, (proposedH.get(pick.id) ?? 0) + gapH);
      proposedDays.set(pick.id, (proposedDays.get(pick.id) ?? 0) + 1);
      proposals.push({ user_id: pick.id, date: g.date, slot: g.slot, reason: `${g.station} gap ${g.gapHours}h` });
    }
  }

  // Validate every proposal against the hard constraints; violations drop.
  const slotByName = new Map<string, ShiftTemplate>(candidates.map(([slot, t]) => [slot, t]));
  // Station guard: if a (date, slot) has known gaps, the person must fit at
  // least one of the short stations — a pure barista can't cover a kitchen
  // hole the model happened to pick them for. Slots with no recorded gap pass
  // (budget + day-target caps still bind).
  const gapStationsBySlot = new Map<string, Set<Gap["station"]>>();
  for (const g of gaps) {
    const key = `${g.date}:${g.slot}`;
    (gapStationsBySlot.get(key) ?? gapStationsBySlot.set(key, new Set()).get(key)!).add(g.station);
  }
  const ptRows: ShiftRow[] = [];
  const ptSpend = { rm: 0 };
  const filledBySlot = new Map<string, number>(); // `${date}:${slot}` → accepted PT count (for open-slot posting)
  const ptWeek = new Map<string, { hours: number; days: Set<string> }>();
  const ptHoursByDate = new Map<string, number>(); // PT man-hours suggested per day so far
  // Seed each PT's weekly tally from the hours/days they already hold at OTHER
  // outlets this week, so the 24h / 5-day caps below bind on the COMBINED total
  // — a two-outlet PT can't be suggested to 48h.
  for (const person of eligiblePt) {
    const daysElsewhere = bookedElsewhere.get(person.id);
    if (daysElsewhere?.size || hoursElsewhere.get(person.id)) {
      ptWeek.set(person.id, { hours: hoursElsewhere.get(person.id) ?? 0, days: new Set(daysElsewhere ?? []) });
    }
  }
  const suggestionLines: string[] = [];
  for (const p of proposals) {
    const person = eligiblePt.find((x) => x.id === p.user_id);
    const t = slotByName.get(p.slot);
    if (!person || !t || !dates.includes(p.date)) continue;
    if (onLeave.has(`${person.id}:${p.date}`)) continue;
    if (bookedElsewhere.get(person.id)?.has(p.date)) continue; // already working another outlet that day
    if (!ptAvailableFor(person.id, p.date, t.start_time, t.end_time)) continue; // outside declared availability
    if (ptRows.some((r) => r.user_id === person.id && r.shift_date === p.date)) continue; // one shift/day
    const shortStations = gapStationsBySlot.get(`${p.date}:${p.slot}`);
    if (shortStations && ![...shortStations].some((st) => fitsStation(person.position, st))) continue;
    // Man-hour cap: stop once the day reaches its PT top-up target. Days the FT
    // base already covers (target 0) get no PT — coverage sized, not padded.
    if ((ptHoursByDate.get(p.date) ?? 0) >= (ptTargetByDate.get(p.date) ?? 0)) continue;
    const h = workingHours(t);
    // Day-aware PT pricing: weekday base / weekend rate / 2× public holiday —
    // the suggestion's cost is exactly what the weekly payroll would pay.
    const cost = h * ptRateForDate(person, p.date, holidayDates.has(p.date));
    if (ptSpend.rm + cost > ptBudget) continue;
    const wk = ptWeek.get(person.id) ?? { hours: 0, days: new Set<string>() };
    if (wk.hours + h > PT_MAX_HOURS_PER_WEEK || wk.days.size >= ptMaxDays(person.id)) continue;
    wk.hours += h;
    wk.days.add(p.date);
    ptWeek.set(person.id, wk);
    ptSpend.rm += cost;
    ptHoursByDate.set(p.date, (ptHoursByDate.get(p.date) ?? 0) + h);
    filledBySlot.set(`${p.date}:${p.slot}`, (filledBySlot.get(`${p.date}:${p.slot}`) ?? 0) + 1);
    ptRows.push({
      user_id: person.id,
      shift_date: p.date,
      start_time: hhmmss(t.start_time),
      end_time: hhmmss(t.end_time),
      role_type: t.label,
      break_minutes: t.break_minutes,
      notes: "pt_suggestion",
    });
    suggestionLines.push(`${p.date} ${t.label} — ${person.name} (RM${Math.round(cost)}${p.reason ? `, ${p.reason}` : ""})`);
  }
  if (ptMode === "open_slots") {
    notes.push(
      `PT stage: OPEN-SLOTS-FIRST — nobody pre-assigned. All demand gaps go up as bookable slots in the staff apps (station-fit + weekly caps enforced at booking); assign whatever is still unbooked closer to the week.`,
    );
  } else {
    notes.push(
      ptRows.length > 0
        ? `${ptRows.length} PT SUGGESTIONS (RM${Math.round(ptSpend.rm)} of RM${ptBudget} envelope, ${agentUsed ? "agent" : "greedy"}) — confirm in grid:\n  ${suggestionLines.join("\n  ")}`
        : `No PT suggested (envelope RM${ptBudget}, ${gaps.length} demand gaps, ${eligiblePt.length} eligible PT)`,
    );
  }

  // Open slots are computed HERE (before the unmanned QA) so the warnings can
  // tell "posted, waiting for a booking" apart from a genuinely dead hour.
  const gapsBySlotKey = new Map<string, Gap[]>();
  for (const g of gaps) {
    const key = `${g.date}:${g.slot}`;
    (gapsBySlotKey.get(key) ?? gapsBySlotKey.set(key, []).get(key)!).push(g);
  }
  const openSlotRows: Array<{
    outlet_id: string; shift_date: string; start_time: string; end_time: string;
    break_minutes: number; station: "kitchen" | "barista"; role_type: string;
    template_id: string; source: string; status: string; expires_at: string;
  }> = [];
  for (const [key, slotGaps] of gapsBySlotKey) {
    for (const g of slotGaps.slice(filledBySlot.get(key) ?? 0)) {
      openSlotRows.push({
        outlet_id: outletId,
        shift_date: g.date,
        start_time: hhmmss(g.template.start_time),
        end_time: hhmmss(g.template.end_time),
        break_minutes: g.template.break_minutes,
        station: g.station,
        role_type: g.template.label,
        template_id: g.template.id,
        source: "generator",
        status: "open",
        expires_at: `${g.date}T${hhmmss(g.template.start_time)}+08:00`,
      });
    }
  }
  const slotCoverAt = (d: string, h: number, station: "kitchen" | "barista") =>
    openSlotRows.filter(
      (r) => r.shift_date === d && r.station === station &&
        Number(r.start_time.slice(0, 2)) <= h && Number(r.end_time.slice(0, 2)) > h,
    ).length;

  // ── Unmanned-station QA: never CLOSE a station silently ─────────────
  // After FT + suggested PT, any trading hour where a station with demand has
  // ZERO people is a loud warning (Tamarind 2026-07-20: kitchen had nobody
  // Sat+Sun after 15:30 — a closed kitchen on the busiest evenings, and the
  // grid said nothing). These are supply holes (caps/envelope/headcount), so
  // the roster can't fix them alone — the owner must decide: cross-cover,
  // raise PT hours, or hire.
  const ptStaffedAt = (d: string, h: number, station: "kitchen" | "barista") =>
    ptRows.filter((r) => {
      if (r.shift_date !== d) return false;
      if (Number(r.start_time.slice(0, 2)) > h || Number(r.end_time.slice(0, 2)) <= h) return false;
      const pos = posById.get(r.user_id) ?? null;
      return station === "kitchen" ? isBOH(pos) : !isBOH(pos);
    }).length;
  for (const date of dates) {
    if (!daysOpen.has(dow(date))) continue;
    for (const station of ["kitchen", "barista"] as const) {
      const holes: number[] = [];
      const pending: number[] = []; // hole hours a posted open slot would cover once booked
      for (let h = openH; h < closeH; h++) {
        const need = station === "kitchen" ? kitNeedAt(date, h) : barNeedAt(date, h);
        if (need > 0 && staffedAt(date, h, station) + ptStaffedAt(date, h, station) === 0) {
          (slotCoverAt(date, h, station) > 0 ? pending : holes).push(h);
        }
      }
      if (pending.length > 0) {
        notes.push(
          `⏳ ${station.toUpperCase()} ${date} ${pending[0]}:00–${pending[pending.length - 1] + 1}:00 — open slot(s) posted, coverage pending a staff booking. Assign manually if nobody books.`,
        );
      }
      if (holes.length > 0) {
        notes.push(
          `⚠ ${station.toUpperCase()} UNMANNED ${date} ${holes[0]}:00–${holes[holes.length - 1] + 1}:00 — demand exists but no ${station}-capable staff left (weekly caps / envelope / headcount). Cross-cover, add PT hours, or the station is effectively closed.`,
        );
      }
    }
  }

  // ── Stage 4: atomic persist — never lose the old week on failure ─────
  const allRows = [...rows, ...ptRows];
  const totalHours = Math.round(
    allRows.filter((r) => r.notes !== "rest_day").reduce((sum, r) => {
      const mins = Number(r.end_time.slice(0, 2)) * 60 + Number(r.end_time.slice(3, 5)) -
        Number(r.start_time.slice(0, 2)) * 60 - Number(r.start_time.slice(3, 5)) - r.break_minutes;
      return sum + mins / 60;
    }, 0),
  );
  const estimatedCost = ftCost + Math.round(ptSpend.rm); // ftCost incl. borrowed + rover hours; manager = HQ RM0

  let scheduleId = existing?.id as string | undefined;
  if (!scheduleId) {
    const { data: created, error } = await hrSupabaseAdmin
      .from("hr_schedules")
      .insert({ outlet_id: outletId, week_start: weekStart, week_end: weekEnd, status: "ai_generated", generated_by: "ai" })
      .select("id")
      .single();
    if (error) throw new Error(`Failed to create schedule: ${error.message}`);
    scheduleId = created.id;
  }

  // One transaction: replace the week's shifts. If the insert fails the
  // delete rolls back with it — the old roster survives.
  await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM hr_schedule_shifts WHERE schedule_id = ${scheduleId}::uuid`,
    prisma.$executeRaw`
      INSERT INTO hr_schedule_shifts
        (schedule_id, user_id, shift_date, start_time, end_time, role_type, break_minutes, notes, is_ai_assigned)
      SELECT ${scheduleId}::uuid, u, d::date, s::time, e::time, r, b, n, true
      FROM unnest(
        ${allRows.map((r) => r.user_id)}::text[],
        ${allRows.map((r) => r.shift_date)}::text[],
        ${allRows.map((r) => r.start_time)}::text[],
        ${allRows.map((r) => r.end_time)}::text[],
        ${allRows.map((r) => r.role_type)}::text[],
        ${allRows.map((r) => r.break_minutes)}::int[],
        ${allRows.map((r) => r.notes)}::text[]
      ) AS t(u, d, s, e, r, b, n)
    `,
  ]);

  // ── Open slots: every demand gap the fill did NOT cover becomes a
  // bookable hr_open_shifts row (source 'generator') — computed above, next
  // to the unmanned QA; written here so a failed persist posts nothing.
  // Regeneration is idempotent: still-open generator slots for this week are
  // replaced; claimed ones are history and stay untouched.
  await hrSupabaseAdmin
    .from("hr_open_shifts")
    .delete()
    .eq("outlet_id", outletId)
    .eq("source", "generator")
    .eq("status", "open")
    .gte("shift_date", weekStart)
    .lte("shift_date", weekEnd);
  if (openSlotRows.length > 0) {
    const { error: openErr } = await hrSupabaseAdmin.from("hr_open_shifts").insert(openSlotRows);
    if (openErr) {
      notes.push(`⚠ Failed to post open slots for staff booking: ${openErr.message}`);
    } else {
      const kitOpen = openSlotRows.filter((r) => r.station === "kitchen").length;
      notes.push(
        `${openSlotRows.length} OPEN SLOT(S) posted to the staff apps (${kitOpen} kitchen, ${openSlotRows.length - kitOpen} barista) — unfilled demand gaps any station-fit PT can book, first accept wins.`,
      );
    }
  }

  await hrSupabaseAdmin
    .from("hr_schedules")
    .update({
      status: "ai_generated",
      generated_by: "ai",
      week_end: weekEnd,
      ai_notes: notes.join("\n"),
      total_labor_hours: totalHours,
      estimated_labor_cost: estimatedCost,
    })
    .eq("id", scheduleId);

  return {
    scheduleId: scheduleId!,
    mode,
    shifts: allRows.filter((r) => r.notes !== "rest_day").length,
    ptSuggestions: ptRows.length,
    openSlots: openSlotRows.length,
    totalHours,
    estimatedCost,
    notes,
    manHours,
  };
}

function addDaysStr(ymd: string, days: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── the agentic pass ────────────────────────────────────────────────

async function proposePtWithModel(input: {
  outletName: string;
  ptBudget: number;
  gaps: Array<{ date: string; slot: string; station: string; gapHours: number }>;
  partTimers: Array<{
    user_id: string; name: string; position: string | null; hourly_rate: number; recent_4wk_hours: number;
    on_time_pct: number | null; checklist_pct: number | null; reliability: number | null;
    leave_dates: string[];
  }>;
  slots: Record<string, string>;
}): Promise<Array<{ user_id: string; date: string; slot: string; reason?: string }>> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: [
          `You allocate part-timer shifts for ${input.outletName}, a specialty coffee outlet in Malaysia.`,
          `Full-timers are already rostered (salaried, fixed cost). Part-timers are the only spend that moves labour % — total PT cost this week must stay under RM${input.ptBudget}.`,
          ``,
          `Shift slots: ${JSON.stringify(input.slots)}`,
          `Demand gaps, biggest first (gapHours = staff-hours short of the sales-derived need; station = which side of the floor is short — "kitchen" gaps need a kitchen-capable position, "barista" gaps a barista/counter one; hybrids like "Barista/Kitchen" fit both):`,
          JSON.stringify(input.gaps),
          `Part-timers. Fields: recent_4wk_hours = hours in the last 4 weeks (spread work fairly — favour whoever has fewer recent hours); on_time_pct / checklist_pct / reliability = performance over the last 60 days (0-100 / 0-1; higher = clocks in on time and finishes checklists); never assign on their leave_dates.`,
          JSON.stringify(input.partTimers),
          ``,
          `Reply with ONLY a JSON array, no prose: [{"user_id": "...", "date": "YYYY-MM-DD", "slot": "<one of the slot keys above>", "reason": "few words"}]`,
          `Cover the biggest gaps first, stay under budget, at most one shift per person per day.`,
          `When two part-timers are similarly under-worked, prefer the more RELIABLE one — but still spread hours; don't starve a weaker performer of every shift.`,
        ].join("\n"),
      },
    ],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("model returned no JSON array");
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed)) throw new Error("model output is not an array");
  return parsed;
}
