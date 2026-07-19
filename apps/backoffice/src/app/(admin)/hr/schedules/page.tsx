"use client";

import { useFetch } from "@/lib/use-fetch";
import { minConcurrentInSlot } from "@/lib/hr/coverage";
import { Fragment, useState, useMemo, useEffect } from "react";
import Link from "next/link";
import {
  Bot, CalendarDays, Send, Loader2, ArrowLeftRight,
  ChevronLeft, ChevronRight, RotateCcw, Trash2, Sparkles, X,
  ChefHat, Coffee, RefreshCw, Plus,
} from "lucide-react";
import { HrPageHeader } from "@/components/hr/page-header";
import { AssistPanel } from "@/components/hr/assist-panel";

type ShiftTemplate = {
  id: string;
  label: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  color: string;
};

type User = {
  id: string;
  name: string;
  fullName: string | null;
  role: string;
  profile: { position: string | null; employment_type: string } | null;
};

type Shift = {
  id: string;
  user_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  role_type: string | null;
  break_minutes: number;
  notes: string | null;
};

type LeaveRange = { user_id: string; leave_type: string; start_date: string; end_date: string };
type Availability = { user_id: string; date: string; availability: string; reason: string | null };
type Holiday = { date: string; name: string };
type WeeklyAvailability = {
  user_id: string;
  day_of_week: number;      // 0=Sun..6=Sat
  available_from: string;   // "07:30:00"
  available_until: string;
  is_preferred: boolean;
  max_shifts_per_week: number | null;
};
type CoverageRule = {
  day_of_week: number;
  slot_start: string;
  slot_end: string;
  min_staff: number;
  slot_label: string | null;
  is_peak: boolean;
};

type GridData = {
  outlet: { id: string; code: string; name: string };
  week_start: string;
  week_end: string;
  days: string[];
  users: User[];
  schedule: { id: string; status: string } | null;
  shifts: Shift[];
  leaves: LeaveRange[];
  // Shifts this person holds at OTHER outlets this week — blocks the cell here.
  elsewhere?: Array<{ user_id: string; shift_date: string; start_time: string; end_time: string; outlet_name: string; suggested: boolean }>;
  availability: Availability[];
  weeklyAvailability: WeeklyAvailability[];
  coverageRules: CoverageRule[];
  holidays: Holiday[];
  templates: ShiftTemplate[];
};

type LabourGateInfo = {
  forecastRevenue: number;
  rosterCost: number;
  ftFixedCost: number;
  ptCost: number;
  rosterHours: number;
  pct: number | null;
  targetPct: number;
  ceilingPct: number;
  verdict: "green" | "amber" | "red" | "unknown";
  blockers: string[];
  warnings: string[];
  coverage?: Array<{
    date: string; neededHours: number; scheduledHours: number; shortHours: number;
    items?: number;
    barItems?: number;
    kitItems?: number;
    forecast?: number; pct?: number | null; isWeekend?: boolean; isHoliday?: boolean; holidayName?: string;
  }>;
};

type SwapRequest = {
  id: string;
  status: string;
  reason: string | null;
  requester_id: string;
  target_id: string;
  requester_shift: { shift_date: string; start_time: string; end_time: string } | null;
  target_shift: { shift_date: string; start_time: string; end_time: string } | null;
  created_at: string;
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const COLOR_MAP: Record<string, string> = {
  amber: "bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100",
  indigo: "bg-indigo-50 border-indigo-300 text-indigo-900 hover:bg-indigo-100",
  blue: "bg-blue-50 border-blue-300 text-blue-900 hover:bg-blue-100",
  purple: "bg-purple-50 border-purple-300 text-purple-900 hover:bg-purple-100",
  gray: "bg-gray-50 border-gray-300 text-gray-900 hover:bg-gray-100",
};

function getNextMonday(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 1 ? 0 : day === 0 ? 1 : 8 - day;
  const m = new Date(now);
  m.setUTCDate(now.getUTCDate() + diff);
  return m.toISOString().slice(0, 10);
}

function addWeeks(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

function formatDay(date: string) {
  const d = new Date(date + "T00:00:00Z");
  return String(d.getUTCDate());
}

function fmtH(h: number): string {
  return h % 1 === 0 ? String(h) : h.toFixed(1);
}

export default function SchedulesPage() {
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([]);
  const [selectedOutlet, setSelectedOutlet] = useState<string>("");
  const [weekStart, setWeekStart] = useState(getNextMonday());
  const [pickerOpen, setPickerOpen] = useState<{ userId: string; date: string; top: number; left: number } | null>(null);
  // Custom hours form state — opened from inside picker
  const [customForm, setCustomForm] = useState<{ start: string; end: string; breakMinutes: number } | null>(null);

  const openPicker = (userId: string, date: string, e: React.MouseEvent<HTMLButtonElement>) => {
    if (isPublished) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const POPUP_WIDTH = 224; // w-56
    // Cap should match the CSS max-h-[70vh] on the popup container.
    const POPUP_MAX_HEIGHT = Math.min(window.innerHeight * 0.7, 480);
    const left = Math.min(rect.left, window.innerWidth - POPUP_WIDTH - 8);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    // Prefer opening below the cell. If there's not enough room below AND
    // there's more space above, flip up. Otherwise clamp to the viewport so
    // the popup's internal scroll has a visible window to scroll inside.
    let top: number;
    if (spaceBelow < POPUP_MAX_HEIGHT && spaceAbove > spaceBelow) {
      top = Math.max(8, rect.top - POPUP_MAX_HEIGHT - 4);
    } else {
      top = Math.min(rect.bottom + 4, window.innerHeight - POPUP_MAX_HEIGHT - 8);
      top = Math.max(8, top);
    }
    setPickerOpen({ userId, date, top, left });
    setCustomForm(null); // close custom form when reopening picker
  };
  const [saving, setSaving] = useState(false);
  const [pendingCheck, setPendingCheck] = useState<null | {
    userId: string;
    date: string;
    templateId: string | null;
    status: "warn" | "overtime" | "block";
    message: string;
    proposed: number;
    limit: number;
  }>(null);
  const [publishing, setPublishing] = useState(false);
  const [gate, setGate] = useState<LabourGateInfo | null>(null);
  const [view, setView] = useState<"week" | "day">("week");
  const [dayIdx, setDayIdx] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [fillMode, setFillMode] = useState<"tight" | "mid" | "safe">("tight");
  const [assistDate, setAssistDate] = useState<string | null>(null); // per-day Assist modal
  const [whyDate, setWhyDate] = useState<string | null>(null); // per-day "why this staffing" popover
  // Per-day demand coverage (same model as AI Fill / Assist) so the cell "+ Add"
  // picker can lead with the shift the day is actually short on — filtered to
  // the clicked person's station (a kitchen hand sees kitchen gaps, a barista
  // sees counter gaps). Lazily fetched per date when a picker opens; cleared on
  // any save so gaps stay live.
  const [dayCov, setDayCov] = useState<Record<string, Array<{
    template_id?: string; label?: string; slot_start: string; slot_end: string;
    min_staff: number; concurrent: number; gap: number;
    kitchen_gap?: number; barista_gap?: number;
  }>>>({});
  const [clearing, setClearing] = useState(false);
  const [swapAction, setSwapAction] = useState<string | null>(null);
  const [slotBusy, setSlotBusy] = useState<string | null>(null);
  const [postSlotForm, setPostSlotForm] = useState<{ date: string; templateId: string; station: "barista" | "kitchen" } | null>(null);

  // Get outlets list from the old endpoint (for dropdown)
  const { data: scheduleList } = useFetch<{ outlets: { id: string; name: string }[] }>("/api/hr/schedules");

  // When a cell picker opens, fetch that day's demand coverage (once per date)
  // so the picker can suggest the short window directly on "+ Add".
  useEffect(() => {
    const dt = pickerOpen?.date;
    if (!dt || !selectedOutlet || dayCov[dt]) return;
    let stale = false;
    fetch(`/api/hr/schedules/candidates?outlet_id=${selectedOutlet}&date=${dt}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!stale && j) setDayCov((prev) => ({ ...prev, [dt]: j.coverage || [] }));
      })
      .catch(() => {});
    return () => { stale = true; };
  }, [pickerOpen, selectedOutlet, dayCov]);

  useEffect(() => {
    if (scheduleList?.outlets && outlets.length === 0) {
      setOutlets(scheduleList.outlets);
      if (scheduleList.outlets.length > 0 && !selectedOutlet) {
        setSelectedOutlet(scheduleList.outlets[0].id);
      }
    }
  }, [scheduleList, outlets.length, selectedOutlet]);

  const gridUrl = selectedOutlet
    ? `/api/hr/schedules/grid?outlet_id=${selectedOutlet}&week_start=${weekStart}`
    : null;

  const { data: grid, mutate } = useFetch<GridData>(gridUrl);

  // Open slots for this outlet+week — unfilled gaps the generator (or a
  // manager, source 'manual') posted for staff to book in the staff apps.
  type OpenSlot = {
    id: string; shift_date: string; start_time: string; end_time: string;
    break_minutes: number | null; station: string; role_type: string | null;
    source: string; status: string; claimed_by: string | null; claimed_at: string | null; claimed_by_name: string | null;
  };
  const { data: openSlotsData, mutate: mutateOpenSlots } = useFetch<{ slots: OpenSlot[] }>(
    selectedOutlet ? `/api/hr/open-shifts?outlet_id=${selectedOutlet}&week_start=${weekStart}` : null,
  );
  const openSlots = useMemo(() => openSlotsData?.slots ?? [], [openSlotsData]);

  const cancelOpenSlot = async (id: string) => {
    setSlotBusy(id);
    try {
      const res = await fetch("/api/hr/open-shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", id }),
      });
      if (!res.ok) alert((await res.json().catch(() => null))?.error ?? "Cancel failed");
      mutateOpenSlots();
    } finally {
      setSlotBusy(null);
    }
  };

  const postOpenSlot = async () => {
    if (!postSlotForm || !grid) return;
    const t = (grid.templates || []).find((x) => x.id === postSlotForm.templateId);
    if (!t) return;
    setSlotBusy("post");
    try {
      const res = await fetch("/api/hr/open-shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          outlet_id: selectedOutlet,
          shift_date: postSlotForm.date,
          start_time: t.start_time,
          end_time: t.end_time,
          break_minutes: t.break_minutes,
          station: postSlotForm.station,
          role_type: t.label,
        }),
      });
      if (!res.ok) alert((await res.json().catch(() => null))?.error ?? "Post failed");
      else setPostSlotForm(null);
      mutateOpenSlots();
    } finally {
      setSlotBusy(null);
    }
  };

  // Labour-cost gate preview — reprices the week whenever the roster changes
  // so the manager sees the projected labour % while still editing.
  const shiftCount = grid?.shifts?.length ?? -1;
  useEffect(() => {
    if (!selectedOutlet || shiftCount < 0) return;
    let cancelled = false;
    fetch("/api/hr/schedules/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outlet_id: selectedOutlet, week_start: weekStart, action: "preview" }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setGate(d?.gate ?? null);
      })
      .catch(() => {
        if (!cancelled) setGate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedOutlet, weekStart, shiftCount]);
  const { data: swapData, mutate: mutateSwaps } = useFetch<{ swaps: SwapRequest[] }>("/api/hr/swap");
  const pendingSwaps = swapData?.swaps || [];

  // Index shifts by (user_id, date)
  const shiftsMap = useMemo(() => {
    const m = new Map<string, Shift>();
    (grid?.shifts || []).forEach((s) => m.set(`${s.user_id}:${s.shift_date}`, s));
    return m;
  }, [grid]);

  // Per-day staffing composition — decomposes the opaque "75h total" into
  // FT + rover + PT (and who's resting), so the day headers explain themselves
  // instead of looking arbitrary (owner, 2026-07-18: "the math does not make
  // sense"). FT hours are sunk; rover/PT are the visible add-ons.
  type DayComp = {
    ftH: number; roverH: number; ptH: number; ptSuggestedH: number; mgrH: number;
    ftCount: number; resting: string[]; rovers: string[]; mgrs: string[];
    pts: Array<{ name: string; suggested: boolean }>;
  };
  const dayComposition = useMemo(() => {
    const map = new Map<string, DayComp>();
    if (!grid) return map;
    const userOf = new Map(grid.users.map((u) => [u.id, u]));
    // Management = presence, NOT man-hours (owner rule 2026-07-18); shown as a
    // separate "MGR … cover" tag outside the additive total. The Barista Lead
    // rover DOES work the bar, so their hours stay inside the total as RV.
    const isMgmtPos = (p: string | null | undefined) => {
      const s = (p ?? "").trim().toLowerCase();
      return s === "manager" || s === "area manager" || s === "head of department";
    };
    const isRoverPos = (p: string | null | undefined) =>
      (p ?? "").trim().toLowerCase() === "barista lead";
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    for (const s of grid.shifts) {
      const entry = map.get(s.shift_date) ?? {
        ftH: 0, roverH: 0, ptH: 0, ptSuggestedH: 0, mgrH: 0, ftCount: 0, resting: [], rovers: [], mgrs: [], pts: [],
      };
      const u = userOf.get(s.user_id);
      const nm = u ? (u.fullName || u.name).split(" ")[0] : "?";
      if (s.start_time.slice(0, 5) === "00:00") {
        entry.resting.push(nm);
        map.set(s.shift_date, entry);
        continue;
      }
      const h = Math.max(0, (toMin(s.end_time) - toMin(s.start_time) - (s.break_minutes || 0)) / 60);
      const p = u?.profile;
      if (isMgmtPos(p?.position)) {
        entry.mgrH += h;
        entry.mgrs.push(nm);
      } else if (isRoverPos(p?.position)) {
        entry.roverH += h;
        entry.rovers.push(nm);
      } else if (p?.employment_type === "part_time" || p?.employment_type === "intern") {
        entry.ptH += h;
        const suggested = s.notes === "pt_suggestion";
        if (suggested) entry.ptSuggestedH += h;
        entry.pts.push({ name: nm, suggested });
      } else {
        entry.ftH += h;
        entry.ftCount += 1;
      }
      map.set(s.shift_date, entry);
    }
    return map;
  }, [grid]);

  // Index leaves by (user_id, date)
  const leavesMap = useMemo(() => {
    const m = new Map<string, LeaveRange>();
    (grid?.leaves || []).forEach((l) => {
      const start = new Date(l.start_date + "T00:00:00Z");
      const end = new Date(l.end_date + "T00:00:00Z");
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        m.set(`${l.user_id}:${d.toISOString().slice(0, 10)}`, l);
      }
    });
    return m;
  }, [grid]);

  // Index availability blockouts
  // Cross-outlet block: (user, date) → the shift they hold at ANOTHER outlet.
  // One outlet per person per day — the cell renders blocked with the remark.
  const elsewhereMap = useMemo(() => {
    const m = new Map<string, { outlet_name: string; start_time: string; end_time: string; suggested: boolean }>();
    for (const e of grid?.elsewhere || []) m.set(`${e.user_id}|${e.shift_date}`, e);
    return m;
  }, [grid]);

  const blockoutMap = useMemo(() => {
    const m = new Map<string, Availability>();
    (grid?.availability || []).forEach((a) => {
      if (a.availability === "unavailable") m.set(`${a.user_id}:${a.date}`, a);
    });
    return m;
  }, [grid]);

  const holidayMap = useMemo(() => {
    const m = new Map<string, Holiday>();
    (grid?.holidays || []).forEach((h) => m.set(h.date, h));
    return m;
  }, [grid]);

  // Weekly availability (part-timers) grouped by user_id → windows per day-of-week
  const availByUserDay = useMemo(() => {
    const m = new Map<string, Map<number, WeeklyAvailability[]>>();
    for (const a of grid?.weeklyAvailability || []) {
      if (!m.has(a.user_id)) m.set(a.user_id, new Map());
      const byDow = m.get(a.user_id)!;
      if (!byDow.has(a.day_of_week)) byDow.set(a.day_of_week, []);
      byDow.get(a.day_of_week)!.push(a);
    }
    return m;
  }, [grid]);

  // Sort users: FT first, PT second. Within each, preserve API order (alpha by name).
  const sortedUsers = useMemo(() => {
    const users = grid?.users ?? [];
    return [...users].sort((a, b) => {
      const aPT = a.profile?.employment_type === "part_time" ? 1 : 0;
      const bPT = b.profile?.employment_type === "part_time" ? 1 : 0;
      return aPT - bPT;
    });
  }, [grid]);

  // Station grouping for easier scheduling: BOH (kitchen) vs FOH (barista /
  // service), with MANAGEMENT in its own section (owner rule 2026-07-18) —
  // manager shifts are presence, not man-hours, so they sit outside the two
  // station groups whose counts must track the item curves.
  const userGroups = useMemo(() => {
    const isBOHPos = (p: string | null | undefined) => {
      const s = (p ?? "").toLowerCase();
      return s.includes("kitchen") || s.includes("chef") || s.includes("boh");
    };
    const isMgmtPos = (p: string | null | undefined) => {
      const s = (p ?? "").trim().toLowerCase();
      return s === "manager" || s === "area manager" || s === "head of department";
    };
    const mgmt = sortedUsers.filter((u) => isMgmtPos(u.profile?.position));
    const rest = sortedUsers.filter((u) => !isMgmtPos(u.profile?.position));
    const boh = rest.filter((u) => isBOHPos(u.profile?.position));
    const foh = rest.filter((u) => !isBOHPos(u.profile?.position));
    return [
      { key: "foh", label: "Front of House · Barista / Service", users: foh },
      { key: "boh", label: "Back of House · Kitchen", users: boh },
      { key: "mgmt", label: "Management · presence, not counted as man-hours", users: mgmt },
    ].filter((g) => g.users.length > 0);
  }, [sortedUsers]);

  // Total net working hours per user for the week (gross - break).
  // Rest-day markers don't count.
  const hoursByUser = useMemo(() => {
    const m = new Map<string, number>();
    const toMin = (s: string) => { const [h, mm] = s.split(":").map(Number); return h * 60 + (mm || 0); };
    for (const sh of grid?.shifts || []) {
      if (sh.notes === "rest_day") continue;
      const gross = toMin(sh.end_time) - toMin(sh.start_time);
      const net = Math.max(0, gross - (sh.break_minutes || 0));
      m.set(sh.user_id, (m.get(sh.user_id) ?? 0) + net / 60);
    }
    return m;
  }, [grid]);

  // Total net working hours per date. Management shifts are EXCLUDED (owner
  // rule 2026-07-18: manager presence is not man-hours) — the header total
  // must match the coverage math, which also ignores them.
  const hoursByDate = useMemo(() => {
    const m = new Map<string, number>();
    const mgmtIds = new Set(
      (grid?.users || [])
        .filter((u) => {
          const p = (u.profile?.position ?? "").trim().toLowerCase();
          return p === "manager" || p === "area manager" || p === "head of department";
        })
        .map((u) => u.id),
    );
    const toMin = (s: string) => { const [h, mm] = s.split(":").map(Number); return h * 60 + (mm || 0); };
    for (const sh of grid?.shifts || []) {
      if (sh.notes === "rest_day" || mgmtIds.has(sh.user_id)) continue;
      const gross = toMin(sh.end_time) - toMin(sh.start_time);
      const net = Math.max(0, gross - (sh.break_minutes || 0));
      m.set(sh.shift_date, (m.get(sh.shift_date) ?? 0) + net / 60);
    }
    return m;
  }, [grid]);

  // Coverage rules grouped by day-of-week
  const coverageByDow = useMemo(() => {
    const m = new Map<number, CoverageRule[]>();
    for (const c of grid?.coverageRules || []) {
      if (!m.has(c.day_of_week)) m.set(c.day_of_week, []);
      m.get(c.day_of_week)!.push(c);
    }
    return m;
  }, [grid]);

  // Convert ISO date → day-of-week (0=Sun..6=Sat)
  const dowFromIso = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay();

  // Is this shift outside the staff's weekly availability?
  const isShiftOutsideAvailability = (shift: Shift): boolean => {
    const dow = dowFromIso(shift.shift_date);
    const windows = availByUserDay.get(shift.user_id)?.get(dow);
    if (!windows || windows.length === 0) return false; // no availability set — no constraint
    // Shift must fit within AT LEAST ONE window
    return !windows.some(
      (w) => shift.start_time >= w.available_from && shift.end_time <= w.available_until,
    );
  };

  // Minimum concurrent staff during the slot — coverage rules require N
  // bodies on the floor at every moment, not N unique people across the day.
  const staffOnDutyForSlot = (dayIso: string, slotStart: string, slotEnd: string): number => {
    const active = (grid?.shifts || []).filter(
      (s) => s.shift_date === dayIso && s.notes !== "rest_day" &&
        s.start_time < slotEnd && s.end_time > slotStart,
    );
    return minConcurrentInSlot(active, slotStart, slotEnd);
  };

  const computeTemplateHours = (templateId: string | null): number => {
    if (!templateId || templateId === "rest_day") return 0;
    const t = (grid?.templates || []).find((x) => x.id === templateId);
    if (!t) return 0;
    const toMin = (s: string) => {
      const [h, m] = s.split(":").map(Number);
      return h * 60 + (m || 0);
    };
    const dur = toMin(t.end_time) - toMin(t.start_time) - (t.break_minutes || 0);
    return dur > 0 ? dur / 60 : 0;
  };

  const setCell = async (userId: string, date: string, templateId: string | null, bypassCheck = false) => {
    if (!selectedOutlet) return;

    // Hours check (weekly 45h cap, multi-outlet aware, user-scoped)
    if (!bypassCheck) {
      const proposedHours = computeTemplateHours(templateId);
      // Subtract hours of existing shift at this cell (if overwriting) so we don't double-count
      const existing = shiftsMap.get(`${userId}:${date}`);
      const existingHours = existing
        ? (() => {
            const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); };
            const dur = toMin(existing.end_time) - toMin(existing.start_time) - (existing.break_minutes || 0);
            return dur > 0 ? dur / 60 : 0;
          })()
        : 0;
      const netAdditional = proposedHours - existingHours;

      if (netAdditional > 0) {
        try {
          const res = await fetch("/api/hr/schedules/hours-check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_id: userId,
              week_start: weekStart,
              additional_hours: netAdditional,
              exclude_shift_id: existing?.id,
            }),
          });
          const check = await res.json();
          if (check.status === "block" || check.status === "overtime" || check.status === "warn") {
            setPendingCheck({
              userId, date, templateId,
              status: check.status,
              message: check.message,
              proposed: check.proposed_total,
              limit: check.limit,
            });
            return; // Hold until user confirms (or aborts if block)
          }
        } catch {
          // If hours-check fails, fall through and save anyway (don't block on infra)
        }
      }
    }

    setSaving(true);
    try {
      const res = await fetch("/api/hr/schedules/cell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outlet_id: selectedOutlet,
          week_start: weekStart,
          user_id: userId,
          shift_date: date,
          template_id: templateId,
        }),
      });
      // Never silently swallow a failed save — that let managers believe a
      // roster was saved when it wasn't. Surface it and keep the picker open.
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Couldn't save this shift: ${err.error || res.status}. Nothing was changed — please try again.`);
        return;
      }
      mutate();
      setDayCov({}); // coverage gaps changed — refetch on next picker open
      setPickerOpen(null);
      setPendingCheck(null);
    } finally {
      setSaving(false);
    }
  };

  // Custom-hours shift (flex scheduling for part-timers)
  const setCellCustom = async (userId: string, date: string, startTime: string, endTime: string, breakMinutes = 0, label = "Custom") => {
    if (!selectedOutlet) return;
    setSaving(true);
    try {
      const res = await fetch("/api/hr/schedules/cell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outlet_id: selectedOutlet,
          week_start: weekStart,
          user_id: userId,
          shift_date: date,
          template_id: "custom",
          custom: {
            start_time: startTime + ":00",
            end_time: endTime + ":00",
            break_minutes: breakMinutes,
            label,
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Couldn't save this shift: ${err.error || res.status}. Nothing was changed — please try again.`);
        return;
      }
      mutate();
      setDayCov({});
      setPickerOpen(null);
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!selectedOutlet || !grid?.schedule) return;
    setPublishing(true);
    try {
      const action = grid.schedule.status === "published" ? "unpublish" : "publish";
      const publishOnce = (extra: Record<string, string>) =>
        fetch("/api/hr/schedules/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outlet_id: selectedOutlet, week_start: weekStart, action, ...extra }),
        });

      let res = await publishOnce({});
      if (action === "publish" && !res.ok) {
        // The labour gate pushed back — amber needs a reason, red needs an
        // owner override; blockers just get reported.
        const data = await res.json().catch(() => ({}) as { error?: string; gate?: LabourGateInfo });
        if (data.gate) setGate(data.gate);
        const verdict = data.gate?.verdict;
        if (res.status === 422 && (verdict === "amber" || verdict === "unknown")) {
          const reason = prompt(`${data.error}\n\nReason for publishing over target:`);
          if (!reason) return;
          res = await publishOnce({ reason });
        } else if (verdict === "red") {
          const override = prompt(`${data.error}\n\nOverride reason:`);
          if (!override) return;
          res = await publishOnce({ override_reason: override });
        }
        if (!res.ok) {
          const err = await res.json().catch(() => ({}) as { error?: string });
          alert(err.error || `Publish failed (${res.status})`);
          return;
        }
      }
      const ok = await res.json().catch(() => null);
      if (ok?.gate) setGate(ok.gate);
      mutate();
    } finally {
      setPublishing(false);
    }
  };

  const handleClearAll = async () => {
    if (!selectedOutlet || !grid?.schedule) return;
    if (!confirm("Clear all shifts for this week? (will not affect published schedules)")) return;
    setClearing(true);
    try {
      const res = await fetch("/api/hr/schedules/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outlet_id: selectedOutlet, week_start: weekStart }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || "Failed to clear");
      mutate();
    } finally {
      setClearing(false);
    }
  };

  const handleAIFill = async () => {
    if (!selectedOutlet) return;
    setGenerating(true);
    try {
      await fetch("/api/hr/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", outlet_id: selectedOutlet, week_start: weekStart, mode: fillMode }),
      });
      mutate();
    } finally {
      setGenerating(false);
    }
  };

  const handleSwap = async (swapId: string, action: "approve" | "reject") => {
    setSwapAction(swapId);
    try {
      await fetch("/api/hr/swap", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ swap_id: swapId, action }),
      });
      mutateSwaps();
      mutate();
    } finally {
      setSwapAction(null);
    }
  };

  const isPublished = grid?.schedule?.status === "published";

  // Compute totals
  const totalHours = (grid?.shifts || []).reduce((sum, s) => {
    if (s.notes === "rest_day") return sum;
    const [sh, sm] = s.start_time.split(":").map(Number);
    const [eh, em] = s.end_time.split(":").map(Number);
    const mins = (eh * 60 + em) - (sh * 60 + sm);
    const workingMins = mins - (s.break_minutes || 0);
    return sum + workingMins / 60;
  }, 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 sm:p-6 lg:p-8">
      <HrPageHeader
        title="Schedules"
        description="Click a cell to assign a shift"
        action={
          <>
            <button
              onClick={handleClearAll}
              disabled={clearing || !grid?.schedule || isPublished}
              className="flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              title={isPublished ? "Unpublish first to clear" : "Clear all shifts for this week"}
            >
              {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Clear Week
            </button>
            <div className="flex items-center rounded-lg border">
              <select
                value={fillMode}
                onChange={(e) => setFillMode(e.target.value as "tight" | "mid" | "safe")}
                disabled={generating || isPublished}
                className="rounded-l-lg border-r bg-background px-2 py-2 text-sm font-medium disabled:opacity-50"
                title="Coverage buffer: Tight = exactly to demand; Mid = +1 at the peak block; Safe = +1 all day (break/no-show cover)"
              >
                <option value="tight">Tight</option>
                <option value="mid">Mid</option>
                <option value="safe">Safe</option>
              </select>
              <button
                onClick={handleAIFill}
                disabled={generating || !selectedOutlet || isPublished}
                className="flex items-center gap-2 rounded-r-lg px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                AI Fill
              </button>
            </div>
            <button
              onClick={handlePublish}
              disabled={publishing || !grid?.schedule}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                isPublished ? "bg-red-500 hover:bg-red-600" : "bg-green-600 hover:bg-green-700"
              }`}
            >
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : isPublished ? <RotateCcw className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              {isPublished ? "Unpublish" : "Publish"}
            </button>
          </>
        }
      />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
        <select
          value={selectedOutlet}
          onChange={(e) => setSelectedOutlet(e.target.value)}
          className="rounded-lg border bg-background px-3 py-2 text-sm"
        >
          <option value="">Select outlet...</option>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setWeekStart(addWeeks(weekStart, -1))}
            className="rounded-lg border p-2 hover:bg-muted"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            type="date"
            value={weekStart}
            onChange={(e) => setWeekStart(e.target.value)}
            className="rounded-lg border bg-background px-3 py-2 text-sm"
          />
          <button
            onClick={() => setWeekStart(addWeeks(weekStart, 1))}
            className="rounded-lg border p-2 hover:bg-muted"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="text-sm text-muted-foreground">
          Week of <strong>{weekStart}</strong> → {grid?.week_end || "..."}
        </div>

        <div className="flex overflow-hidden rounded-lg border text-sm">
          {(["week", "day"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 font-medium capitalize ${view === v ? "bg-terracotta text-white" : "hover:bg-muted"}`}
            >
              {v}
            </button>
          ))}
        </div>

        {gate && (
          <div
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium ${
              gate.verdict === "green"
                ? "border-green-300 bg-green-50 text-green-700"
                : gate.verdict === "amber" || gate.verdict === "unknown"
                  ? "border-amber-300 bg-amber-50 text-amber-700"
                  : "border-red-300 bg-red-50 text-red-700"
            }`}
            title={[
              `Roster RM${gate.rosterCost.toLocaleString()} vs forecast RM${gate.forecastRevenue.toLocaleString()}`,
              gate.forecastRevenue > 0
                ? `  • FT RM${gate.ftFixedCost.toLocaleString()} (fixed; rotated FT split by hours worked here, manager/rover cost = HQ) = ${((gate.ftFixedCost / gate.forecastRevenue) * 100).toFixed(1)}%`
                : `  • FT RM${gate.ftFixedCost.toLocaleString()} (fixed; rotated FT split by hours, manager/rover = HQ)`,
              gate.forecastRevenue > 0
                ? `  • PT RM${gate.ptCost.toLocaleString()} (discretionary) = ${((gate.ptCost / gate.forecastRevenue) * 100).toFixed(1)}%`
                : `  • PT RM${gate.ptCost.toLocaleString()} (discretionary)`,
              `Only PT + revenue move the %; benching FT is fixed cost, so it saves nothing.`,
              `Budget ${(gate.targetPct * 100).toFixed(0)}% target / ${(gate.ceilingPct * 100).toFixed(0)}% ceiling`,
              ...gate.blockers,
              ...gate.warnings,
            ].join("\n")}
          >
            Labour{" "}
            {gate.pct == null ? "—" : `${(gate.pct * 100).toFixed(1)}%`}
            <span className="font-normal opacity-70">
              / {(gate.targetPct * 100).toFixed(0)}%
            </span>
            {(gate.blockers.length > 0 || gate.warnings.length > 0) && (
              <span className="font-normal">⚠ {gate.blockers.length + gate.warnings.length}</span>
            )}
          </div>
        )}

        {(() => {
          const ptSuggestions = (grid?.shifts || []).filter((s) => s.notes === "pt_suggestion").length;
          return ptSuggestions > 0 ? (
            <div className="flex items-center gap-1 rounded-lg border border-dashed border-amber-400 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700">
              {ptSuggestions} PT suggestion{ptSuggestions > 1 ? "s" : ""} to confirm
            </div>
          ) : null;
        })()}

        {selectedOutlet && grid?.schedule && openSlots.length === 0 && !postSlotForm && (
          <button
            onClick={() => setPostSlotForm({ date: grid?.days?.[0] ?? weekStart, templateId: grid?.templates?.[0]?.id ?? "", station: "barista" })}
            className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-100"
            title="Post an extra shift for part-timers to book in the staff apps"
          >
            + Open slot
          </button>
        )}

        {gate?.coverage && gate.coverage.some((c) => c.neededHours > 0) && (
          <div className="flex items-center gap-1" title="Sales-derived coverage: staff-hours rostered vs needed per day">
            {gate.coverage.map((c) => {
              const day = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][new Date(c.date + "T00:00:00Z").getUTCDay()];
              const ok = c.shortHours === 0;
              return (
                <span
                  key={c.date}
                  className={`rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                    c.neededHours === 0
                      ? "bg-muted text-muted-foreground"
                      : ok
                        ? "bg-green-50 text-green-700 border border-green-200"
                        : "bg-amber-50 text-amber-700 border border-amber-300"
                  }`}
                  title={`${c.date}: ${c.scheduledHours}/${c.neededHours} staff-hours covered${ok ? "" : ` — ${c.shortHours}h short`}`}
                >
                  {day}
                  {ok ? "✓" : `−${c.shortHours}`}
                </span>
              );
            })}
          </div>
        )}

        <div className="ml-auto text-sm">
          <span className="text-muted-foreground">Total labor: </span>
          <span className="font-semibold">{totalHours.toFixed(1)}h</span>
          {grid?.schedule && (
            <span className={`ml-3 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              isPublished ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
            }`}>
              {grid.schedule.status.toUpperCase()}
            </span>
          )}
        </div>
      </div>

      {/* Open slots — bookable in the staff apps, managed here */}
      {selectedOutlet && (openSlots.length > 0 || postSlotForm) && (() => {
        const openCount = openSlots.filter((s) => s.status === "open").length;
        const bookedCount = openSlots.filter((s) => s.status === "claimed").length;
        const todayMyt = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
        const mm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
        const slotsByDay = new Map<string, typeof openSlots>();
        for (const s of openSlots) {
          if (!slotsByDay.has(s.shift_date)) slotsByDay.set(s.shift_date, []);
          slotsByDay.get(s.shift_date)!.push(s);
        }
        const dayList = (grid?.days ?? []).filter((d) => slotsByDay.has(d));
        return (
        <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-semibold text-sky-900">
              Open slots
              <span className="ml-2 text-sm font-normal text-sky-700">
                {openCount} waiting for a booking{bookedCount > 0 ? ` · ${bookedCount} booked` : ""}
              </span>
            </h2>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => mutateOpenSlots()}
                className="rounded-lg border border-sky-200 bg-white p-1.5 text-sky-600 hover:bg-sky-100"
                title="Refresh — bookings from the staff apps appear here"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              {!postSlotForm && (
                <button
                  onClick={() => setPostSlotForm({ date: grid?.days?.[0] ?? weekStart, templateId: grid?.templates?.[0]?.id ?? "", station: "barista" })}
                  className="flex items-center gap-1 rounded-lg border border-sky-300 bg-white px-2.5 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-100"
                >
                  <Plus className="h-3.5 w-3.5" /> Post slot
                </button>
              )}
            </div>
          </div>

          {dayList.length > 0 && (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {dayList.map((d) => {
                const daySlots = slotsByDay.get(d)!;
                const isPast = d < todayMyt;
                return (
                  <div key={d} className={`rounded-lg border border-sky-100 bg-white p-2.5 ${isPast ? "opacity-60" : ""}`}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-700">
                        {new Date(d + "T00:00:00Z").toLocaleDateString("en-MY", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" })}
                        {isPast && <span className="ml-1.5 text-[10px] font-medium uppercase text-gray-400">past</span>}
                      </span>
                      {!isPast && (
                        <button
                          onClick={() => setPostSlotForm({ date: d, templateId: grid?.templates?.[0]?.id ?? "", station: "barista" })}
                          className="rounded p-1 text-sky-500 hover:bg-sky-50"
                          title={`Post another slot on this day`}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {daySlots.map((s) => {
                        const claimed = s.status === "claimed";
                        const h = Math.round(((mm(s.end_time) - mm(s.start_time)) / 60) * 10) / 10;
                        return (
                          <div
                            key={s.id}
                            className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 ${
                              claimed ? "border-green-200 bg-green-50" : "border-gray-150 bg-white"
                            }`}
                          >
                            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${s.station === "kitchen" ? "bg-amber-50 text-amber-600" : "bg-sky-50 text-sky-600"}`}>
                              {s.station === "kitchen" ? <ChefHat className="h-4 w-4" /> : <Coffee className="h-4 w-4" />}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold text-gray-800">
                                {s.start_time}–{s.end_time}
                                <span className="ml-1 font-normal text-gray-400">({h}h)</span>
                              </div>
                              <div className="truncate text-[11px] text-muted-foreground">
                                {s.station === "kitchen" ? "Kitchen" : "Barista"}
                                {s.role_type ? ` · ${s.role_type}` : ""}
                                <span className={`ml-1.5 rounded px-1 py-px text-[9px] font-semibold uppercase ${s.source === "manual" ? "bg-violet-50 text-violet-600" : "bg-sky-50 text-sky-600"}`}>
                                  {s.source === "manual" ? "manual" : s.source === "generator" ? "AI" : s.source}
                                </span>
                              </div>
                            </div>
                            {claimed ? (
                              <span className="shrink-0 text-xs font-semibold text-green-700" title={`Booked${s.claimed_at ? ` at ${new Date(s.claimed_at).toLocaleString("en-MY", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}` : ""} — already a real shift on the grid`}>
                                ✓ {s.claimed_by_name}
                              </span>
                            ) : (
                              <button
                                onClick={() => cancelOpenSlot(s.id)}
                                disabled={slotBusy === s.id}
                                className="shrink-0 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                                title="Take this slot down — staff can no longer book it"
                              >
                                {slotBusy === s.id ? "…" : "Cancel"}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Post form — all taps, no dropdowns */}
          {postSlotForm && grid && (
            <div className="mt-3 space-y-2.5 rounded-lg border border-sky-200 bg-white p-3">
              <div className="text-sm font-semibold text-gray-700">Post a slot for part-timers to book</div>
              <div className="flex flex-wrap gap-1.5">
                {(grid.days || []).map((d) => {
                  const active = postSlotForm.date === d;
                  const past = d < todayMyt;
                  return (
                    <button
                      key={d}
                      onClick={() => !past && setPostSlotForm({ ...postSlotForm, date: d })}
                      disabled={past}
                      className={`rounded-lg px-2.5 py-1.5 text-sm font-medium ${
                        active ? "bg-sky-600 text-white" : past ? "bg-gray-50 text-gray-300" : "bg-gray-50 text-gray-600 hover:bg-sky-50"
                      }`}
                    >
                      {new Date(d + "T00:00:00Z").toLocaleDateString("en-MY", { weekday: "short", day: "numeric", timeZone: "UTC" })}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(grid.templates || []).map((t) => {
                  const active = postSlotForm.templateId === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setPostSlotForm({ ...postSlotForm, templateId: t.id })}
                      className={`rounded-lg px-2.5 py-1.5 text-sm font-medium ${active ? "bg-sky-600 text-white" : "bg-gray-50 text-gray-600 hover:bg-sky-50"}`}
                    >
                      {t.label} {t.start_time}–{t.end_time}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex overflow-hidden rounded-lg border border-gray-200">
                  {(["barista", "kitchen"] as const).map((st) => (
                    <button
                      key={st}
                      onClick={() => setPostSlotForm({ ...postSlotForm, station: st })}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium ${
                        postSlotForm.station === st ? "bg-sky-600 text-white" : "bg-white text-gray-600 hover:bg-sky-50"
                      }`}
                    >
                      {st === "kitchen" ? <ChefHat className="h-3.5 w-3.5" /> : <Coffee className="h-3.5 w-3.5" />}
                      {st === "kitchen" ? "Kitchen" : "Barista"}
                    </button>
                  ))}
                </div>
                <div className="ml-auto flex gap-1.5">
                  <button onClick={() => setPostSlotForm(null)} className="rounded-lg border px-3 py-1.5 text-sm text-muted-foreground">
                    Close
                  </button>
                  <button
                    onClick={postOpenSlot}
                    disabled={slotBusy === "post" || !postSlotForm.templateId || postSlotForm.date < todayMyt}
                    className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                  >
                    {slotBusy === "post" ? "Posting…" : "Post slot"}
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Goes live in the staff apps immediately — first part-timer to book gets it (station-fit and weekly caps enforced).
              </p>
            </div>
          )}
        </div>
        );
      })()}

      {/* Pending Swap Approvals */}
      {pendingSwaps.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold text-amber-800">
            <ArrowLeftRight className="h-4 w-4" />
            {pendingSwaps.length} shift swap{pendingSwaps.length !== 1 ? "s" : ""} waiting for approval
          </h2>
          <div className="space-y-2">
            {pendingSwaps.map((swap) => (
              <div key={swap.id} className="flex items-center justify-between rounded-lg bg-white p-2 text-sm">
                <span>
                  {swap.requester_id.slice(0, 8)}... ↔ {swap.target_id.slice(0, 8)}...{" "}
                  <span className="text-muted-foreground">
                    ({swap.requester_shift?.shift_date} ↔ {swap.target_shift?.shift_date})
                  </span>
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleSwap(swap.id, "approve")}
                    disabled={swapAction === swap.id}
                    className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleSwap(swap.id, "reject")}
                    disabled={swapAction === swap.id}
                    className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Grid */}
      {grid && grid.users.length > 0 && view === "day" ? (
        <DayView grid={grid} dayIdx={dayIdx} setDayIdx={setDayIdx} gate={gate} />
      ) : grid && grid.users.length > 0 ? (
        <div className="flex-1 min-h-0 overflow-auto rounded-xl border bg-card shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="sticky top-0 z-20">
              <tr className="border-b bg-muted/50">
                <th className="sticky left-0 z-30 bg-muted/50 p-2 text-left font-medium min-w-[180px]">
                  Employee
                </th>
                {grid.days.map((d, i) => {
                  const hol = holidayMap.get(d);
                  const dayHours = hoursByDate.get(d) ?? 0;
                  const dayLabel = dayHours === 0 ? "—" : dayHours % 1 === 0 ? `${dayHours}h` : `${dayHours.toFixed(1)}h`;
                  return (
                    <th key={d} className={`relative p-2 text-center font-medium min-w-[120px] ${hol ? "bg-red-50" : "bg-muted/50"}`}>
                      <div className="text-xs text-muted-foreground">{DAY_NAMES[i]}</div>
                      <div className="text-base">{formatDay(d)}</div>
                      {hol && <div className="text-[9px] text-red-600 truncate" title={hol.name}>PH: {hol.name}</div>}
                      <div className="mt-1 text-[10px] font-semibold tabular-nums text-gray-600">{dayLabel} total</div>
                      {(() => {
                        // Open-slot badge: this day still has bookable slots out
                        // in the staff apps — the manager sees it at the column,
                        // not just in the panel above.
                        const os = openSlots.filter((s) => s.shift_date === d && s.status === "open").length;
                        if (!os) return null;
                        return (
                          <div className="mt-0.5">
                            <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-semibold text-sky-700" title={`${os} open slot${os > 1 ? "s" : ""} waiting for a part-timer to book (see Open slots panel above)`}>
                              {os} open slot{os > 1 ? "s" : ""}
                            </span>
                          </div>
                        );
                      })()}
                      {(() => {
                        // Composition line: where the total comes from. Click → Why panel.
                        const c = dayComposition.get(d);
                        if (!c) return null;
                        const parts = [
                          c.ftH > 0 ? `FT${fmtH(c.ftH)}` : null,
                          c.roverH > 0 ? `RV${fmtH(c.roverH)}` : null,
                          c.ptH > 0 ? `PT${fmtH(c.ptH)}` : null,
                        ].filter(Boolean);
                        if (parts.length === 0 && c.mgrH === 0) return null;
                        return (
                          <button
                            onClick={() => setWhyDate(whyDate === d ? null : d)}
                            className="text-[9px] tabular-nums text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
                            title="Why is this day staffed this way? Click for the breakdown. MGR hours are cover — not counted in the total."
                          >
                            {parts.join("+")}
                            {c.mgrH > 0 ? `${parts.length ? " · " : ""}MGR${fmtH(c.mgrH)} cover` : ""}
                          </button>
                        );
                      })()}
                      {whyDate === d && (() => {
                        const c = dayComposition.get(d);
                        const cov = gate?.coverage?.find((x) => x.date === d);
                        const ranked = [...(gate?.coverage ?? [])]
                          .filter((x) => (x.items ?? 0) > 0)
                          .sort((a, b) => (b.items ?? 0) - (a.items ?? 0));
                        const rank = ranked.findIndex((x) => x.date === d) + 1;
                        // Edge columns hug their edge — a centered popover on
                        // Sat/Sun (or Mon) hangs past the scroll container and
                        // gets clipped (owner screenshot 2026-07-19).
                        const align = i >= 5 ? "right-0" : i <= 1 ? "left-0" : "left-1/2 -translate-x-1/2";
                        return (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setWhyDate(null)} />
                            <div className={`absolute z-50 mt-1 w-72 ${align} rounded-lg border bg-white p-3 text-left text-[11px] font-normal shadow-lg`}>
                              <div className="mb-1.5 font-semibold">Why this staffing?</div>
                              <ul className="space-y-1 text-muted-foreground">
                                {cov?.items ? (
                                  <li>
                                    📈 {cov.items} items{rank > 0 ? ` — #${rank} busiest day` : ""}
                                    {cov.barItems != null && cov.kitItems != null ? ` (FOH ${cov.barItems} · BOH ${cov.kitItems})` : ""}
                                  </li>
                                ) : null}
                                <li>
                                  👥 {c?.ftCount ?? 0} FT working
                                  {c?.resting.length ? ` · resting: ${c.resting.join(", ")}` : " · nobody resting"}
                                </li>
                                {c?.rovers.length ? <li>🔄 Rover {c.rovers.join(", ")} (+{fmtH(c.roverH)}h — fixed 2-day rotation)</li> : null}
                                {c?.mgrs.length ? <li>👔 Manager {c.mgrs.join(", ")} ({fmtH(c.mgrH)}h cover — not counted as man-hours)</li> : null}
                                {c?.pts.length ? (
                                  <li>
                                    🧩 PT {c.pts.map((p) => p.name + (p.suggested ? "?" : "")).join(", ")} (+{fmtH(c.ptH)}h
                                    {c.ptSuggestedH > 0 ? `, ${fmtH(c.ptSuggestedH)}h awaiting confirm` : ""})
                                  </li>
                                ) : null}
                                {cov && cov.shortHours > 0 ? (
                                  <li className="font-medium text-red-600">⚠ Short {cov.shortHours}h vs demand — fill via ✨ Assist or + Add</li>
                                ) : (
                                  <li className="text-green-600">✓ Demand covered</li>
                                )}
                                <li className="pt-1 text-[10px] leading-snug">
                                  Rests sit on quiet days (FT is sunk — everyone works 6 days); the rover rotates 2 fixed days; PT patches the item-holes the rests leave, within the RM envelope. Daily hours track items only at the margin — shifts move in 7.5h blocks.
                                </li>
                              </ul>
                            </div>
                          </>
                        );
                      })()}
                      {(() => {
                        const g = gate;
                        const cov = g?.coverage?.find((c) => c.date === d);
                        if (!g || !cov || cov.forecast == null) return null;
                        const fc = cov.forecast;
                        const rm = fc >= 1000 ? `RM${(fc / 1000).toFixed(1)}k` : `RM${fc}`;
                        const pctColor =
                          cov.pct == null ? "text-gray-400"
                            : cov.pct <= g.targetPct ? "text-green-600"
                              : cov.pct <= g.ceilingPct ? "text-amber-600"
                                : "text-red-600";
                        return (
                          <div
                            className={`text-[9px] font-medium tabular-nums ${pctColor}`}
                            title={`Forecast ${rm}${cov.isWeekend ? " · weekend" : " · weekday"}${cov.isHoliday ? ` · ${cov.holidayName ?? "public holiday"}` : ""} — daily labour %: this day's share of the week's actual roster cost (pro-rata by hours) ÷ this day's forecast. Day costs sum to the weekly total, so these average back to the Labour chip.`}
                          >
                            {rm}{cov.pct == null ? "" : ` · ${(cov.pct * 100).toFixed(0)}%`}
                            {cov.items != null && cov.items > 0 && (
                              cov.barItems != null && cov.kitItems != null && cov.barItems + cov.kitItems > 0 ? (
                                <span title={`${cov.barItems} FOH items (drinks/pastry) + ${cov.kitItems} BOH items (kitchen), 28-day avg for this weekday incl. pickup app`}>
                                  {" · "}F{cov.barItems}·B{cov.kitItems}it
                                </span>
                              ) : (
                                ` · ${cov.items}it`
                              )
                            )}
                          </div>
                        );
                      })()}
                      {(() => {
                        // Insufficient man-hours vs THE demand model (items ×
                        // serve-calibrated rates) — the exact hours PT should
                        // fill. Same model AI Fill staffs to.
                        const cov = gate?.coverage?.find((c) => c.date === d);
                        if (!cov || cov.shortHours <= 0) return null;
                        return (
                          <div
                            className="mt-0.5 inline-block rounded bg-red-100 px-1 py-0.5 text-[9px] font-bold tabular-nums text-red-700"
                            title={`${cov.scheduledHours}/${cov.neededHours} demand man-hours covered — short ${cov.shortHours}h. Fill with PT via ✨ Assist (same demand model as AI Fill: items ÷ serve-calibrated station rates).`}
                          >
                            short {cov.shortHours}h
                          </div>
                        );
                      })()}
                      {!isPublished && (
                        <button
                          onClick={() => setAssistDate(d)}
                          className="mt-1 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="Assist: rank who fits best for this day's gaps (reliability · availability · fairness · cost)"
                        >
                          <Sparkles className="h-2.5 w-2.5" /> Assist
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {userGroups.map((g) => (
                <Fragment key={g.key}>
                  <tr className="border-b bg-muted/60">
                    <td className="sticky left-0 z-10 bg-muted/60 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {g.label} ({g.users.length})
                    </td>
                    <td colSpan={grid.days.length} className="bg-muted/60" />
                  </tr>
                  {g.users.map((u) => {
                const position = u.profile?.position || (u.role === "MANAGER" ? "Manager" : "Barista");
                const isPartTime = u.profile?.employment_type === "part_time";
                const empType = isPartTime ? "PT" : "FT";
                const weeklyHours = hoursByUser.get(u.id) ?? 0;
                // MY Employment Act cap = 45h/week (FT); PT typically ≤24h
                const ftCap = 45;
                const ptCap = 24;
                const cap = isPartTime ? ptCap : ftCap;
                const overCap = weeklyHours > cap;
                return (
                  <tr key={u.id} className="border-b hover:bg-muted/30">
                    <td className="sticky left-0 z-10 bg-background p-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium">{u.fullName || u.name}</div>
                        {weeklyHours > 0 && (
                          <span
                            title={`${weeklyHours.toFixed(1)}h this week · cap ${cap}h${overCap ? " (OVER)" : ""}`}
                            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                              overCap
                                ? "bg-red-100 text-red-700"
                                : weeklyHours >= cap * 0.9
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-emerald-100 text-emerald-800"
                            }`}
                          >
                            ({weeklyHours % 1 === 0 ? weeklyHours : weeklyHours.toFixed(1)}h)
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {position} · {empType}
                      </div>
                    </td>
                    {grid.days.map((d) => {
                      const key = `${u.id}:${d}`;
                      const shift = shiftsMap.get(key);
                      const leave = leavesMap.get(key);
                      const blockout = blockoutMap.get(key);
                      const isPicking = pickerOpen?.userId === u.id && pickerOpen?.date === d;

                      return (
                        <td key={d} className="relative p-1 align-top">
                          {leave ? (
                            <div className="rounded-lg bg-purple-50 border border-purple-300 p-2 text-center">
                              <div className="text-[10px] font-bold uppercase text-purple-700">On Leave</div>
                              <div className="text-[10px] text-purple-600">{leave.leave_type}</div>
                            </div>
                          ) : blockout ? (
                            <div className="rounded-lg bg-red-50 border border-red-300 p-2 text-center">
                              <div className="text-[10px] font-bold uppercase text-red-700">Blocked</div>
                              {blockout.reason && <div className="text-[9px] text-red-600 truncate" title={blockout.reason}>{blockout.reason}</div>}
                            </div>
                          ) : shift && shift.notes === "rest_day" ? (
                            <button
                              onClick={(e) => openPicker(u.id, d, e)}
                              className="w-full rounded-lg bg-red-100 border border-red-300 p-2 text-center hover:bg-red-200 disabled:cursor-default"
                              disabled={isPublished}
                            >
                              <div className="text-[10px] font-bold uppercase text-red-700">Rest Day</div>
                            </button>
                          ) : shift ? (
                            (() => {
                              const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); };
                              const gross = toMin(shift.end_time) - toMin(shift.start_time);
                              const net = Math.max(0, gross - (shift.break_minutes || 0));
                              const netH = net / 60;
                              const hoursLabel = netH % 1 === 0 ? `${netH}h` : `${netH.toFixed(1)}h`;
                              const isPtSuggestion = shift.notes === "pt_suggestion";
                              return (
                                <button
                                  onClick={(e) => openPicker(u.id, d, e)}
                                  className={`w-full rounded-lg border p-2 text-left ${
                                    isPtSuggestion
                                      ? "border-dashed border-amber-400 bg-amber-50"
                                      : COLOR_MAP[guessColor(shift)] || COLOR_MAP.gray
                                  } disabled:cursor-default`}
                                  disabled={isPublished}
                                  title={isPtSuggestion ? "AI-suggested part-timer shift — click to confirm or change" : undefined}
                                >
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="text-[10px] font-bold truncate">
                                      {isPtSuggestion ? "PT? " : ""}
                                      {shift.role_type || "Shift"}
                                    </span>
                                    <span className="shrink-0 rounded bg-white/60 px-1 text-[9px] font-semibold tabular-nums">{hoursLabel}</span>
                                  </div>
                                  <div className="text-[10px]">
                                    {shift.start_time.slice(0, 5)} - {shift.end_time.slice(0, 5)}
                                  </div>
                                </button>
                              );
                            })()
                          ) : elsewhereMap.get(`${u.id}|${d}`) ? (
                            (() => {
                              const ew = elsewhereMap.get(`${u.id}|${d}`)!;
                              return (
                                <div
                                  className="w-full rounded-lg border border-violet-200 bg-violet-50/70 p-2 text-center"
                                  title={`Scheduled at ${ew.outlet_name} ${ew.start_time}–${ew.end_time}${ew.suggested ? " (AI suggestion, unconfirmed)" : ""} — one outlet per day. Remove it there first to schedule here.`}
                                >
                                  <div className="text-[10px] font-semibold text-violet-700">@ {ew.outlet_name}{ew.suggested ? "?" : ""}</div>
                                  <div className="text-[10px] tabular-nums text-violet-600">{ew.start_time} – {ew.end_time}</div>
                                </div>
                              );
                            })()
                          ) : (
                            <button
                              onClick={(e) => openPicker(u.id, d, e)}
                              className="w-full rounded-lg border border-dashed border-gray-300 p-2 text-center text-xs text-gray-400 hover:bg-gray-50 disabled:cursor-default"
                              disabled={isPublished}
                            >
                              + Add
                            </button>
                          )}

                          {/* Picker popup */}
                          {isPicking && (
                            <>
                              <div
                                className="fixed inset-0 z-40"
                                onClick={() => setPickerOpen(null)}
                              />
                              <div
                                className="fixed z-50 w-56 rounded-lg border bg-white p-1 shadow-lg max-h-[70vh] overflow-y-auto"
                                style={{ top: pickerOpen!.top, left: pickerOpen!.left }}
                              >
                                {/* Demand suggestion — the windows this day is short on
                                    for THIS person's station (same model as AI Fill /
                                    Assist), so "+ Add" leads with what the day needs. */}
                                {(() => {
                                  const pos = (u.profile?.position ?? "").trim().toLowerCase();
                                  const isBohUser = pos.includes("kitchen") || pos.includes("chef") || pos.includes("boh");
                                  // Managers can be offered ANY short window as
                                  // COVER — their shift won't count as man-hours,
                                  // so the gap stays visible until line staff fill it.
                                  const isMgmtUser = pos === "manager" || pos === "area manager" || pos === "head of department";
                                  const gaps = (dayCov[d] || []).filter(
                                    (c) =>
                                      c.template_id &&
                                      (isMgmtUser
                                        ? (c.kitchen_gap ?? 0) > 0 || (c.barista_gap ?? 0) > 0
                                        : isBohUser
                                          ? (c.kitchen_gap ?? 0) > 0
                                          : (c.barista_gap ?? 0) > 0),
                                  );
                                  if (gaps.length === 0) return null;
                                  return (
                                    <>
                                      <div className="px-3 pb-0.5 pt-1.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700">
                                        {isMgmtUser
                                          ? "✨ Cover a short window (not man-hours)"
                                          : `✨ Suggested — ${isBohUser ? "kitchen" : "barista"} short`}
                                      </div>
                                      {gaps.map((c) => (
                                        <button
                                          key={c.template_id}
                                          onClick={() => setCell(u.id, d, c.template_id!)}
                                          disabled={saving}
                                          className="w-full rounded bg-amber-50 px-3 py-2 text-left text-xs hover:bg-amber-100"
                                        >
                                          <div className="flex items-center justify-between gap-1">
                                            <span className="font-medium">{c.label || "Shift"}</span>
                                            <span className="shrink-0 rounded bg-red-100 px-1 text-[9px] font-bold tabular-nums text-red-700">
                                              short{" "}
                                              {isMgmtUser
                                                ? (c.kitchen_gap ?? 0) + (c.barista_gap ?? 0)
                                                : isBohUser
                                                  ? c.kitchen_gap
                                                  : c.barista_gap}
                                            </span>
                                          </div>
                                          <div className="text-[10px] text-muted-foreground tabular-nums">
                                            {c.slot_start} - {c.slot_end} · {c.concurrent}/{c.min_staff} staffed
                                          </div>
                                        </button>
                                      ))}
                                      <div className="my-1 border-t" />
                                    </>
                                  );
                                })()}
                                <button
                                  onClick={() => setCell(u.id, d, "rest_day")}
                                  disabled={saving}
                                  className="w-full rounded px-3 py-2 text-left text-xs hover:bg-gray-100"
                                >
                                  <span className="font-medium">Rest Day</span>
                                </button>
                                <div className="my-1 border-t" />
                                {grid.templates.map((t) => (
                                  <button
                                    key={t.id}
                                    onClick={() => setCell(u.id, d, t.id)}
                                    disabled={saving}
                                    className="w-full rounded px-3 py-2 text-left text-xs hover:bg-gray-100"
                                  >
                                    <div className="font-medium">{t.label}</div>
                                    <div className="text-[10px] text-muted-foreground">
                                      {t.start_time} - {t.end_time}
                                    </div>
                                  </button>
                                ))}

                                {/* Custom hours — flex scheduling for part-timers */}
                                <div className="my-1 border-t" />
                                {!customForm ? (
                                  <button
                                    onClick={() => {
                                      // Default to part-timer's availability window for this day if set
                                      const dow = dowFromIso(d);
                                      const windows = isPartTime ? availByUserDay.get(u.id)?.get(dow) : null;
                                      if (windows && windows.length > 0) {
                                        setCustomForm({
                                          start: windows[0].available_from.slice(0, 5),
                                          end: windows[0].available_until.slice(0, 5),
                                          breakMinutes: 0,
                                        });
                                      } else {
                                        setCustomForm({ start: "09:00", end: "17:00", breakMinutes: 0 });
                                      }
                                    }}
                                    disabled={saving}
                                    className="w-full rounded px-3 py-2 text-left text-xs text-blue-700 hover:bg-blue-50"
                                  >
                                    <div className="font-medium">+ Custom hours…</div>
                                    <div className="text-[10px] text-blue-400">Flexible start / end</div>
                                  </button>
                                ) : (
                                  <div className="space-y-1.5 px-2 py-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Custom Shift</p>
                                    <div className="grid grid-cols-2 gap-1.5">
                                      <label className="block">
                                        <span className="block text-[9px] text-gray-500">From</span>
                                        <input
                                          type="time"
                                          value={customForm.start}
                                          onChange={(e) => setCustomForm({ ...customForm, start: e.target.value })}
                                          className="w-full rounded border px-1.5 py-1 text-xs"
                                        />
                                      </label>
                                      <label className="block">
                                        <span className="block text-[9px] text-gray-500">Until</span>
                                        <input
                                          type="time"
                                          value={customForm.end}
                                          onChange={(e) => setCustomForm({ ...customForm, end: e.target.value })}
                                          className="w-full rounded border px-1.5 py-1 text-xs"
                                        />
                                      </label>
                                    </div>
                                    <label className="block">
                                      <span className="block text-[9px] text-gray-500">Break (min)</span>
                                      <input
                                        type="number"
                                        min="0"
                                        value={customForm.breakMinutes}
                                        onChange={(e) => setCustomForm({ ...customForm, breakMinutes: Number(e.target.value) || 0 })}
                                        className="w-full rounded border px-1.5 py-1 text-xs"
                                      />
                                    </label>
                                    <div className="flex gap-1 pt-1">
                                      <button
                                        onClick={() => setCustomForm(null)}
                                        disabled={saving}
                                        className="flex-1 rounded border px-2 py-1 text-[11px] hover:bg-gray-50"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        onClick={() => {
                                          if (customForm.start >= customForm.end) return;
                                          setCellCustom(u.id, d, customForm.start, customForm.end, customForm.breakMinutes);
                                          setCustomForm(null);
                                        }}
                                        disabled={saving || customForm.start >= customForm.end}
                                        className="flex-1 rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                      >
                                        Save
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {shift && (
                                  <>
                                    <div className="my-1 border-t" />
                                    <button
                                      onClick={() => setCell(u.id, d, null)}
                                      disabled={saving}
                                      className="w-full rounded px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50"
                                    >
                                      Clear
                                    </button>
                                  </>
                                )}
                              </div>
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
                </Fragment>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-200">
              {/* Coverage gap footer — for each day shows how each coverage rule is satisfied */}
              {grid.coverageRules && grid.coverageRules.length > 0 && (
                <tr className="bg-amber-50/30">
                  <td className="sticky left-0 z-10 bg-amber-50/30 p-2 text-[10px] font-semibold uppercase tracking-wider text-amber-900">
                    Coverage
                  </td>
                  {grid.days.map((d) => {
                    const dow = dowFromIso(d);
                    const rules = coverageByDow.get(dow) || [];
                    if (rules.length === 0) {
                      return <td key={d} className="p-1 text-center text-[10px] text-gray-300">—</td>;
                    }
                    return (
                      <td key={d} className="p-1 align-top">
                        <div className="space-y-1">
                          {rules.map((r, i) => {
                            const on = staffOnDutyForSlot(d, r.slot_start, r.slot_end);
                            const ok = on >= r.min_staff;
                            return (
                              <div
                                key={i}
                                title={`${r.slot_label || "slot"}: ${on}/${r.min_staff} staff`}
                                className={`rounded px-1 py-0.5 text-[10px] ${
                                  ok ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                                }`}
                              >
                                <span className="font-mono">
                                  {r.slot_start.slice(0, 5)}–{r.slot_end.slice(0, 5)}
                                </span>
                                <span className="ml-1 font-semibold">{on}/{r.min_staff}</span>
                                {r.is_peak && <span className="ml-0.5">🔥</span>}
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      ) : selectedOutlet && grid && grid.users.length === 0 ? (
        <div className="rounded-xl border bg-card py-16 text-center">
          <CalendarDays className="mx-auto mb-3 h-12 w-12 text-gray-300" />
          <p className="text-lg font-semibold">No staff at this outlet</p>
          <p className="text-sm text-muted-foreground">Assign staff to this outlet in Settings → Staff</p>
        </div>
      ) : !selectedOutlet ? (
        <div className="rounded-xl border bg-card py-16 text-center">
          <p className="text-lg font-semibold">Pick an outlet</p>
          <p className="text-sm text-muted-foreground">Select an outlet above to view the schedule grid</p>
        </div>
      ) : (
        <div className="rounded-xl border bg-card py-16 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {pendingCheck && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setPendingCheck(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center gap-2">
              <div className={
                "flex h-9 w-9 items-center justify-center rounded-full " +
                (pendingCheck.status === "block" ? "bg-red-100 text-red-700" :
                 pendingCheck.status === "overtime" ? "bg-orange-100 text-orange-700" :
                 "bg-amber-100 text-amber-700")
              }>
                ⚠
              </div>
              <h3 className="text-lg font-semibold">
                {pendingCheck.status === "block" ? "Shift blocked" :
                 pendingCheck.status === "overtime" ? "Overtime — approval needed" :
                 "Approaching weekly limit"}
              </h3>
            </div>
            <p className="mb-4 text-sm text-gray-700">{pendingCheck.message}</p>
            <div className="mb-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
              Proposed weekly total: <strong>{pendingCheck.proposed.toFixed(1)}h</strong> · Regular cap: <strong>{pendingCheck.limit}h</strong>
              <p className="mt-1 text-[11px] text-gray-500">
                Sum across all outlets this staff works at this week (user-scoped, multi-outlet aware).
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setPendingCheck(null)} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
              {pendingCheck.status === "overtime" && (
                <Link
                  href="/hr/overtime"
                  className="rounded-lg border border-terracotta px-4 py-2 text-sm text-terracotta hover:bg-terracotta/5"
                  onClick={() => setPendingCheck(null)}
                >
                  Request OT approval
                </Link>
              )}
              {pendingCheck.status !== "block" && (
                <button
                  onClick={() => setCell(pendingCheck.userId, pendingCheck.date, pendingCheck.templateId, true)}
                  disabled={saving}
                  className="rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
                >
                  {pendingCheck.status === "overtime" ? "Save as overtime" : "Confirm"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Per-day Assist modal — the fit-ranking flow embedded in the grid, so
          assist happens during scheduling. Prefills the day's first coverage
          gap; each assign refreshes the grid + labour gate behind it. */}
      {assistDate && selectedOutlet && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={() => setAssistDate(null)}>
          <div className="w-full max-w-3xl rounded-2xl bg-background p-4 shadow-xl sm:p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Sparkles className="h-4 w-4 text-terracotta" />
                Assist · {new Date(assistDate + "T00:00:00").toLocaleDateString("en-MY", { weekday: "long", day: "2-digit", month: "short" })}
              </h2>
              <button onClick={() => setAssistDate(null)} className="rounded-lg p-1.5 hover:bg-muted" aria-label="Close assist">
                <X className="h-4 w-4" />
              </button>
            </div>
            <AssistPanel outletId={selectedOutlet} date={assistDate} autoPickGap onAssigned={() => mutate()} />
          </div>
        </div>
      )}
    </div>
  );
}

function guessColor(shift: Shift): string {
  // Pick color by shift label or start time
  const label = (shift.role_type || shift.notes || "").toLowerCase();
  if (label.includes("morning")) return "amber";
  if (label.includes("afternoon") || label.includes("closing")) return "indigo";
  if (label.includes("middle")) return "blue";
  if (label.includes("nilai")) return "purple";
  return "gray";
}

// Day view — one date at a time: who opens, who's on each middle, who
// closes, who's resting or on leave, and that day's coverage. Read-only;
// editing stays in the week grid.
function DayView({
  grid,
  dayIdx,
  setDayIdx,
  gate,
}: {
  grid: GridData;
  dayIdx: number;
  setDayIdx: (i: number) => void;
  gate: LabourGateInfo | null;
}) {
  const date = grid.days[Math.min(dayIdx, grid.days.length - 1)];
  const nameOf = new Map(grid.users.map((u) => [u.id, u.fullName || u.name]));
  const positionOf = new Map(grid.users.map((u) => [u.id, u.profile?.position ?? ""]));
  // Same FOH/BOH split the AI Fill generator uses to spread kitchen cover.
  const isBOH = (userId: string) => {
    const p = (positionOf.get(userId) ?? "").toLowerCase();
    return p.includes("kitchen") || p.includes("chef") || p.includes("boh");
  };

  const dayShifts = grid.shifts.filter((s) => s.shift_date === date);
  const resting = dayShifts.filter((s) => s.notes === "rest_day");
  const working = dayShifts.filter((s) => s.notes !== "rest_day");
  const onLeave = grid.leaves.filter((l) => date >= l.start_date && date <= l.end_date);

  // Hour-by-hour timeline: one row per person, one column per opening hour,
  // FOH and BOH sectioned so each hour's head-split is readable at a glance.
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const spanOf = (s: Shift) => {
    const start = toMin(s.start_time);
    let end = toMin(s.end_time);
    if (end <= start) end = 24 * 60; // closing shift ending at midnight
    return { start, end };
  };
  const sorted = [...working].sort(
    (a, b) => a.start_time.localeCompare(b.start_time) || a.end_time.localeCompare(b.end_time),
  );
  // Management sits outside FOH/BOH — presence, not man-hours (owner rule
  // 2026-07-18) — so the station "on shift" counts stay honest vs demand.
  const isMgmt = (userId: string) => {
    const p = (positionOf.get(userId) ?? "").trim().toLowerCase();
    return p === "manager" || p === "area manager" || p === "head of department";
  };
  const mgmtRows = sorted.filter((s) => isMgmt(s.user_id));
  const fohRows = sorted.filter((s) => !isMgmt(s.user_id) && !isBOH(s.user_id));
  const bohRows = sorted.filter((s) => !isMgmt(s.user_id) && isBOH(s.user_id));
  let minH = 24;
  let maxH = 0;
  for (const s of working) {
    const { start, end } = spanOf(s);
    minH = Math.min(minH, Math.floor(start / 60));
    maxH = Math.max(maxH, Math.ceil(end / 60));
  }
  const hours = working.length ? Array.from({ length: maxH - minH }, (_, i) => minH + i) : [];
  const covers = (s: Shift, h: number) => {
    const { start, end } = spanOf(s);
    return start < (h + 1) * 60 && end > h * 60;
  };
  const countAt = (list: Shift[], h: number) => list.filter((s) => covers(s, h)).length;
  const cov = gate?.coverage?.find((c) => c.date === date);

  return (
    <div className="flex-1 min-h-0 space-y-3 overflow-auto">
      <div className="flex flex-wrap items-center gap-1">
        {grid.days.map((d, i) => (
          <button
            key={d}
            onClick={() => setDayIdx(i)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
              d === date ? "border-terracotta bg-terracotta text-white" : "hover:bg-muted"
            }`}
          >
            {DAY_NAMES[i]} {formatDay(d)}
          </button>
        ))}
        {cov && cov.neededHours > 0 && (
          <span
            className={`ml-auto rounded-lg border px-3 py-1.5 text-sm font-medium ${
              cov.shortHours === 0
                ? "border-green-200 bg-green-50 text-green-700"
                : "border-amber-300 bg-amber-50 text-amber-700"
            }`}
          >
            Coverage {cov.scheduledHours}/{cov.neededHours} staff-hours
            {cov.shortHours > 0 ? ` — ${cov.shortHours}h short` : " ✓"}
          </span>
        )}
        {cov?.forecast != null && (
          <span
            className={`${cov.neededHours > 0 ? "" : "ml-auto "}rounded-lg border px-3 py-1.5 text-sm font-medium ${
              cov.pct == null ? "border-gray-200 bg-gray-50 text-gray-600"
                : gate && cov.pct <= gate.targetPct ? "border-green-200 bg-green-50 text-green-700"
                  : gate && cov.pct <= gate.ceilingPct ? "border-amber-300 bg-amber-50 text-amber-700"
                    : "border-red-300 bg-red-50 text-red-700"
            }`}
            title="Daily labour %: this day's share of the week's actual roster cost (pro-rata by hours) ÷ this day's forecast. Day costs sum to the weekly total, so these average back to the Labour chip."
          >
            {cov.isWeekend ? "Weekend" : "Weekday"}
            {cov.isHoliday ? ` · ${cov.holidayName ?? "PH"}` : ""} · forecast RM
            {cov.forecast >= 1000 ? `${(cov.forecast / 1000).toFixed(1)}k` : cov.forecast}
            {cov.pct == null ? "" : ` · ${(cov.pct * 100).toFixed(0)}%`}
          </span>
        )}
      </div>

      {working.length === 0 && (
        <div className="rounded-xl border bg-card py-12 text-center text-sm text-muted-foreground">
          No shifts on {date} — use the week view to assign.
        </div>
      )}

      {working.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-card p-4">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-card pr-3 text-left font-medium text-muted-foreground">
                  Staff
                </th>
                {hours.map((h) => (
                  <th key={h} className="min-w-8 px-0.5 pb-1 text-center text-xs font-medium text-muted-foreground">
                    {String(h % 24).padStart(2, "0")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { title: "Front of house", list: fohRows, fill: "bg-terracotta/80", count: "text-terracotta" },
                { title: "Back of house", list: bohRows, fill: "bg-slate-500/80", count: "text-slate-600" },
                { title: "Management (not man-hours)", list: mgmtRows, fill: "bg-violet-400/70", count: "text-violet-600" },
              ]
                .filter((sec) => sec.list.length > 0)
                .map((sec) => (
                  <Fragment key={sec.title}>
                    <tr>
                      <td
                        colSpan={hours.length + 1}
                        className="sticky left-0 bg-card pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                      >
                        {sec.title} · {sec.list.length}
                      </td>
                    </tr>
                    {sec.list.map((s) => (
                      <tr key={s.id}>
                        <td className="sticky left-0 z-10 whitespace-nowrap bg-card py-0.5 pr-3">
                          <span className="font-medium">
                            {s.notes === "pt_suggestion" ? "PT? " : ""}
                            {nameOf.get(s.user_id) ?? s.user_id.slice(0, 8)}
                          </span>
                          {positionOf.get(s.user_id) && (
                            <span className="ml-1 text-xs text-muted-foreground">· {positionOf.get(s.user_id)}</span>
                          )}
                        </td>
                        {hours.map((h) => (
                          <td key={h} className="p-0" title={`${s.start_time.slice(0, 5)} – ${s.end_time.slice(0, 5)}`}>
                            {covers(s, h) && (
                              <div
                                className={`h-5 ${
                                  s.notes === "pt_suggestion"
                                    ? "border border-dashed border-amber-500 bg-amber-200"
                                    : sec.fill
                                } ${!covers(s, h - 1) ? "rounded-l" : ""} ${!covers(s, h + 1) ? "rounded-r" : ""}`}
                              />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr>
                      <td className="sticky left-0 z-10 bg-card py-0.5 pr-3 text-xs text-muted-foreground">on shift</td>
                      {hours.map((h) => (
                        <td key={h} className={`text-center text-xs font-semibold ${sec.count}`}>
                          {countAt(sec.list, h) || ""}
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                ))}
              <tr>
                <td className="sticky left-0 z-10 border-t bg-card py-1 pr-3 text-xs font-medium text-muted-foreground">
                  Total
                </td>
                {hours.map((h) => (
                  <td key={h} className="border-t text-center text-xs font-semibold">
                    {countAt(working, h) || ""}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {(resting.length > 0 || onLeave.length > 0) && (
        <div className="rounded-xl border bg-card p-4">
          <h3 className="mb-2 font-semibold">Off today</h3>
          <div className="flex flex-wrap gap-1.5 text-sm">
            {resting.map((s) => (
              <span key={s.id} className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-red-700">
                {nameOf.get(s.user_id) ?? "?"} · rest day
              </span>
            ))}
            {onLeave.map((l, i) => (
              <span key={i} className="rounded-lg border border-purple-200 bg-purple-50 px-2.5 py-1 text-purple-700">
                {nameOf.get(l.user_id) ?? "?"} · {l.leave_type}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
