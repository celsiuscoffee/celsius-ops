"use client";

import { useFetch } from "@/lib/use-fetch";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarX, X, Loader2, ChevronLeft, ChevronRight, ArrowLeft, CalendarClock } from "lucide-react";

type Availability = {
  id: string;
  date: string;
  availability: "unavailable" | "preferred" | "available";
  reason: string | null;
};

type WeeklyRow = {
  id: string;
  day_of_week: number;
  available_from: string | null;
  available_until: string | null;
  max_shifts_per_week: number | null;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Mon-first display order for the weekly pattern (0=Sun … 6=Sat in the DB).
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

// No typing: hours come from presets (mirroring the real shift templates) or
// 30-min dropdowns.
const PRESETS = [
  { label: "Morning", from: "07:30", until: "15:30" },
  { label: "Midday", from: "12:00", until: "20:00" },
  { label: "Evening", from: "15:30", until: "23:30" },
] as const;
const TIME_OPTIONS: string[] = [];
for (let h = 6; h <= 23; h++) for (const m of ["00", "30"]) TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:${m}`);

type DayMode = "off" | "any" | "custom";
type DayState = { mode: DayMode; from: string; until: string };

// Weekly recurring pattern editor. Semantics: never saved = flexible (AI can
// propose any day); once saved, days set to Off are hard-off for the AI fill.
function WeeklyPattern() {
  const { data, mutate } = useFetch<{ weekly: WeeklyRow[] }>("/api/hr/availability/weekly");
  const [days, setDays] = useState<Record<number, DayState> | null>(null);
  const [maxShifts, setMaxShifts] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed editor state from the server once (or "flexible" defaults when empty).
  useEffect(() => {
    if (!data || days !== null) return;
    const next: Record<number, DayState> = {};
    for (const dw of WEEK_ORDER) next[dw] = { mode: data.weekly.length === 0 ? "any" : "off", from: "07:30", until: "15:30" };
    for (const r of data.weekly) {
      const from = (r.available_from ?? "00:00").slice(0, 5);
      const until = (r.available_until ?? "23:59").slice(0, 5);
      const allDay = from === "00:00" && until >= "23:59"; // stored form of "any time"
      next[r.day_of_week] = allDay
        ? { mode: "any", from: "07:30", until: "15:30" }
        : { mode: "custom", from, until };
    }
    const cap = data.weekly.find((r) => r.max_shifts_per_week != null)?.max_shifts_per_week;
    setMaxShifts(cap ?? "");
    setDays(next);
  }, [data, days]);

  const hasPattern = (data?.weekly.length ?? 0) > 0;

  const save = async (clear = false) => {
    if (!days) return;
    setSaving(true);
    setError(null);
    try {
      const payload = clear
        ? { days: [] }
        : {
            days: WEEK_ORDER.filter((dw) => days[dw].mode !== "off").map((dw) => ({
              day_of_week: dw,
              available_from: days[dw].mode === "custom" ? days[dw].from : null,
              available_until: days[dw].mode === "custom" ? days[dw].until : null,
            })),
            max_shifts_per_week: maxShifts === "" ? null : maxShifts,
          };
      const res = await fetch("/api/hr/availability/weekly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? "Failed to save");
        return;
      }
      if (clear) setDays(null); // reseed from server
      mutate();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  if (!days) {
    return (
      <div className="mb-4 rounded-2xl border border-gray-100 bg-white p-4">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-300" />
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-2xl border border-gray-100 bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-terracotta" />
        <h2 className="font-semibold">Weekly pattern</h2>
      </div>
      <p className="mb-3 text-xs text-gray-500">
        {hasPattern
          ? "The AI scheduler only offers you shifts inside this pattern."
          : "No pattern saved — you're flexible, any day. Save one if you have fixed days (classes, another job)."}
      </p>

      {/* One-tap setups */}
      <div className="mb-3 flex flex-wrap gap-2">
        {([
          ["Any day", WEEK_ORDER],
          ["Weekdays only", [1, 2, 3, 4, 5]],
          ["Weekends only", [6, 0]],
        ] as const).map(([label, on]) => (
          <button
            key={label}
            onClick={() => {
              const next = { ...days };
              for (const dw of WEEK_ORDER) next[dw] = { ...next[dw], mode: (on as readonly number[]).includes(dw) ? "any" : "off" };
              setDays(next);
            }}
            className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 active:scale-95"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {WEEK_ORDER.map((dw) => {
          const d = days[dw];
          return (
            <div key={dw} className={`rounded-xl ${d.mode === "custom" ? "bg-orange-50/60 p-2" : ""}`}>
              <div className="flex items-center gap-2">
                <span className="w-11 shrink-0 text-sm font-bold text-gray-600">{DAY_NAMES[dw]}</span>
                <div className="grid flex-1 grid-cols-3 gap-1.5">
                  {(["off", "any", "custom"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setDays({ ...days, [dw]: { ...d, mode } })}
                      className={`min-h-11 rounded-xl px-2 py-2.5 text-sm font-medium transition-colors ${
                        d.mode === mode
                          ? mode === "off"
                            ? "bg-gray-700 text-white"
                            : "bg-terracotta text-white"
                          : "bg-gray-50 text-gray-500"
                      }`}
                    >
                      {mode === "off" ? "Off" : mode === "any" ? "Any time" : d.mode === "custom" ? `${d.from}–${d.until}` : "Hours…"}
                    </button>
                  ))}
                </div>
              </div>
              {d.mode === "custom" && (
                <div className="mt-2 space-y-2 pl-12">
                  <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map((p) => {
                      const active = d.from === p.from && d.until === p.until;
                      return (
                        <button
                          key={p.label}
                          onClick={() => setDays({ ...days, [dw]: { ...d, from: p.from, until: p.until } })}
                          className={`rounded-xl px-3 py-2 text-sm font-medium ${
                            active ? "bg-terracotta text-white" : "border border-gray-200 bg-white text-gray-700"
                          }`}
                        >
                          {p.label} {p.from}–{p.until}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2 text-base">
                    <select
                      value={d.from}
                      onChange={(e) => {
                        const from = e.target.value;
                        setDays({ ...days, [dw]: { ...d, from, until: d.until <= from ? (TIME_OPTIONS.find((t) => t > from) ?? "23:30") : d.until } });
                      }}
                      className="min-h-11 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-base"
                    >
                      {TIME_OPTIONS.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <span className="text-gray-400">–</span>
                    <select
                      value={d.until}
                      onChange={(e) => setDays({ ...days, [dw]: { ...d, until: e.target.value } })}
                      className="min-h-11 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-base"
                    >
                      {TIME_OPTIONS.filter((t) => t > d.from).map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4">
        <label className="text-sm font-semibold text-gray-600">Max shifts per week</label>
        <div className="mt-1.5 grid grid-cols-6 gap-1.5">
          {(["", 1, 2, 3, 4, 5] as const).map((n) => (
            <button
              key={String(n)}
              onClick={() => setMaxShifts(n === "" ? "" : n)}
              className={`min-h-11 rounded-xl py-2.5 text-base font-medium ${
                maxShifts === n ? "bg-terracotta text-white" : "bg-gray-50 text-gray-500"
              }`}
            >
              {n === "" ? "Any" : n}
            </button>
          ))}
        </div>
      </div>

      {/* Live summary of what will be saved */}
      <p className="mt-3 text-sm text-gray-500">
        {(() => {
          const on = WEEK_ORDER.filter((dw) => days[dw].mode !== "off");
          if (on.length === 0) return "No days selected — you won't be offered any shifts.";
          if (on.length === 7 && on.every((dw) => days[dw].mode === "any")) return "Available any day, any time.";
          return "Available: " + on.map((dw) => (days[dw].mode === "any" ? DAY_NAMES[dw] : `${DAY_NAMES[dw]} ${days[dw].from}–${days[dw].until}`)).join(", ") + (maxShifts !== "" ? ` · max ${maxShifts} shifts/week` : "");
        })()}
      </p>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => save(false)}
          disabled={saving}
          className="min-h-12 flex-1 rounded-xl bg-terracotta py-3 text-base font-semibold text-white disabled:opacity-50"
        >
          {saving ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : savedFlash ? "Saved ✓" : "Save pattern"}
        </button>
        {hasPattern && (
          <button
            onClick={() => save(true)}
            disabled={saving}
            className="min-h-12 rounded-xl border border-gray-200 px-4 py-3 text-base font-medium text-gray-600"
          >
            Clear — I&apos;m flexible
          </button>
        )}
      </div>
    </div>
  );
}

export default function AvailabilityPage() {
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const { data, mutate } = useFetch<{ availability: Availability[] }>("/api/hr/availability");
  const [saving, setSaving] = useState<string | null>(null);
  const [showReason, setShowReason] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const availability = data?.availability || [];
  const availMap = new Map(availability.map((a) => [a.date, a]));
  const today = new Date().toISOString().slice(0, 10);

  const handleToggle = async (date: string) => {
    const existing = availMap.get(date);
    setSaving(date);

    try {
      if (existing && existing.availability === "unavailable") {
        // Remove blockout
        await fetch(`/api/hr/availability?date=${date}`, { method: "DELETE" });
      } else {
        // Show reason prompt for new blockout
        setShowReason(date);
        setSaving(null);
        return;
      }
      mutate();
    } finally {
      setSaving(null);
    }
  };

  const handleConfirmBlockout = async () => {
    if (!showReason) return;
    setSaving(showReason);
    try {
      await fetch("/api/hr/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: showReason,
          availability: "unavailable",
          reason: reason.trim() || null,
        }),
      });
      setShowReason(null);
      setReason("");
      mutate();
    } finally {
      setSaving(null);
    }
  };

  // Build calendar grid for the month
  const firstDay = new Date(viewMonth.year, viewMonth.month, 1);
  const lastDay = new Date(viewMonth.year, viewMonth.month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startPadding = firstDay.getDay(); // 0=Sun
  const cells: (number | null)[] = [];
  for (let i = 0; i < startPadding; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(i);

  const prevMonth = () => {
    setViewMonth((m) => m.month === 0
      ? { year: m.year - 1, month: 11 }
      : { year: m.year, month: m.month - 1 },
    );
  };
  const nextMonth = () => {
    setViewMonth((m) => m.month === 11
      ? { year: m.year + 1, month: 0 }
      : { year: m.year, month: m.month + 1 },
    );
  };

  return (
    <div className="px-4 pt-6">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href="/hr"
          aria-label="Back"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600 active:scale-95 active:bg-gray-200"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold">My Availability</h1>
      </div>
      <p className="mb-5 text-sm text-gray-500">
        Set your weekly pattern, then tap dates below to mark one-off <strong>blockouts</strong>. The AI scheduler won&apos;t assign shifts outside these.
      </p>

      {/* Weekly recurring pattern */}
      <WeeklyPattern />

      {/* Month nav */}
      <div className="mb-4 flex items-center justify-between rounded-2xl border border-gray-100 bg-white p-3">
        <button onClick={prevMonth} className="rounded-lg p-2 hover:bg-gray-100">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <p className="font-semibold">{MONTHS[viewMonth.month]} {viewMonth.year}</p>
        <button onClick={nextMonth} className="rounded-lg p-2 hover:bg-gray-100">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Calendar grid */}
      <div className="mb-4 rounded-2xl border border-gray-100 bg-white p-3">
        {/* Day headers */}
        <div className="mb-2 grid grid-cols-7 gap-1">
          {DAY_NAMES.map((day) => (
            <div key={day} className="text-center text-[10px] font-bold uppercase text-gray-400">
              {day}
            </div>
          ))}
        </div>

        {/* Dates */}
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, idx) => {
            if (day === null) return <div key={idx} />;
            const dateStr = `${viewMonth.year}-${String(viewMonth.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const isPast = dateStr < today;
            const isToday = dateStr === today;
            const a = availMap.get(dateStr);
            const isBlocked = a?.availability === "unavailable";
            const isSaving = saving === dateStr;

            return (
              <button
                key={idx}
                onClick={() => !isPast && handleToggle(dateStr)}
                disabled={isPast || isSaving}
                className={`relative aspect-square rounded-lg text-sm font-medium transition-all active:scale-95 ${
                  isPast ? "cursor-not-allowed text-gray-300" :
                  isBlocked ? "bg-red-500 text-white hover:bg-red-600" :
                  isToday ? "border-2 border-terracotta bg-orange-50 text-terracotta hover:bg-orange-100" :
                  "bg-gray-50 text-gray-700 hover:bg-gray-100"
                }`}
              >
                {isSaving ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : day}
                {isBlocked && (
                  <X className="absolute right-0.5 top-0.5 h-3 w-3" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="mb-4 flex flex-wrap gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded bg-red-500" />
          <span className="text-gray-600">Unavailable</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded border-2 border-terracotta bg-orange-50" />
          <span className="text-gray-600">Today</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded bg-gray-50 border border-gray-200" />
          <span className="text-gray-600">Available</span>
        </div>
      </div>

      {/* List of blockout dates */}
      {availability.filter((a) => a.availability === "unavailable" && a.date >= today).length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-500">Upcoming Blockouts</h2>
          <div className="space-y-2">
            {availability
              .filter((a) => a.availability === "unavailable" && a.date >= today)
              .slice(0, 10)
              .map((a) => {
                const d = new Date(a.date + "T00:00:00");
                return (
                  <div key={a.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3">
                    <CalendarX className="h-4 w-4 text-red-500" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">
                        {d.toLocaleDateString("en-MY", { weekday: "short", day: "numeric", month: "short" })}
                      </p>
                      {a.reason && <p className="text-xs text-gray-400">{a.reason}</p>}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Reason modal — CENTERED, not a bottom sheet: pinned-to-bottom put the
          input under the keyboard and the buttons behind the bottom nav on
          phones (owner report 2026-07-19: "staff apps cannot fill reason").
          text-base (16px) also stops iOS Safari's focus-zoom jump. */}
      {showReason && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 pb-28">
          <div className="w-full max-w-md rounded-2xl bg-white p-5">
            <h3 className="mb-1 text-lg font-semibold">Mark Unavailable</h3>
            <p className="mb-3 text-base text-gray-500">
              {new Date(showReason + "T00:00:00").toLocaleDateString("en-MY", { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional, e.g. family event)"
              className="mb-3 min-h-12 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-base"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setShowReason(null); setReason(""); }}
                className="min-h-12 flex-1 rounded-xl border border-gray-200 py-2.5 text-base font-medium text-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmBlockout}
                disabled={saving !== null}
                className="min-h-12 flex-1 rounded-xl bg-red-500 py-2.5 text-base font-medium text-white disabled:opacity-50"
              >
                {saving ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
