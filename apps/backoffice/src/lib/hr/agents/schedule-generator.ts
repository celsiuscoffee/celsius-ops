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
  ROVER_SHARE_WEEKLY,
} from "../labour-gate-lib";
import { forecastWeekRevenue } from "../labour-gate";
import {
  computeDailyManHours,
  itemsPerManHourFor,
  DEFAULT_BLENDED_RATE,
  type DailyManHours,
} from "../man-hours";

const MODEL = "claude-sonnet-4-6";
const PT_MAX_HOURS_PER_WEEK = 24;
// Minimum concurrent heads while the outlet is open — the workbook's service
// floor (Tamarind explicitly 3/shift; the shift plans floor every outlet at 3).
const SERVICE_FLOOR = 3;
const PT_MAX_DAYS_PER_WEEK = 5;

// Serve-time-calibrated station throughput: items one head can make + serve per
// hour while holding a 15-minute serve target (30-min hard ceiling). Barista =
// drinks + counter pastries; kitchen = cooked food only.
//   Grounded in prep times: a drink/pastry is ~3 min (≈20/hr raw), but the same
//   head also takes orders, cashiers, serves and cleans and must keep queue
//   headroom to hold 15-min serve → ~8/hr sustainable. Cooked food is ~10 min:
//   against a 15-min target there's almost no headroom (one item every ~10 min),
//   so ~6/hr — which is exactly why a 2nd kitchen hand is needed as food volume
//   rises (weekend brunch). See docs/design/staffing-model.md. Calibratable.
const BARISTA_ITEMS_PER_HR = 8;
const KITCHEN_ITEMS_PER_HR = 6;
// Cooked-food menu categories → kitchen station; everything else (drinks +
// cakes/cookies/croissants + uncategorised) is barista/counter.
const KITCHEN_CATEGORIES = ["Roti Bakar", "Nasi Lemak", "Pasta", "Sandwiches", "Fries", "Noodle"];

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
  hourly_rate: number | null;
  rest_day: number | null; // 0=Sun … 6=Sat
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

export async function generateSchedule(
  outletId: string,
  weekStart: string,
  mode: StaffingMode = "tight",
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
    .select("user_id, position, employment_type, basic_salary, hourly_rate, schedule_required, rest_day")
    .in("user_id", users.length ? users.map((u) => u.id) : ["-"]);
  type ProfileRow = {
    user_id: string; position: string | null; employment_type: string;
    basic_salary: number | null; hourly_rate: number | null;
    schedule_required: boolean | null; rest_day: number | null;
  };
  const profileMap = new Map<string, ProfileRow>(((profiles ?? []) as ProfileRow[]).map((p) => [p.user_id, p]));

  const staff: Staff[] = users
    .filter((u) => profileMap.get(u.id)?.schedule_required !== false)
    .map((u) => {
      const p = profileMap.get(u.id);
      return {
        id: u.id,
        name: u.name,
        position: p?.position ?? null,
        employment_type: p?.employment_type ?? "full_time",
        basic_salary: Number(p?.basic_salary) || 0,
        hourly_rate: p?.hourly_rate == null ? null : Number(p.hourly_rate),
        rest_day: p?.rest_day ?? null,
        isPrimaryHere: u.outletId === outletId,
      };
    })
    // Rovers are placed separately below (2 days/outlet-week); HoD stays HQ.
    .filter((s) => !ROVER_POSITIONS.has((s.position ?? "").trim().toLowerCase()));

  // Rovers — the Area Manager and the rover lead rotate 2 days/week at each
  // outlet (workbook Rover Coverage). They are HQ-costed: RM0 to the outlet
  // in the labour gate, capped at the 2-shift rover quota. HoD excluded.
  const { data: roverProfiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, position")
    .in("position", ["Manager", "Area Manager", "Barista Lead"])
    .is("end_date", null);
  const roverIds = ((roverProfiles ?? []) as { user_id: string; position: string }[]).map((p) => p.user_id);
  const roverUsers = roverIds.length
    ? await prisma.user.findMany({ where: { id: { in: roverIds }, status: "ACTIVE" }, select: { id: true, name: true } })
    : [];
  const roverPositionOf = new Map(((roverProfiles ?? []) as { user_id: string; position: string }[]).map((p) => [p.user_id, p.position]));

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
    notes.push(`${sharedFtElsewhere.length} shared FT rostered at their primary outlet, not here: ${sharedFtElsewhere.map((s) => s.name).join(", ")}`);
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
  const hourly = await prisma.$queryRaw<Array<{ dw: number; hr: number; barista: number; kitchen: number }>>`
    SELECT EXTRACT(DOW FROM (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS dw,
           EXTRACT(HOUR FROM (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS hr,
           (sum(i.quantity) FILTER (WHERE m.category = ANY(${KITCHEN_CATEGORIES}))::float / 4) AS kitchen,
           (sum(i.quantity) FILTER (WHERE m.category IS NULL OR NOT (m.category = ANY(${KITCHEN_CATEGORIES})))::float / 4) AS barista
    FROM pos_order_items i
    JOIN pos_orders o ON o.id = i.order_id
    LEFT JOIN "Menu" m ON m."storehubId" = i.product_id
    WHERE o.outlet_id = ${outlet.loyaltyOutletId ?? ""}
      AND o.status = 'completed' AND o.refund_of_order_id IS NULL
      AND (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date
          BETWEEN ${weekStart}::date - 28 AND ${weekStart}::date - 1
    GROUP BY 1, 2
  `;
  const demand = new Map<string, number>(); // "dw:hr" → heads needed (barista + kitchen)
  const itemsByDow = new Map<number, number>(); // dw → avg total items/day (for man-hours)
  // Peak heads + its station split per day-of-week, for the QA note.
  const peakByDow = new Map<number, { heads: number; hr: number; bar: number; kit: number }>();
  for (const h of hourly) {
    const bar = Number(h.barista) || 0;
    const kit = Number(h.kitchen) || 0;
    if (bar + kit <= 0) continue;
    const barHeads = Math.ceil(bar / BARISTA_ITEMS_PER_HR);
    const kitHeads = Math.ceil(kit / KITCHEN_ITEMS_PER_HR);
    const heads = Math.max(SERVICE_FLOOR, barHeads + kitHeads);
    demand.set(`${h.dw}:${h.hr}`, heads);
    itemsByDow.set(h.dw, (itemsByDow.get(h.dw) ?? 0) + bar + kit);
    const prev = peakByDow.get(h.dw);
    if (!prev || heads > prev.heads) peakByDow.set(h.dw, { heads, hr: h.hr, bar: barHeads, kit: kitHeads });
  }

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

  // Per-day-of-week revenue (separate query — joining items to orders would
  // multiply order totals by line count). Feeds the "affordable man-hours" side.
  const revRows = await prisma.$queryRaw<Array<{ dw: number; rev: number }>>`
    SELECT EXTRACT(DOW FROM (created_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::int AS dw,
           (sum(total) / 100.0 / 4)::float AS rev
    FROM pos_orders
    WHERE outlet_id = ${outlet.loyaltyOutletId ?? ""}
      AND status = 'completed' AND refund_of_order_id IS NULL
      AND (created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date
          BETWEEN ${weekStart}::date - 28 AND ${weekStart}::date - 1
    GROUP BY 1
  `;
  const revByDow = new Map<number, number>(revRows.map((r) => [r.dw, r.rev]));

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
        forecastRevenue: revByDow.get(dow(d)) ?? 0,
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
        `(barista ${BARISTA_ITEMS_PER_HR}/hr, kitchen ${KITCHEN_ITEMS_PER_HR}/hr, ${SERVICE_FLOOR}-head floor)` +
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
  const D = openDaysList.length || 1;
  const N = sortedFT.length;
  const dayItems = (d: number) => Math.max(itemsByDow.get(d) ?? 0, 0);
  const maxItems = openDaysList.length ? Math.max(...openDaysList.map(dayItems)) : 0;
  const restCap = Math.max(0, N - SERVICE_FLOOR); // never rest a day below the service floor

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

  // Target rest-count per open day.
  const restTarget = new Map<number, number>(openDaysList.map((d) => [d, 0]));
  const spread = openDaysList.reduce((s, d) => s + (maxItems - dayItems(d)), 0);
  if (spread <= 0 || N === 0) {
    // No usable demand signal → even round-robin (prior behaviour).
    openDaysList.forEach((d, i) => restTarget.set(d, Math.floor(N / D) + (i < N % D ? 1 : 0)));
  } else {
    // Rest weight ∝ how far BELOW the busiest day each day sits, plus a small
    // smoothing so even a peak day can take the odd rest.
    const smooth = maxItems * 0.1;
    const weight = (d: number) => maxItems - dayItems(d) + smooth;
    const wsum = openDaysList.reduce((s, d) => s + weight(d), 0);
    const share = openDaysList.map((d) => ({ d, v: (N * weight(d)) / wsum }));
    let placed = 0;
    for (const x of share) {
      const r = Math.min(restCap, Math.floor(x.v));
      restTarget.set(x.d, r);
      placed += r;
    }
    // Largest-remainder: hand out the leftover rests, quietest day first.
    share.sort((a, b) => b.v - Math.floor(b.v) - (a.v - Math.floor(a.v)) || dayItems(a.d) - dayItems(b.d));
    let leftover = N - placed;
    for (let pass = 0; pass < 3 && leftover > 0; pass++) {
      for (const x of share) {
        if (leftover <= 0) break;
        if ((restTarget.get(x.d) ?? 0) < restCap) {
          restTarget.set(x.d, (restTarget.get(x.d) ?? 0) + 1);
          leftover--;
        }
      }
    }
  }

  // Fairness guarantee: if anyone hasn't had a weekend rest in the last 4 weeks,
  // make sure a weekend rest slot exists to rotate to them — shift one rest from
  // the busiest weekday onto the quieter weekend day, as long as the weekend
  // still holds the service floor. Keeps "everyone gets a weekend off sometimes"
  // true without gutting weekend coverage.
  const weekendDays = openDaysList.filter((d) => d === 0 || d === 6);
  const weekdayDays = openDaysList.filter((d) => d !== 0 && d !== 6);
  const someoneOwedWeekend = sortedFT.some((s) => s.rest_day == null && (weekendRestCount.get(s.id) ?? 0) === 0);
  const weekendHasSlot = weekendDays.some((d) => (restTarget.get(d) ?? 0) > 0);
  if (someoneOwedWeekend && !weekendHasSlot && weekendDays.length && weekdayDays.length) {
    const wknd = [...weekendDays].sort((a, b) => dayItems(a) - dayItems(b))[0];
    const donor = [...weekdayDays].filter((d) => (restTarget.get(d) ?? 0) > 0).sort((a, b) => dayItems(b) - dayItems(a))[0];
    if (wknd != null && donor != null && N - ((restTarget.get(wknd) ?? 0) + 1) >= SERVICE_FLOOR) {
      restTarget.set(wknd, (restTarget.get(wknd) ?? 0) + 1);
      restTarget.set(donor, (restTarget.get(donor) ?? 0) - 1);
    }
  }

  // Assign each FT a rest day. Profile rest_day is a hard constraint — honour it.
  const restRemaining = new Map(restTarget);
  const restDayOf = new Map<string, number>();
  for (const s of sortedFT) {
    if (s.rest_day != null && daysOpen.has(s.rest_day)) {
      restDayOf.set(s.id, s.rest_day);
      restRemaining.set(s.rest_day, (restRemaining.get(s.rest_day) ?? 0) - 1);
    }
  }
  // Weekend rest slots go FIRST to whoever's had the fewest weekend rests
  // recently — so no one is stuck working every Saturday and Sunday.
  const wkndByDebt = sortedFT
    .filter((s) => !restDayOf.has(s.id))
    .sort((a, b) => (weekendRestCount.get(a.id) ?? 0) - (weekendRestCount.get(b.id) ?? 0));
  for (const d of [...weekendDays].sort((a, b) => (restRemaining.get(b) ?? 0) - (restRemaining.get(a) ?? 0))) {
    while ((restRemaining.get(d) ?? 0) > 0) {
      const person = wkndByDebt.find((s) => !restDayOf.has(s.id));
      if (!person) break;
      restDayOf.set(person.id, d);
      weekendRestCount.set(person.id, (weekendRestCount.get(person.id) ?? 0) + 1);
      restRemaining.set(d, (restRemaining.get(d) ?? 0) - 1);
    }
  }
  // Everyone else fills the remaining slots, preferring a day they did NOT rest
  // on last week (variety), then the neediest/quietest day so heads track demand.
  for (const s of sortedFT) {
    if (restDayOf.has(s.id)) continue;
    const lastDow = lastRestByUser.get(s.id)?.dow;
    const day =
      openDaysList
        .filter((d) => (restRemaining.get(d) ?? 0) > 0)
        .sort(
          (a, b) =>
            (a === lastDow ? 1 : 0) - (b === lastDow ? 1 : 0) ||
            (restRemaining.get(b) ?? 0) - (restRemaining.get(a) ?? 0) ||
            dayItems(a) - dayItems(b),
        )[0] ??
      openDaysList[0] ??
      1;
    restDayOf.set(s.id, day);
    restRemaining.set(day, (restRemaining.get(day) ?? 0) - 1);
  }
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

    // Split the day's crew into opening / closing / middle with two rules layered
    // on the workbook pattern (kitchen on both anchors, surplus to middles):
    //  • FATIGUE: never OPEN someone who CLOSED the night before (clopening).
    //  • FAIRNESS: the unsociable anchors rotate — the person who has CLOSED
    //    least (this week, then long-run) takes the close; likewise for opening
    //    — so late nights and early starts are shared, not dumped on the same few.
    const boh = working.filter((s) => isBOH(s.position));
    const opening: Staff[] = [];
    const closing: Staff[] = [];
    const middleCrew: Staff[] = [];
    const claimed = new Set<string>();
    const take = (arr: Staff[], s: Staff) => { arr.push(s); claimed.add(s.id); };

    // Kitchen must staff both anchors: least-recent closer closes; least-recent
    // opener (that didn't close last night) opens.
    const bohClose = [...boh].sort((a, b) => closeKey(a) - closeKey(b))[0];
    if (bohClose) take(closing, bohClose);
    const bohOpen =
      [...boh].filter((s) => !claimed.has(s.id) && !closedYesterday(s)).sort((a, b) => openKey(a) - openKey(b))[0] ??
      [...boh].filter((s) => !claimed.has(s.id)).sort((a, b) => openKey(a) - openKey(b))[0];
    if (bohOpen) take(opening, bohOpen);

    // Bring CLOSING to the service floor: fewest closings first.
    for (const s of [...working].filter((s) => !claimed.has(s.id)).sort((a, b) => closeKey(a) - closeKey(b))) {
      if (closing.length >= SERVICE_FLOOR) break;
      take(closing, s);
    }
    // Bring OPENING to the service floor: exclude clopeners, fewest openings first.
    for (const s of [...working].filter((s) => !claimed.has(s.id) && !closedYesterday(s)).sort((a, b) => openKey(a) - openKey(b))) {
      if (opening.length >= SERVICE_FLOOR) break;
      take(opening, s);
    }
    // Remainder → a MIDDLE if the outlet has them and both anchors hold the
    // floor; otherwise balance the thinner anchor (a clopener always closes).
    for (const s of working) {
      if (claimed.has(s.id)) continue;
      if (tpl.middles.length > 0 && opening.length >= SERVICE_FLOOR && closing.length >= SERVICE_FLOOR) take(middleCrew, s);
      else if (closing.length <= opening.length || closedYesterday(s)) take(closing, s);
      else take(opening, s);
    }

    // Record the day's assignments into the fatigue/fairness memory.
    for (const s of opening) { weekOpen.set(s.id, (weekOpen.get(s.id) ?? 0) + 1); prevDayShift.set(s.id, "open"); }
    for (const s of closing) { weekClose.set(s.id, (weekClose.get(s.id) ?? 0) + 1); prevDayShift.set(s.id, "close"); }
    for (const s of middleCrew) prevDayShift.set(s.id, "mid");

    const dayGroups: Array<[Staff[], ShiftTemplate]> = [
      [opening, tpl.opening],
      [closing, tpl.closing],
      ...middleCrew.map((s, i): [Staff[], ShiftTemplate] => [[s], tpl.middles[i % tpl.middles.length]]),
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

  // Rover placement: 2 days each at this outlet, on the BUSIEST days (highest
  // item demand) so the extra hands land where the load is — skipping days
  // they're already rostered at another outlet this week (their full week is
  // 2 days × 3 outlets). Previously they filled the thinnest-FT-crew days,
  // which pushed them onto quiet midweek and starved the weekend.
  if (roverUsers.length > 0) {
    const { data: elsewhere } = await hrSupabaseAdmin
      .from("hr_schedule_shifts")
      .select("user_id, shift_date, schedule_id, hr_schedules!inner(week_start)")
      .in("user_id", roverUsers.map((r) => r.id))
      .eq("hr_schedules.week_start", weekStart);
    const busy = new Set(
      ((elsewhere ?? []) as Array<{ user_id: string; shift_date: string; schedule_id: string }>)
        .filter((s) => s.schedule_id !== existing?.id)
        .map((s) => `${s.user_id}:${s.shift_date}`),
    );
    for (const rover of roverUsers) {
      const days = dates
        .filter((d) => daysOpen.has(dow(d)) && !busy.has(`${rover.id}:${d}`) && !onLeave.has(`${rover.id}:${d}`))
        .sort((a, b) => dayItems(dow(b)) - dayItems(dow(a))) // busiest day first
        .slice(0, 2);
      for (const date of days) {
        // Lead joins whichever anchor shift is thinner that day.
        const openHeads = rows.filter((r) => r.shift_date === date && r.notes !== "rest_day" && r.start_time === hhmmss(tpl.opening.start_time)).length;
        const closeHeads = rows.filter((r) => r.shift_date === date && r.notes !== "rest_day" && r.start_time === hhmmss(tpl.closing.start_time)).length;
        const t = openHeads <= closeHeads ? tpl.opening : tpl.closing;
        rows.push({
          user_id: rover.id,
          shift_date: date,
          start_time: hhmmss(t.start_time),
          end_time: hhmmss(t.end_time),
          role_type: t.label,
          break_minutes: t.break_minutes,
          notes: t.id,
        });
      }
      if (days.length > 0) {
        notes.push(`Rover ${rover.name} (${roverPositionOf.get(rover.id)}): ${days.join(", ")} — RM0 to outlet, HQ-costed`);
      }
    }
  }

  // ── Stage 2: PT budget envelope — the only spend that moves labour % ─
  const forecast = Math.round(await forecastWeekRevenue(outlet, weekStart));
  // FT salaries are sunk — the envelope charges every schedulable FT their
  // full weekly share whether the roster fills them to 45h or not.
  const ftCost = Math.round(
    fullTimers.reduce((sum, s) => sum + weeklySalaryShare(s.basic_salary, null), 0),
  );
  const ptBudget = Math.max(0, Math.round(budget.target * forecast - ftCost - ROVER_SHARE_WEEKLY));
  notes.push(
    `Budget: forecast RM${forecast.toLocaleString()} × ${(budget.target * 100).toFixed(0)}% = RM${Math.round(budget.target * forecast).toLocaleString()}; ` +
      `FT (fixed) RM${ftCost.toLocaleString()} + rover RM${ROVER_SHARE_WEEKLY} → PT envelope RM${ptBudget.toLocaleString()}`,
  );

  // PT top-up target per day: after the FT + rover base is laid, how many
  // man-hours each open day is still SHORT of its required coverage. Weekends
  // carry the biggest shortfall (more items → higher required), so they draw
  // the most PT suggestions. Bounded below by the RM envelope + PT caps, so it
  // serves coverage without breaking the cost target.
  const reqByDate = new Map(manHours.map((m) => [m.date, m.requiredHours]));
  const baseHoursByDate = new Map<string, number>();
  for (const r of rows) {
    if (r.notes === "rest_day") continue;
    const mins =
      Number(r.end_time.slice(0, 2)) * 60 + Number(r.end_time.slice(3, 5)) -
      Number(r.start_time.slice(0, 2)) * 60 - Number(r.start_time.slice(3, 5)) - r.break_minutes;
    if (mins > 0) baseHoursByDate.set(r.shift_date, (baseHoursByDate.get(r.shift_date) ?? 0) + mins / 60);
  }
  const ptTargetByDate = new Map<string, number>();
  for (const d of dates) {
    if (!daysOpen.has(dow(d))) continue;
    ptTargetByDate.set(d, Math.max(0, (reqByDate.get(d) ?? 0) - (baseHoursByDate.get(d) ?? 0)));
  }
  const ptTargetTotal = Math.round([...ptTargetByDate.values()].reduce((s, v) => s + v, 0));
  if (ptTargetTotal > 0) {
    const weekendShort = dates
      .filter((d) => [0, 6].includes(dow(d)) && (ptTargetByDate.get(d) ?? 0) > 0)
      .map((d) => `${d} +${Math.round(ptTargetByDate.get(d) ?? 0)}h`);
    notes.push(
      `PT top-up target: ${ptTargetTotal}h across the week to reach required coverage after FT` +
        (weekendShort.length ? ` (weekend: ${weekendShort.join(", ")})` : ""),
    );
  }

  // Demand gaps: hourly sales (trailing 28 days, per day-of-week) → staff
  // needed per hour vs FT heads on the floor. Positive gap-hours ranked.
  // (hourly demand computed above, before the FT skeleton)

  type Gap = { date: string; template: ShiftTemplate; slot: string; gapHours: number };
  const gaps: Gap[] = [];
  // Every picker template is a candidate PT slot, keyed by template id —
  // middles first, since a mid shift bridging lunch is usually the cheapest
  // way to cover a trough between two peaks (workbook Mid-Shift Analysis).
  const candidates: Array<[string, ShiftTemplate]> = [
    ...tpl.middles.map((m) => [m.id, m] as [string, ShiftTemplate]),
    [tpl.opening.id, tpl.opening],
    [tpl.closing.id, tpl.closing],
  ];
  for (const date of dates) {
    if (!daysOpen.has(dow(date))) continue;
    for (const [slot, t] of candidates) {
      const startH = Number(t.start_time.slice(0, 2));
      const endH = Number(t.end_time.slice(0, 2));
      let gapHours = 0;
      for (let h = startH; h < endH; h++) {
        const need = (demand.get(`${dow(date)}:${h}`) ?? 0) + bufferHeads(dow(date), h);
        const have = rows.filter(
          (r) => r.shift_date === date && r.notes !== "rest_day" &&
            Number(r.start_time.slice(0, 2)) <= h && Number(r.end_time.slice(0, 2)) > h,
        ).length;
        if (need > have) gapHours += need - have;
      }
      if (gapHours > 0) gaps.push({ date, template: t, slot, gapHours });
    }
  }
  // Days furthest below their man-hour target fill first (weekends float up),
  // then by hourly gap size within a day.
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

  // ── Stage 3: agentic PT proposal, validated in code ──────────────────
  type Proposal = { user_id: string; date: string; slot: string; reason?: string };
  let proposals: Proposal[] = [];
  let agentUsed = false;
  const eligiblePt = partTimers.filter((p) => p.hourly_rate && p.hourly_rate > 0);
  const skippedPt = partTimers.length - eligiblePt.length;
  if (skippedPt > 0) notes.push(`⚠ ${skippedPt} PT skipped — no hourly rate on profile`);

  if (eligiblePt.length > 0 && ptBudget > 0 && gaps.length > 0 && process.env.ANTHROPIC_API_KEY) {
    try {
      proposals = await proposePtWithModel({
        outletName: outlet.name,
        ptBudget,
        gaps: gaps.slice(0, 20),
        partTimers: eligiblePt.map((p) => ({
          user_id: p.id,
          name: p.name,
          hourly_rate: p.hourly_rate!,
          recent_4wk_hours: Math.round(recentHours.get(p.id) ?? 0),
          leave_dates: dates.filter((d) => onLeave.has(`${p.id}:${d}`)),
        })),
        slots: Object.fromEntries(
          candidates.map(([slot, t]) => [slot, `${t.label} ${t.start_time}-${t.end_time} (${workingHours(t)}h)`]),
        ),
      });
      agentUsed = true;
    } catch (err) {
      notes.push(`Agent pass failed (${err instanceof Error ? err.message : "error"}) — greedy fallback used`);
    }
  }
  if (proposals.length === 0 && eligiblePt.length > 0 && ptBudget > 0) {
    // Greedy fallback: biggest gap first, least-used cheapest PT first.
    const byFairness = [...eligiblePt].sort(
      (a, b) => (recentHours.get(a.id) ?? 0) - (recentHours.get(b.id) ?? 0) || a.hourly_rate! - b.hourly_rate!,
    );
    let i = 0;
    for (const g of gaps) {
      proposals.push({ user_id: byFairness[i % byFairness.length].id, date: g.date, slot: g.slot, reason: `gap ${g.gapHours}h` });
      i++;
    }
  }

  // Validate every proposal against the hard constraints; violations drop.
  const slotByName = new Map<string, ShiftTemplate>(candidates.map(([slot, t]) => [slot, t]));
  const ptRows: ShiftRow[] = [];
  const ptSpend = { rm: 0 };
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
    if (ptRows.some((r) => r.user_id === person.id && r.shift_date === p.date)) continue; // one shift/day
    // Man-hour cap: stop once the day reaches its PT top-up target. Days the FT
    // base already covers (target 0) get no PT — coverage sized, not padded.
    if ((ptHoursByDate.get(p.date) ?? 0) >= (ptTargetByDate.get(p.date) ?? 0)) continue;
    const h = workingHours(t);
    const cost = h * person.hourly_rate!;
    if (ptSpend.rm + cost > ptBudget) continue;
    const wk = ptWeek.get(person.id) ?? { hours: 0, days: new Set<string>() };
    if (wk.hours + h > PT_MAX_HOURS_PER_WEEK || wk.days.size >= PT_MAX_DAYS_PER_WEEK) continue;
    wk.hours += h;
    wk.days.add(p.date);
    ptWeek.set(person.id, wk);
    ptSpend.rm += cost;
    ptHoursByDate.set(p.date, (ptHoursByDate.get(p.date) ?? 0) + h);
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
  notes.push(
    ptRows.length > 0
      ? `${ptRows.length} PT SUGGESTIONS (RM${Math.round(ptSpend.rm)} of RM${ptBudget} envelope, ${agentUsed ? "agent" : "greedy"}) — confirm in grid:\n  ${suggestionLines.join("\n  ")}`
      : `No PT suggested (envelope RM${ptBudget}, ${gaps.length} demand gaps, ${eligiblePt.length} eligible PT)`,
  );

  // ── Stage 4: atomic persist — never lose the old week on failure ─────
  const allRows = [...rows, ...ptRows];
  const totalHours = Math.round(
    allRows.filter((r) => r.notes !== "rest_day").reduce((sum, r) => {
      const mins = Number(r.end_time.slice(0, 2)) * 60 + Number(r.end_time.slice(3, 5)) -
        Number(r.start_time.slice(0, 2)) * 60 - Number(r.start_time.slice(3, 5)) - r.break_minutes;
      return sum + mins / 60;
    }, 0),
  );
  const estimatedCost = ftCost + Math.round(ptSpend.rm) + ROVER_SHARE_WEEKLY;

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
  gaps: Array<{ date: string; slot: string; gapHours: number }>;
  partTimers: Array<{ user_id: string; name: string; hourly_rate: number; recent_4wk_hours: number; leave_dates: string[] }>;
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
          `Demand gaps, biggest first (gapHours = staff-hours short of the sales-derived need):`,
          JSON.stringify(input.gaps),
          `Part-timers (recent_4wk_hours = hours they got in the last 4 weeks; spread work fairly — favour whoever has fewer recent hours when rates are similar, and never assign on their leave_dates):`,
          JSON.stringify(input.partTimers),
          ``,
          `Reply with ONLY a JSON array, no prose: [{"user_id": "...", "date": "YYYY-MM-DD", "slot": "<one of the slot keys above>", "reason": "few words"}]`,
          `Cover the biggest gaps first, stay under budget, at most one shift per person per day.`,
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
