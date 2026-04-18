import { hrSupabaseAdmin } from "../supabase";
import { prisma } from "@/lib/prisma";

type StaffInfo = {
  id: string;
  name: string;
  role: string;
  outletId: string | null;
  position: string | null;
  employment_type: "full_time" | "part_time" | "contract" | "intern";
  basic_salary: number;
  hourly_rate: number | null;
};

type ShiftSlot = {
  user_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  role_type: string;
  break_minutes: number;
};

type GenerateResult = {
  scheduleId: string;
  shifts: number;
  totalHours: number;
  estimatedCost: number;
  notes: string[];
};

// ─── Employment type rules ───────────────────────────────────────────
// shiftDuration = total time at outlet (includes break)
// workingHours = shiftDuration - breakHours (what counts for pay/OT)
// maxWorkingHoursPerWeek = OT threshold — anything above this is overtime
// 45h/week ÷ 6 days = 7.5h working/day. Shift = working + break.
const EMPLOYMENT_RULES = {
  full_time: {
    shiftDuration: 8.5,       // 8.5h at outlet (7.5h working + 1h break)
    breakMinutes: 60,         // 1h break
    workingHoursPerShift: 7.5,// what counts for pay/OT
    maxWorkingHoursPerWeek: 45, // >45h = OT
    restDaysPerWeek: 1,       // 6 working days, 1 rest
    minDaysPerWeek: 6,
    shiftTypes: ["opening", "closing"] as const,
  },
  part_time: {
    shiftDuration: 5.5,       // 5.5h at outlet
    breakMinutes: 30,         // 30min break
    workingHoursPerShift: 5,  // 5h working
    maxWorkingHoursPerWeek: 24,
    restDaysPerWeek: 0,
    minDaysPerWeek: 3,
    shiftTypes: ["morning", "afternoon", "evening"] as const,
  },
  contract: {
    shiftDuration: 8.5,
    breakMinutes: 60,
    workingHoursPerShift: 7.5,
    maxWorkingHoursPerWeek: 45,
    restDaysPerWeek: 1,
    minDaysPerWeek: 6,
    shiftTypes: ["opening", "closing"] as const,
  },
  intern: { // not used — kept for type safety
    shiftDuration: 5.5,
    breakMinutes: 30,
    workingHoursPerShift: 5,
    maxWorkingHoursPerWeek: 24,
    restDaysPerWeek: 0,
    minDaysPerWeek: 3,
    shiftTypes: ["morning", "afternoon"] as const,
  },
};

// Shift time slots — opening/closing cover the full outlet day
// 08:00-22:00 outlet hours = opening (08:00-16:30) + closing (13:30-22:00)
const SHIFT_SLOTS = {
  opening:   { start: "08:00", end: "16:30" },  // 8.5h slot → 7.5h working + 1h break
  closing:   { start: "13:30", end: "22:00" },  // 8.5h slot → 7.5h working + 1h break
  morning:   { start: "08:00", end: "13:30" },  // 5.5h — part-timers
  afternoon: { start: "13:30", end: "19:00" },  // 5.5h — part-timers
  evening:   { start: "16:30", end: "22:00" },  // 5.5h — part-timers
};

// Celsius constraints: 3-4 people per shift, labor budget RM 19,000/month/outlet
const MIN_STAFF_PER_SHIFT = 3;
const MAX_STAFF_PER_SHIFT = 4;
const MAX_MONTHLY_LABOR_COST_PER_OUTLET = 19000;

/**
 * AI Schedule Generator
 *
 * Generates a weekly schedule for an outlet considering:
 * - Full-timers: 8h shifts (opening/closing), max 48h/week, 1 rest day
 * - Part-timers: 5h shifts (morning/afternoon/evening), max 24h/week
 * - Interns: 6h shifts, max 30h/week, 2 rest days
 * - Contracts: same as full-time
 * - Approved leave excluded
 * - Fair hour distribution within each employment type
 */
export async function generateSchedule(
  outletId: string,
  weekStart: string,
): Promise<GenerateResult> {
  const notes: string[] = [];

  // 0. Load company-wide working time rules (editable in /hr/settings/working-time)
  const { data: settings } = await hrSupabaseAdmin
    .from("hr_company_settings")
    .select("max_regular_hours_per_week, overtime_warn_threshold, hard_cap_hours_per_week, max_consecutive_days, min_rest_between_shifts_hours, overtime_requires_approval")
    .limit(1)
    .maybeSingle();

  const MAX_REG_HOURS = Number(settings?.max_regular_hours_per_week ?? 45);
  const HARD_CAP_HOURS = Number(settings?.hard_cap_hours_per_week ?? 60);
  const MAX_CONSEC_DAYS = Number(settings?.max_consecutive_days ?? 6);
  const MIN_REST_HOURS = Number(settings?.min_rest_between_shifts_hours ?? 11);

  // 1. Get outlet info
  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    select: { id: true, name: true, openTime: true, closeTime: true, daysOpen: true },
  });
  if (!outlet) throw new Error("Outlet not found");

  const daysOpen = outlet.daysOpen || [1, 2, 3, 4, 5, 6, 7];

  // 2. Get staff assigned to this outlet
  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { outletId },
        { outletIds: { has: outletId } },
      ],
      role: { in: ["STAFF", "MANAGER"] },
    },
    select: { id: true, name: true, role: true, outletId: true, outletIds: true },
  });

  // Get HR profiles for employment type, salary, position, and schedule flag
  // Users marked schedule_required=false are excluded from auto-scheduling (HQ staff).
  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, position, employment_type, basic_salary, hourly_rate, schedule_required, is_rotating_multi_outlet, preferred_outlet_id")
    .in("user_id", users.map((u) => u.id));

  const profileMap = new Map(
    (profiles || []).map((p: { user_id: string; position: string; employment_type: string; basic_salary: number; hourly_rate: number | null; schedule_required: boolean; is_rotating_multi_outlet?: boolean; preferred_outlet_id?: string | null }) => [p.user_id, p]),
  );

  // Track which staff rotate across multiple outlets — we'll allocate a reduced share of their week to THIS outlet
  const rotatingUserIds = new Set(
    (profiles || [])
      .filter((p: { is_rotating_multi_outlet?: boolean }) => p.is_rotating_multi_outlet)
      .map((p: { user_id: string }) => p.user_id),
  );
  if (rotatingUserIds.size > 0) {
    notes.push(`${rotatingUserIds.size} rotating multi-outlet staff — hours at this outlet capped at a share of their weekly total`);
  }

  // Load approved/partial OT for the week per user — raises effective weekly cap
  const weekEndIso = getWeekEnd(weekStart);
  const { data: otApprovals } = await hrSupabaseAdmin
    .from("hr_overtime_requests")
    .select("user_id, hours_approved")
    .gte("date", weekStart)
    .lte("date", weekEndIso)
    .in("status", ["approved", "partial"]);
  const otHoursByUser = new Map<string, number>();
  (otApprovals || []).forEach((r: { user_id: string; hours_approved: number | null }) => {
    otHoursByUser.set(r.user_id, (otHoursByUser.get(r.user_id) || 0) + Number(r.hours_approved || 0));
  });

  const staff: StaffInfo[] = users
    .filter((u) => {
      const p = profileMap.get(u.id);
      return !p || p.schedule_required !== false;
    })
    .map((u) => {
      const p = profileMap.get(u.id);
      return {
        id: u.id,
        name: u.name,
        role: u.role,
        outletId: u.outletId,
        position: p?.position || (u.role === "MANAGER" ? "Shift Lead" : "Barista"),
        employment_type: (p?.employment_type as StaffInfo["employment_type"]) || "full_time",
        basic_salary: Number(p?.basic_salary) || 1500,
        hourly_rate: p?.hourly_rate ? Number(p.hourly_rate) : null,
      };
    });

  if (staff.length === 0) {
    throw new Error(`No active staff assigned to outlet ${outlet.name}`);
  }

  // Split by type
  const fullTimers = staff.filter((s) => s.employment_type === "full_time" || s.employment_type === "contract");
  const partTimers = staff.filter((s) => s.employment_type === "part_time");

  notes.push(`${staff.length} staff: ${fullTimers.length} full-time, ${partTimers.length} part-time`);

  // 3. Get approved leave for the week
  const weekEnd = getWeekEnd(weekStart);
  const { data: leaves } = await hrSupabaseAdmin
    .from("hr_leave_requests")
    .select("user_id, start_date, end_date")
    .in("status", ["approved", "ai_approved"])
    .lte("start_date", weekEnd)
    .gte("end_date", weekStart);

  const leaveSet = new Set<string>();
  (leaves || []).forEach((l: { user_id: string; start_date: string; end_date: string }) => {
    const start = new Date(l.start_date);
    const end = new Date(l.end_date);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      leaveSet.add(`${l.user_id}:${d.toISOString().slice(0, 10)}`);
    }
  });

  // 3b. Get staff blockout/availability dates
  const { data: availabilities } = await hrSupabaseAdmin
    .from("hr_staff_availability")
    .select("user_id, date, availability")
    .gte("date", weekStart)
    .lte("date", weekEnd)
    .eq("availability", "unavailable");

  const blockoutSet = new Set<string>();
  (availabilities || []).forEach((a: { user_id: string; date: string }) => {
    blockoutSet.add(`${a.user_id}:${a.date}`);
  });

  // 3c. Get public holidays (staff may get day off or PH rate)
  const { data: holidays } = await hrSupabaseAdmin
    .from("hr_public_holidays")
    .select("date, name")
    .gte("date", weekStart)
    .lte("date", weekEnd);

  const publicHolidayMap = new Map<string, string>();
  (holidays || []).forEach((h: { date: string; name: string }) => {
    publicHolidayMap.set(h.date, h.name);
  });

  // 4. Generate shifts
  const shifts: ShiftSlot[] = [];
  const hoursPerStaff = new Map<string, number>();
  const daysWorked = new Map<string, number>();
  const consecutiveDays = new Map<string, number>();
  const lastShiftEndISO = new Map<string, string>(); // for rest-gap enforcement

  staff.forEach((s) => {
    hoursPerStaff.set(s.id, 0);
    daysWorked.set(s.id, 0);
    consecutiveDays.set(s.id, 0);
  });

  // Cap helper — combines company rules + approved OT + rotating-staff share
  const effectiveWeeklyCap = (userId: string, employmentType: StaffInfo["employment_type"]) => {
    const typeCap = EMPLOYMENT_RULES[employmentType].maxWorkingHoursPerWeek;
    const otCap = MAX_REG_HOURS + (otHoursByUser.get(userId) || 0);
    let cap = Math.min(typeCap, otCap, HARD_CAP_HOURS);
    // Rotating multi-outlet staff: allocate only a share at this outlet (count of outlets)
    if (rotatingUserIds.has(userId)) {
      const user = users.find((u) => u.id === userId);
      const outletCount = (user?.outletIds?.length || 1);
      cap = Math.floor(cap / Math.max(1, outletCount));
    }
    return cap;
  };

  const canTakeShift = (userId: string, shiftStartHHMM: string, date: string) => {
    // Consecutive days cap
    if ((consecutiveDays.get(userId) || 0) >= MAX_CONSEC_DAYS) return false;
    // Rest gap: if had a shift yesterday, the gap between prev end and this start must be >= MIN_REST_HOURS
    const lastEnd = lastShiftEndISO.get(userId);
    if (lastEnd) {
      const [h, m] = shiftStartHHMM.split(":").map(Number);
      const thisStart = new Date(`${date}T${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:00`);
      const prevEnd = new Date(lastEnd);
      const gapHours = (thisStart.getTime() - prevEnd.getTime()) / 3600000;
      if (gapHours < MIN_REST_HOURS) return false;
    }
    return true;
  };

  const dates = getWeekDates(weekStart);

  for (const date of dates) {
    const dayOfWeek = new Date(date).getDay();
    const dayNum = dayOfWeek === 0 ? 7 : dayOfWeek;

    if (!daysOpen.includes(dayNum)) continue;

    // Check if this is a public holiday
    const phName = publicHolidayMap.get(date);
    if (phName) {
      notes.push(`${date}: Public Holiday (${phName}) — staff assigned at PH rates`);
    }

    // ─── Assign full-timers to opening/closing shifts ───
    const availableFullTimers = fullTimers.filter((s) => {
      if (leaveSet.has(`${s.id}:${date}`) || blockoutSet.has(`${s.id}:${date}`)) return false;
      const rules = EMPLOYMENT_RULES[s.employment_type];
      const cap = effectiveWeeklyCap(s.id, s.employment_type);
      // Prefer still-under-regular-cap; only allow beyond if they have approved OT
      if ((hoursPerStaff.get(s.id) || 0) + rules.workingHoursPerShift > cap) return false;
      // Consecutive-days + rest-gap check against opening slot by default
      if (!canTakeShift(s.id, SHIFT_SLOTS.opening.start, date)) return false;
      // Rest day: give rest if they've worked enough days
      const worked = daysWorked.get(s.id) || 0;
      const daysLeft = dates.length - dates.indexOf(date);
      if (worked >= 6 && daysLeft <= 1) return false; // force rest on last day if worked 6
      return true;
    });

    // Sort by hours (least first = fairness)
    availableFullTimers.sort((a, b) => (hoursPerStaff.get(a.id) || 0) - (hoursPerStaff.get(b.id) || 0));

    // Celsius policy: 3-4 people per shift. Cap staff per shift at MAX_STAFF_PER_SHIFT.
    const maxPerShift = MAX_STAFF_PER_SHIFT;
    const halfFT = Math.ceil(availableFullTimers.length / 2);
    const openingFT = availableFullTimers.slice(0, Math.min(halfFT, maxPerShift));
    const closingFT = availableFullTimers.slice(halfFT, halfFT + maxPerShift);

    // Ensure minimum coverage — overlap if needed
    if (closingFT.length < MIN_STAFF_PER_SHIFT && openingFT.length > MIN_STAFF_PER_SHIFT) {
      closingFT.unshift(...openingFT.slice(-1));
    }

    for (const s of openingFT) {
      const rules = EMPLOYMENT_RULES[s.employment_type];
      shifts.push({
        user_id: s.id,
        shift_date: date,
        start_time: SHIFT_SLOTS.opening.start,
        end_time: SHIFT_SLOTS.opening.end,
        role_type: s.position || "Barista",
        break_minutes: rules.breakMinutes,
      });
      hoursPerStaff.set(s.id, (hoursPerStaff.get(s.id) || 0) + rules.workingHoursPerShift);
      daysWorked.set(s.id, (daysWorked.get(s.id) || 0) + 1);
      consecutiveDays.set(s.id, (consecutiveDays.get(s.id) || 0) + 1);
      lastShiftEndISO.set(s.id, `${date}T${SHIFT_SLOTS.opening.end}:00`);
    }

    for (const s of closingFT) {
      if (openingFT.includes(s)) continue;
      if (!canTakeShift(s.id, SHIFT_SLOTS.closing.start, date)) continue;
      const rules = EMPLOYMENT_RULES[s.employment_type];
      shifts.push({
        user_id: s.id,
        shift_date: date,
        start_time: SHIFT_SLOTS.closing.start,
        end_time: SHIFT_SLOTS.closing.end,
        role_type: s.position || "Barista",
        break_minutes: rules.breakMinutes,
      });
      hoursPerStaff.set(s.id, (hoursPerStaff.get(s.id) || 0) + rules.workingHoursPerShift);
      daysWorked.set(s.id, (daysWorked.get(s.id) || 0) + 1);
      consecutiveDays.set(s.id, (consecutiveDays.get(s.id) || 0) + 1);
      lastShiftEndISO.set(s.id, `${date}T${SHIFT_SLOTS.closing.end}:00`);
    }

    // Reset consecutive counter for staff NOT working today
    staff.forEach((s) => {
      const workedToday = shifts.some((sh) => sh.user_id === s.id && sh.shift_date === date);
      if (!workedToday) consecutiveDays.set(s.id, 0);
    });

    // ─── Assign part-timers to fill gaps (morning/afternoon/evening) ───
    const availablePT = partTimers.filter((s) => {
      if (leaveSet.has(`${s.id}:${date}`) || blockoutSet.has(`${s.id}:${date}`)) return false;
      const rules = EMPLOYMENT_RULES.part_time;
      const cap = effectiveWeeklyCap(s.id, "part_time");
      if ((hoursPerStaff.get(s.id) || 0) + rules.workingHoursPerShift > cap) return false;
      if (!canTakeShift(s.id, SHIFT_SLOTS.morning.start, date)) return false;
      return true;
    });

    // Sort by hours (least first)
    availablePT.sort((a, b) => (hoursPerStaff.get(a.id) || 0) - (hoursPerStaff.get(b.id) || 0));

    // Assign part-timers to alternating slots across the week
    const dayIndex = dates.indexOf(date);
    const ptSlots: (keyof typeof SHIFT_SLOTS)[] = ["morning", "afternoon", "evening"];

    for (let i = 0; i < availablePT.length; i++) {
      const s = availablePT[i];
      const rules = EMPLOYMENT_RULES.part_time;

      // Rotate slot assignment based on day + index for variety
      const slotKey = ptSlots[(dayIndex + i) % ptSlots.length];
      const slot = SHIFT_SLOTS[slotKey];

      shifts.push({
        user_id: s.id,
        shift_date: date,
        start_time: slot.start,
        end_time: slot.end,
        role_type: s.position || "Barista",
        break_minutes: rules.breakMinutes,
      });
      hoursPerStaff.set(s.id, (hoursPerStaff.get(s.id) || 0) + rules.workingHoursPerShift);
      daysWorked.set(s.id, (daysWorked.get(s.id) || 0) + 1);
      consecutiveDays.set(s.id, (consecutiveDays.get(s.id) || 0) + 1);
      lastShiftEndISO.set(s.id, `${date}T${slot.end}:00`);
    }

    // (no intern scheduling — Celsius doesn't have interns)
  }

  // Surface unapproved OT (nobody should cross the regular cap without OT approval)
  hoursPerStaff.forEach((h, userId) => {
    const otAllowance = otHoursByUser.get(userId) || 0;
    if (h > MAX_REG_HOURS + otAllowance) {
      const s = staff.find((x) => x.id === userId);
      notes.push(`⚠️ ${s?.name || userId} scheduled ${h}h — above regular cap ${MAX_REG_HOURS}h. OT approval needed.`);
    }
  });

  // 5. Calculate totals
  let totalHours = 0;
  hoursPerStaff.forEach((h) => { totalHours += h; });

  // Estimate this WEEK's labor cost
  let weeklyCost = 0;
  staff.forEach((s) => {
    const hours = hoursPerStaff.get(s.id) || 0;
    if (hours === 0) return;

    if (s.employment_type === "part_time" && s.hourly_rate) {
      weeklyCost += s.hourly_rate * hours;
    } else {
      const hourlyRate = s.basic_salary / 26 / 7.5;
      weeklyCost += hourlyRate * hours;
    }
  });
  const estimatedCost = Math.round(weeklyCost * 100) / 100;

  // Project to monthly (4.33 weeks) and compare against RM 19k budget
  const projectedMonthly = estimatedCost * 4.33;
  if (projectedMonthly > MAX_MONTHLY_LABOR_COST_PER_OUTLET) {
    notes.push(
      `⚠️ Budget alert: projected monthly cost RM ${projectedMonthly.toFixed(0)} ` +
      `exceeds RM ${MAX_MONTHLY_LABOR_COST_PER_OUTLET.toLocaleString()} target. ` +
      `Consider reducing shifts or using more part-timers.`,
    );
  } else {
    notes.push(
      `Projected monthly cost: RM ${projectedMonthly.toFixed(0)} ` +
      `(${Math.round((projectedMonthly / MAX_MONTHLY_LABOR_COST_PER_OUTLET) * 100)}% of RM ${MAX_MONTHLY_LABOR_COST_PER_OUTLET / 1000}k budget)`,
    );
  }

  // Per-type hour summaries
  const ftHours = fullTimers.reduce((sum, s) => sum + (hoursPerStaff.get(s.id) || 0), 0);
  const ptHours = partTimers.reduce((sum, s) => sum + (hoursPerStaff.get(s.id) || 0), 0);

  notes.push(`${shifts.length} shifts: ${ftHours}h full-time, ${ptHours}h part-time`);
  notes.push(`Estimated cost: RM ${estimatedCost.toLocaleString()}`);

  // Flag anyone with 0 hours
  staff.forEach((s) => {
    if ((hoursPerStaff.get(s.id) || 0) === 0) {
      notes.push(`Note: ${s.name} has 0 hours (on leave or maxed out)`);
    }
  });

  // 6. Save to database
  await hrSupabaseAdmin
    .from("hr_schedules")
    .delete()
    .eq("outlet_id", outletId)
    .eq("week_start", weekStart)
    .in("status", ["draft", "ai_generated"]);

  const { data: schedule, error: schedError } = await hrSupabaseAdmin
    .from("hr_schedules")
    .insert({
      outlet_id: outletId,
      week_start: weekStart,
      week_end: weekEnd,
      status: "ai_generated",
      generated_by: "ai",
      ai_notes: notes.join("\n"),
      total_labor_hours: totalHours,
      estimated_labor_cost: estimatedCost,
    })
    .select()
    .single();

  if (schedError) throw new Error(`Failed to save schedule: ${schedError.message}`);

  const shiftRows = shifts.map((s) => ({
    schedule_id: schedule.id,
    ...s,
    is_ai_assigned: true,
  }));

  if (shiftRows.length > 0) {
    const { error: shiftError } = await hrSupabaseAdmin
      .from("hr_schedule_shifts")
      .insert(shiftRows);
    if (shiftError) throw new Error(`Failed to save shifts: ${shiftError.message}`);
  }

  return {
    scheduleId: schedule.id,
    shifts: shifts.length,
    totalHours,
    estimatedCost,
    notes,
  };
}

function getWeekDates(weekStart: string): string[] {
  const dates: string[] = [];
  const start = new Date(weekStart);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function getWeekEnd(weekStart: string): string {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}
