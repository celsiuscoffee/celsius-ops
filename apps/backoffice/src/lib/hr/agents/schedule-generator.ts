import { hrSupabaseAdmin } from "../supabase";
import { prisma } from "@/lib/prisma";

// ─── Types ───────────────────────────────────────────────────────────
type RoleCategory = "FOH" | "BOH" | "OTHER";

type StaffInfo = {
  id: string;
  name: string;
  role: string;
  outletId: string | null;
  position: string | null;
  employment_type: "full_time" | "part_time" | "contract" | "intern";
  basic_salary: number;
  hourly_rate: number | null;
  role_category: RoleCategory;
  is_rotating: boolean;
  outlet_count: number;
  rotation_outlet_ids: string[]; // explicit rotation set; empty = rotate across all outletIds
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

// ─── Employment + shift config ───────────────────────────────────────
const EMPLOYMENT_RULES = {
  full_time: { shiftDuration: 8.5, breakMinutes: 60, workingHoursPerShift: 7.5, maxWorkingHoursPerWeek: 45, maxDaysPerWeek: 6 },
  contract:  { shiftDuration: 8.5, breakMinutes: 60, workingHoursPerShift: 7.5, maxWorkingHoursPerWeek: 45, maxDaysPerWeek: 6 },
  part_time: { shiftDuration: 5.5, breakMinutes: 30, workingHoursPerShift: 5.0, maxWorkingHoursPerWeek: 24, maxDaysPerWeek: 5 },
  intern:    { shiftDuration: 5.5, breakMinutes: 30, workingHoursPerShift: 5.0, maxWorkingHoursPerWeek: 24, maxDaysPerWeek: 5 },
};

// FT shifts — cover the full outlet day. PT fills gaps.
const SHIFT_SLOTS = {
  opening:   { start: "08:00", end: "16:30", label: "Opening" },   // 7.5h + 1h break
  closing:   { start: "13:30", end: "22:00", label: "Closing" },   // 7.5h + 1h break
  morning:   { start: "08:00", end: "13:30", label: "Morning PT" }, // 5h PT
  afternoon: { start: "13:30", end: "19:00", label: "Afternoon PT" },
  evening:   { start: "16:30", end: "22:00", label: "Evening PT" },
};

// Required staffing per shift, by day type.
// Weekday = Mon-Fri, Weekend = Sat-Sun.
// Each shift (opening + closing) needs this mix.
const REQUIRED_STAFF = {
  weekday: { foh_min: 2, foh_max: 2, boh_min: 1, boh_max: 2, total_min: 3, total_max: 4 },
  weekend: { foh_min: 2, foh_max: 3, boh_min: 2, boh_max: 2, total_min: 4, total_max: 5 },
};

const MAX_MONTHLY_LABOR_COST_PER_OUTLET = 19000;

// Map position string → FOH/BOH/OTHER
function classifyRole(position: string | null | undefined): RoleCategory {
  if (!position) return "FOH"; // default fallback — most staff are FOH
  const p = position.toLowerCase();
  if (p.includes("kitchen") || p.includes("chef") || p.includes("boh")) return "BOH";
  if (
    p.includes("barista") || p.includes("cashier") || p.includes("foh") ||
    p.includes("shift lead") || p.includes("supervisor") || p.includes("manager")
  ) return "FOH";
  return "FOH"; // fallback
}

/**
 * AI Schedule Generator — rewrite (2026-04)
 *
 * Algorithm: balanced greedy with role-aware slot assignment.
 *   1. Build the list of required slots for the week (one entry per FOH/BOH slot per shift per day).
 *   2. For each slot, pick the eligible staff member with the LOWEST cumulative hours so far (fairness).
 *   3. FT fills first (opening/closing). PT fills gaps after.
 *   4. Enforce: 1 off day/week, rest gap, consecutive-days cap, weekly hour cap, role match.
 *
 * This replaces the previous slice-based algorithm that caused stacking on day 1.
 */
export async function generateSchedule(
  outletId: string,
  weekStart: string,
): Promise<GenerateResult> {
  const notes: string[] = [];

  // 0. Load company-wide working time rules
  const { data: settings } = await hrSupabaseAdmin
    .from("hr_company_settings")
    .select("max_regular_hours_per_week, hard_cap_hours_per_week, max_consecutive_days, min_rest_between_shifts_hours")
    .limit(1)
    .maybeSingle();

  const MAX_REG_HOURS = Number(settings?.max_regular_hours_per_week ?? 45);
  const HARD_CAP_HOURS = Number(settings?.hard_cap_hours_per_week ?? 60);
  const MAX_CONSEC_DAYS = Number(settings?.max_consecutive_days ?? 6);
  const MIN_REST_HOURS = Number(settings?.min_rest_between_shifts_hours ?? 11);

  // 1. Outlet
  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    select: { id: true, name: true, openTime: true, closeTime: true, daysOpen: true },
  });
  if (!outlet) throw new Error("Outlet not found");
  const daysOpen = outlet.daysOpen || [1, 2, 3, 4, 5, 6, 7];

  // 2. Staff for this outlet
  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ outletId }, { outletIds: { has: outletId } }],
      role: { in: ["STAFF", "MANAGER"] },
    },
    select: { id: true, name: true, role: true, outletId: true, outletIds: true },
  });

  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, position, employment_type, basic_salary, hourly_rate, schedule_required, is_rotating_multi_outlet, preferred_outlet_id, rotation_outlet_ids")
    .in("user_id", users.map((u) => u.id));

  const profileMap = new Map(
    (profiles || []).map((p: {
      user_id: string; position: string | null; employment_type: string;
      basic_salary: number; hourly_rate: number | null;
      schedule_required: boolean | null; is_rotating_multi_outlet: boolean | null;
      preferred_outlet_id: string | null;
      rotation_outlet_ids: string[] | null;
    }) => [p.user_id, p]),
  );

  const staff: StaffInfo[] = users
    .filter((u) => {
      const p = profileMap.get(u.id);
      return !p || p.schedule_required !== false;
    })
    .map((u) => {
      const p = profileMap.get(u.id);
      const outletIds = u.outletIds || [];
      return {
        id: u.id,
        name: u.name,
        role: u.role,
        outletId: u.outletId,
        position: p?.position || null,
        employment_type: (p?.employment_type as StaffInfo["employment_type"]) || "full_time",
        basic_salary: Number(p?.basic_salary) || 1500,
        hourly_rate: p?.hourly_rate ? Number(p.hourly_rate) : null,
        role_category: classifyRole(p?.position),
        is_rotating: !!p?.is_rotating_multi_outlet,
        outlet_count: Math.max(1, outletIds.length),
        rotation_outlet_ids: (p?.rotation_outlet_ids || []) as string[],
      };
    })
    // Rotating staff: if rotation_outlet_ids is populated, skip them when
    // scheduling an outlet that's NOT in their explicit rotation set.
    // (outletIds may include outlets they only have app access to, e.g. for
    // attendance review, but shouldn't be auto-scheduled at.)
    .filter((s) => {
      if (!s.is_rotating) return true;
      if (s.rotation_outlet_ids.length === 0) return true; // no explicit set → rotate across all outletIds
      return s.rotation_outlet_ids.includes(outletId);
    });

  if (staff.length === 0) throw new Error(`No active staff assigned to outlet ${outlet.name}`);

  const fullTimers = staff.filter((s) => s.employment_type === "full_time" || s.employment_type === "contract");
  const partTimers = staff.filter((s) => s.employment_type === "part_time");
  const rotating = staff.filter((s) => s.is_rotating);

  notes.push(`${staff.length} staff: ${fullTimers.length} FT, ${partTimers.length} PT (${rotating.length} multi-outlet rotating)`);

  const fohCount = fullTimers.filter((s) => s.role_category === "FOH").length;
  const bohCount = fullTimers.filter((s) => s.role_category === "BOH").length;
  notes.push(`FT role mix: ${fohCount} FOH, ${bohCount} BOH`);

  // 3. Leave, blockouts, PH
  const weekEnd = getWeekEnd(weekStart);
  const { data: leaves } = await hrSupabaseAdmin
    .from("hr_leave_requests")
    .select("user_id, start_date, end_date")
    .in("status", ["approved", "ai_approved"])
    .lte("start_date", weekEnd)
    .gte("end_date", weekStart);
  const leaveSet = new Set<string>();
  (leaves || []).forEach((l: { user_id: string; start_date: string; end_date: string }) => {
    const s = new Date(l.start_date);
    const e = new Date(l.end_date);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      leaveSet.add(`${l.user_id}:${d.toISOString().slice(0, 10)}`);
    }
  });

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

  const { data: holidays } = await hrSupabaseAdmin
    .from("hr_public_holidays")
    .select("date, name")
    .gte("date", weekStart)
    .lte("date", weekEnd);
  const publicHolidayMap = new Map<string, string>();
  (holidays || []).forEach((h: { date: string; name: string }) => publicHolidayMap.set(h.date, h.name));

  // Approved OT — raises weekly cap
  const { data: otApprovals } = await hrSupabaseAdmin
    .from("hr_overtime_requests")
    .select("user_id, hours_approved")
    .gte("date", weekStart)
    .lte("date", weekEnd)
    .in("status", ["approved", "partial"]);
  const otHoursByUser = new Map<string, number>();
  (otApprovals || []).forEach((r: { user_id: string; hours_approved: number | null }) => {
    otHoursByUser.set(r.user_id, (otHoursByUser.get(r.user_id) || 0) + Number(r.hours_approved || 0));
  });

  // 4. State tracking
  const shifts: ShiftSlot[] = [];
  const hoursPerStaff = new Map<string, number>();
  const daysWorked = new Map<string, number>();
  const consecutiveDays = new Map<string, number>();
  const lastShiftEndISO = new Map<string, string>();
  const shiftsByStaffDate = new Map<string, ShiftSlot>(); // userId:date → shift
  staff.forEach((s) => {
    hoursPerStaff.set(s.id, 0);
    daysWorked.set(s.id, 0);
    consecutiveDays.set(s.id, 0);
  });

  // Compute week dates early so we can pre-assign off days
  const dates = getWeekDates(weekStart);

  // Pre-assign each FT staff an OFF DAY distributed across the week so
  // Sunday doesn't end up empty (previous bug: greedy filled Mon-Sat then
  // everyone maxed out for Sunday). Each FT gets exactly 1 off day.
  // Rotating staff skip this — they're limited by hours cap anyway.
  const preferredOffDay = new Map<string, string>(); // userId → YYYY-MM-DD
  const nonRotatingFT = fullTimers.filter((s) => !s.is_rotating);
  nonRotatingFT.forEach((s, idx) => {
    // Spread off days across 7 days of the week (round-robin)
    // Index 0 = Mon dates[0], 1 = Tue dates[1], ..., 6 = Sun dates[6]
    preferredOffDay.set(s.id, dates[idx % 7]);
  });

  // Rotating staff split their weekly cap across their rotation outlets.
  // Use rotation_outlet_ids.length if set (Syafiq/Adam = 3), else full outletIds.
  const rotationShare = (s: StaffInfo) =>
    s.rotation_outlet_ids.length > 0 ? s.rotation_outlet_ids.length : Math.max(1, s.outlet_count);

  const weeklyCap = (s: StaffInfo) => {
    const typeCap = EMPLOYMENT_RULES[s.employment_type].maxWorkingHoursPerWeek;
    const otCap = MAX_REG_HOURS + (otHoursByUser.get(s.id) || 0);
    let cap = Math.min(typeCap, otCap, HARD_CAP_HOURS);
    if (s.is_rotating) cap = Math.floor(cap / rotationShare(s)); // e.g. 45/3 = 15h per outlet = 2 shifts
    return cap;
  };

  const maxDaysFor = (s: StaffInfo) => {
    const rules = EMPLOYMENT_RULES[s.employment_type];
    if (s.is_rotating) return Math.max(2, Math.floor(rules.maxDaysPerWeek / rotationShare(s)));
    return rules.maxDaysPerWeek;
  };

  // Can this staff take this shift on this date?
  // `relaxed` mode is used in the fallback pass when a shift is still below
  // minimum staffing — drops rest-gap floor to 9h and allows up to 7
  // consecutive days. Hard limits (leave, same-day, weekly cap) are never
  // relaxed.
  const canWork = (
    s: StaffInfo,
    date: string,
    shiftStart: string,
    shiftHours: number,
    relaxed = false,
  ): string | true => {
    if (leaveSet.has(`${s.id}:${date}`)) return "on leave";
    if (blockoutSet.has(`${s.id}:${date}`)) return "blocked out";
    if (shiftsByStaffDate.has(`${s.id}:${date}`)) return "already assigned today";
    // Preferred off day — skip in normal pass, allow in relaxed pass
    if (!relaxed && preferredOffDay.get(s.id) === date) return "preferred off day";
    const worked = daysWorked.get(s.id) || 0;
    const maxDays = relaxed ? maxDaysFor(s) + 1 : maxDaysFor(s);
    if (worked >= maxDays) return `max days reached (${worked})`;
    const consec = consecutiveDays.get(s.id) || 0;
    const maxConsec = relaxed ? MAX_CONSEC_DAYS + 1 : MAX_CONSEC_DAYS;
    if (consec >= maxConsec) return `max consecutive days`;
    const hours = hoursPerStaff.get(s.id) || 0;
    if (hours + shiftHours > weeklyCap(s)) return `weekly cap`;
    const lastEnd = lastShiftEndISO.get(s.id);
    if (lastEnd) {
      const [h, m] = shiftStart.split(":").map(Number);
      const thisStart = new Date(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
      const prevEnd = new Date(lastEnd);
      const gapHours = (thisStart.getTime() - prevEnd.getTime()) / 3600000;
      const minGap = relaxed ? Math.min(9, MIN_REST_HOURS) : MIN_REST_HOURS;
      if (gapHours < minGap) return `rest gap ${gapHours.toFixed(1)}h < ${minGap}h`;
    }
    return true;
  };

  const assignShift = (s: StaffInfo, date: string, slot: typeof SHIFT_SLOTS.opening, workingHours: number, breakMin: number) => {
    const shift: ShiftSlot = {
      user_id: s.id,
      shift_date: date,
      start_time: slot.start,
      end_time: slot.end,
      role_type: s.position || (s.role_category === "BOH" ? "Kitchen Crew" : "Barista"),
      break_minutes: breakMin,
    };
    shifts.push(shift);
    shiftsByStaffDate.set(`${s.id}:${date}`, shift);
    hoursPerStaff.set(s.id, (hoursPerStaff.get(s.id) || 0) + workingHours);
    daysWorked.set(s.id, (daysWorked.get(s.id) || 0) + 1);
    consecutiveDays.set(s.id, (consecutiveDays.get(s.id) || 0) + 1);
    lastShiftEndISO.set(s.id, `${date}T${slot.end}:00`);
  };

  // 5. Main loop — greedy balanced by hours
  for (const date of dates) {
    const dayOfWeek = new Date(date).getDay();
    const dayNum = dayOfWeek === 0 ? 7 : dayOfWeek;
    if (!daysOpen.includes(dayNum)) continue;

    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const req = isWeekend ? REQUIRED_STAFF.weekend : REQUIRED_STAFF.weekday;
    const phName = publicHolidayMap.get(date);
    if (phName) notes.push(`${date}: Public Holiday (${phName})`);

    // Track already-assigned-today to avoid double-assigning within the day
    // (same user can't take opening AND closing same day).
    for (const shiftKey of ["opening", "closing"] as const) {
      const slot = SHIFT_SLOTS[shiftKey];
      let fohAssigned = 0;
      let bohAssigned = 0;
      let rotatingOnThisShift = false; // at most 1 rotating (Syafiq/Adam) per shift

      // Try to fill FOH first, then BOH
      for (const category of ["FOH", "BOH"] as const) {
        const targetMin = category === "FOH" ? req.foh_min : req.boh_min;
        const targetMax = category === "FOH" ? req.foh_max : req.boh_max;

        while (
          (category === "FOH" ? fohAssigned : bohAssigned) < targetMax
        ) {
          // Stop once min reached and total would exceed max
          if ((category === "FOH" ? fohAssigned : bohAssigned) >= targetMin &&
              (fohAssigned + bohAssigned) >= req.total_max) break;

          // Build candidate list: FT first, then PT. Only matching role_category.
          // Sort by (current hours ascending) for fairness.
          const candidates = [...fullTimers, ...partTimers]
            .filter((s) => s.role_category === category)
            .sort((a, b) => {
              // FT before PT
              const aIsFT = a.employment_type !== "part_time" ? 0 : 1;
              const bIsFT = b.employment_type !== "part_time" ? 0 : 1;
              if (aIsFT !== bIsFT) return aIsFT - bIsFT;
              return (hoursPerStaff.get(a.id) || 0) - (hoursPerStaff.get(b.id) || 0);
            });

          let picked: StaffInfo | null = null;
          for (const s of candidates) {
            // At most 1 rotating staff (Syafiq/Adam) per shift — they come
            // in AS the lead, two of them on the same shift is redundant.
            if (s.is_rotating && rotatingOnThisShift) continue;
            const rules = EMPLOYMENT_RULES[s.employment_type];
            const ok = canWork(s, date, slot.start, rules.workingHoursPerShift);
            if (ok === true) { picked = s; break; }
          }

          if (!picked) break; // can't fill any more of this role

          const rules = EMPLOYMENT_RULES[picked.employment_type];
          assignShift(picked, date, slot, rules.workingHoursPerShift, rules.breakMinutes);
          if (picked.is_rotating) rotatingOnThisShift = true;
          if (category === "FOH") fohAssigned++;
          else bohAssigned++;
        }
      }

      // Second pass — if still below minimum, retry with RELAXED constraints
      // (preferred off day, rest gap to 9h, +1 consecutive day).
      for (const category of ["FOH", "BOH"] as const) {
        const currentMin = category === "FOH" ? req.foh_min : req.boh_min;
        const assigned = () => category === "FOH" ? fohAssigned : bohAssigned;
        while (assigned() < currentMin) {
          const candidates = [...fullTimers, ...partTimers]
            .filter((s) => s.role_category === category)
            .sort((a, b) => (hoursPerStaff.get(a.id) || 0) - (hoursPerStaff.get(b.id) || 0));
          let picked: StaffInfo | null = null;
          for (const s of candidates) {
            if (s.is_rotating && rotatingOnThisShift) continue;
            const rules = EMPLOYMENT_RULES[s.employment_type];
            const ok = canWork(s, date, slot.start, rules.workingHoursPerShift, /* relaxed */ true);
            if (ok === true) { picked = s; break; }
          }
          if (!picked) break;
          const rules = EMPLOYMENT_RULES[picked.employment_type];
          assignShift(picked, date, slot, rules.workingHoursPerShift, rules.breakMinutes);
          if (picked.is_rotating) rotatingOnThisShift = true;
          if (category === "FOH") fohAssigned++;
          else bohAssigned++;
          notes.push(`ℹ️ ${date} ${shiftKey}: filled ${category} with ${picked.name} (relaxed constraints)`);
        }
      }

      // Warn if STILL understaffed after relaxed pass
      if (fohAssigned < req.foh_min) {
        notes.push(`⚠️ ${date} ${shiftKey}: FOH understaffed ${fohAssigned}/${req.foh_min} — hire or cover manually`);
      }
      if (bohAssigned < req.boh_min) {
        notes.push(`⚠️ ${date} ${shiftKey}: BOH understaffed ${bohAssigned}/${req.boh_min} — hire or cover manually`);
      }
    }

    // Reset consecutive counter for staff NOT working today
    staff.forEach((s) => {
      if (!shiftsByStaffDate.has(`${s.id}:${date}`)) {
        consecutiveDays.set(s.id, 0);
      }
    });
  }

  // 6. Flag staff with insufficient days (FT should have 6 = 1 off day)
  fullTimers.forEach((s) => {
    const d = daysWorked.get(s.id) || 0;
    if (d < 5 && !leaveSet.has(`${s.id}:${weekStart}`)) {
      notes.push(`Note: ${s.name} scheduled only ${d} days — check availability or role match`);
    }
  });

  // 7. Cost estimate
  let totalHours = 0;
  let weeklyCost = 0;
  staff.forEach((s) => {
    const h = hoursPerStaff.get(s.id) || 0;
    totalHours += h;
    if (h === 0) return;
    if (s.employment_type === "part_time" && s.hourly_rate) {
      weeklyCost += s.hourly_rate * h;
    } else {
      const hourlyFT = s.basic_salary / 26 / 7.5;
      weeklyCost += hourlyFT * h;
    }
  });
  const estimatedCost = Math.round(weeklyCost * 100) / 100;
  const projectedMonthly = estimatedCost * 4.33;
  if (projectedMonthly > MAX_MONTHLY_LABOR_COST_PER_OUTLET) {
    notes.push(`⚠️ Budget: projected RM ${projectedMonthly.toFixed(0)} > RM ${MAX_MONTHLY_LABOR_COST_PER_OUTLET.toLocaleString()}`);
  } else {
    notes.push(`Projected monthly: RM ${projectedMonthly.toFixed(0)} (${Math.round(projectedMonthly / MAX_MONTHLY_LABOR_COST_PER_OUTLET * 100)}% of budget)`);
  }

  const ftHours = fullTimers.reduce((s, x) => s + (hoursPerStaff.get(x.id) || 0), 0);
  const ptHours = partTimers.reduce((s, x) => s + (hoursPerStaff.get(x.id) || 0), 0);
  notes.push(`${shifts.length} shifts: ${ftHours}h FT, ${ptHours}h PT. Total ${totalHours}h, cost RM ${estimatedCost.toLocaleString()}`);

  // Any staff with 0 hours?
  staff.forEach((s) => {
    if ((hoursPerStaff.get(s.id) || 0) === 0 && !leaveSet.has(`${s.id}:${weekStart}`)) {
      notes.push(`Note: ${s.name} (${s.role_category}) has 0 hours`);
    }
  });

  // 8. Persist
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

  if (shifts.length > 0) {
    const { error: shiftError } = await hrSupabaseAdmin
      .from("hr_schedule_shifts")
      .insert(shifts.map((s) => ({ schedule_id: schedule.id, ...s, is_ai_assigned: true })));
    if (shiftError) throw new Error(`Failed to save shifts: ${shiftError.message}`);
  }

  return { scheduleId: schedule.id, shifts: shifts.length, totalHours, estimatedCost, notes };
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
