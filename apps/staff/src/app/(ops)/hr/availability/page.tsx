"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import Link from "next/link";
import { CalendarX, X, Loader2, ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react";

type Availability = {
  id: string;
  date: string;
  availability: "unavailable" | "preferred" | "available";
  reason: string | null;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

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
        Tap a date to mark yourself <strong>unavailable</strong>. The AI scheduler won&apos;t assign shifts on these days.
      </p>

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

      {/* Reason modal */}
      {showReason && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5">
            <h3 className="mb-1 font-semibold">Mark Unavailable</h3>
            <p className="mb-3 text-sm text-gray-500">
              {new Date(showReason + "T00:00:00").toLocaleDateString("en-MY", { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional, e.g. family event)"
              className="mb-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setShowReason(null); setReason(""); }}
                className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmBlockout}
                disabled={saving !== null}
                className="flex-1 rounded-lg bg-red-500 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
