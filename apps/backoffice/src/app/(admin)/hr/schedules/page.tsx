"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import {
  Bot, CalendarDays, Send, Loader2, ArrowLeftRight,
  ChevronLeft, ChevronRight, RotateCcw, Trash2,
} from "lucide-react";

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
  availability: Availability[];
  weeklyAvailability: WeeklyAvailability[];
  coverageRules: CoverageRule[];
  holidays: Holiday[];
  templates: ShiftTemplate[];
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
    const left = Math.min(rect.left, window.innerWidth - POPUP_WIDTH - 8);
    const top = rect.bottom + 4;
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
  const [generating, setGenerating] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [swapAction, setSwapAction] = useState<string | null>(null);

  // Get outlets list from the old endpoint (for dropdown)
  const { data: scheduleList } = useFetch<{ outlets: { id: string; name: string }[] }>("/api/hr/schedules");

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
  const { data: swapData, mutate: mutateSwaps } = useFetch<{ swaps: SwapRequest[] }>("/api/hr/swap");
  const pendingSwaps = swapData?.swaps || [];

  // Index shifts by (user_id, date)
  const shiftsMap = useMemo(() => {
    const m = new Map<string, Shift>();
    (grid?.shifts || []).forEach((s) => m.set(`${s.user_id}:${s.shift_date}`, s));
    return m;
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

  // Count staff on duty overlapping a slot (used for coverage display)
  const staffOnDutyForSlot = (dayIso: string, slotStart: string, slotEnd: string): number => {
    const active = (grid?.shifts || []).filter(
      (s) => s.shift_date === dayIso && s.notes !== "rest_day" &&
        s.start_time < slotEnd && s.end_time > slotStart,
    );
    return new Set(active.map((s) => s.user_id)).size;
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
      await fetch("/api/hr/schedules/cell", {
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
      mutate();
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
      await fetch("/api/hr/schedules/cell", {
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
      mutate();
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
      await fetch("/api/hr/schedules/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outlet_id: selectedOutlet, week_start: weekStart, action }),
      });
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
        body: JSON.stringify({ action: "generate", outlet_id: selectedOutlet, week_start: weekStart }),
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
    <div className="space-y-4 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Schedules</h1>
          <p className="text-sm text-muted-foreground">Click a cell to assign a shift</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClearAll}
            disabled={clearing || !grid?.schedule || isPublished}
            className="flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            title={isPublished ? "Unpublish first to clear" : "Clear all shifts for this week"}
          >
            {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Clear Week
          </button>
          <button
            onClick={handleAIFill}
            disabled={generating || !selectedOutlet || isPublished}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
            AI Fill
          </button>
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
        </div>
      </div>

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
      {grid && grid.users.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="sticky left-0 z-10 bg-muted/50 p-2 text-left font-medium min-w-[180px]">
                  Employee
                </th>
                {grid.days.map((d, i) => {
                  const hol = holidayMap.get(d);
                  return (
                    <th key={d} className={`p-2 text-center font-medium min-w-[120px] ${hol ? "bg-red-50" : ""}`}>
                      <div className="text-xs text-muted-foreground">{DAY_NAMES[i]}</div>
                      <div className="text-base">{formatDay(d)}</div>
                      {hol && <div className="text-[9px] text-red-600 truncate" title={hol.name}>PH: {hol.name}</div>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {grid.users.map((u) => {
                const position = u.profile?.position || (u.role === "MANAGER" ? "Manager" : "Barista");
                const isPartTime = u.profile?.employment_type === "part_time";
                const empType = isPartTime ? "PT" : "FT";
                return (
                  <tr key={u.id} className="border-b hover:bg-muted/30">
                    <td className="sticky left-0 z-10 bg-background p-2">
                      <div className="font-medium">{u.fullName || u.name}</div>
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
                              className="w-full rounded-lg bg-gray-100 border border-gray-300 p-2 text-center hover:bg-gray-200 disabled:cursor-default"
                              disabled={isPublished}
                            >
                              <div className="text-[10px] font-bold uppercase text-gray-500">Rest Day</div>
                            </button>
                          ) : shift ? (
                            <button
                              onClick={(e) => openPicker(u.id, d, e)}
                              className={`w-full rounded-lg border p-2 text-left ${
                                COLOR_MAP[guessColor(shift)] || COLOR_MAP.gray
                              } disabled:cursor-default`}
                              disabled={isPublished}
                            >
                              <div className="text-[10px] font-bold truncate">{shift.role_type || "Shift"}</div>
                              <div className="text-[10px]">
                                {shift.start_time.slice(0, 5)} - {shift.end_time.slice(0, 5)}
                              </div>
                            </button>
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
            </tbody>
            {/* Coverage gap footer — for each day shows how each coverage rule is satisfied */}
            {grid.coverageRules && grid.coverageRules.length > 0 && (
              <tfoot className="border-t-2 border-gray-200">
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
              </tfoot>
            )}
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
