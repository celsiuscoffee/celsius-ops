"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import Link from "next/link";
import { CalendarDays, Clock, ArrowLeftRight, Loader2, CheckCircle2, XCircle, ArrowLeft, Sunrise, Sun, Moon, Coffee } from "lucide-react";

type Shift = {
  id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  role_type: string | null;
  break_minutes: number;
  user_id: string;
  schedule_id: string;
};

type SwapRequest = {
  id: string;
  status: string;
  reason: string | null;
  requester_shift: Shift;
  target_shift: Shift;
  target_id: string;
  requester_id: string;
  created_at: string;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Visual palette per shift type. Derived from start time + shift duration.
type ShiftKind = "morning" | "afternoon" | "evening" | "full_day";
const SHIFT_STYLE: Record<ShiftKind, {
  label: string;
  icon: typeof Sunrise;
  card: string;     // full card bg + border
  dateChip: string; // left date pill bg
  dateText: string; // left date pill text
  iconColor: string;
}> = {
  morning: {
    label: "Morning",
    icon: Sunrise,
    card: "border-amber-200 bg-amber-50",
    dateChip: "bg-amber-400 text-white",
    dateText: "text-amber-900",
    iconColor: "text-amber-600",
  },
  afternoon: {
    label: "Afternoon",
    icon: Sun,
    card: "border-blue-200 bg-blue-50",
    dateChip: "bg-blue-500 text-white",
    dateText: "text-blue-900",
    iconColor: "text-blue-600",
  },
  evening: {
    label: "Evening",
    icon: Moon,
    card: "border-indigo-200 bg-indigo-50",
    dateChip: "bg-indigo-500 text-white",
    dateText: "text-indigo-900",
    iconColor: "text-indigo-600",
  },
  full_day: {
    label: "Full day",
    icon: Clock,
    card: "border-emerald-200 bg-emerald-50",
    dateChip: "bg-emerald-500 text-white",
    dateText: "text-emerald-900",
    iconColor: "text-emerald-600",
  },
};

function classifyShift(startTime: string, endTime: string, roleType: string | null): ShiftKind {
  // Full-day only when explicitly labeled as such (role_type) — don't infer
  // from duration, since many long afternoon/evening shifts are 9+ hours but
  // aren't actual "all-day" shifts.
  if (roleType && /full\s*day/i.test(roleType)) return "full_day";
  const [sh] = startTime.split(":").map(Number);
  if (sh < 11) return "morning";
  if (sh < 15) return "afternoon";
  return "evening";
}

export default function MyShiftsPage() {
  const { data } = useFetch<{ shifts: Shift[] }>("/api/hr/shifts");
  const { data: swapData, mutate: mutateSwaps } = useFetch<{ sent: SwapRequest[]; pendingConsent: SwapRequest[] }>("/api/hr/swap");
  const [swapAction, setSwapAction] = useState<string | null>(null);

  const shifts = data?.shifts || [];
  const pendingConsent = swapData?.pendingConsent || [];
  const sentSwaps = swapData?.sent || [];
  const today = new Date().toISOString().slice(0, 10);

  const handleSwapResponse = async (swapId: string, action: "consent" | "decline") => {
    setSwapAction(swapId);
    try {
      await fetch("/api/hr/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, swap_id: swapId }),
      });
      mutateSwaps();
    } finally {
      setSwapAction(null);
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; color: string }> = {
      pending_consent: { label: "Waiting for coworker", color: "bg-amber-50 text-amber-600" },
      pending_approval: { label: "Waiting for manager", color: "bg-blue-50 text-blue-600" },
      approved: { label: "Approved", color: "bg-green-50 text-green-600" },
      rejected: { label: "Rejected", color: "bg-red-50 text-red-600" },
      consent_declined: { label: "Declined", color: "bg-red-50 text-red-600" },
      cancelled: { label: "Cancelled", color: "bg-gray-50 text-gray-500" },
    };
    const s = map[status] || { label: status, color: "bg-gray-50 text-gray-500" };
    return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${s.color}`}>{s.label}</span>;
  };

  return (
    <div className="px-4 pt-6">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/hr"
          aria-label="Back"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600 active:scale-95 active:bg-gray-200"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold">My Shifts</h1>
      </div>

      {/* Pending swap consent requests FROM coworkers */}
      {pendingConsent.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-amber-600">Swap Requests for You</h2>
          {pendingConsent.map((swap) => (
            <div key={swap.id} className="mb-2 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium">
                Wants to swap your{" "}
                <strong>{swap.target_shift.shift_date} {swap.target_shift.start_time?.slice(0, 5)}-{swap.target_shift.end_time?.slice(0, 5)}</strong>
                {" "}with their{" "}
                <strong>{swap.requester_shift.shift_date} {swap.requester_shift.start_time?.slice(0, 5)}-{swap.requester_shift.end_time?.slice(0, 5)}</strong>
              </p>
              {swap.reason && <p className="mt-1 text-xs text-gray-500">{swap.reason}</p>}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => handleSwapResponse(swap.id, "consent")}
                  disabled={swapAction === swap.id}
                  className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  {swapAction === swap.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  Accept
                </button>
                <button
                  onClick={() => handleSwapResponse(swap.id, "decline")}
                  disabled={swapAction === swap.id}
                  className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  <XCircle className="h-3 w-3" /> Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* My Shifts — 14-day rolling view with rest days */}
      {(() => {
        // Build a 14-day window starting from today.
        const shiftsByDate = new Map<string, Shift[]>();
        for (const s of shifts) {
          const list = shiftsByDate.get(s.shift_date) || [];
          list.push(s);
          shiftsByDate.set(s.shift_date, list);
        }
        const days: string[] = [];
        const baseDate = new Date(today + "T00:00:00");
        for (let i = 0; i < 14; i++) {
          const d = new Date(baseDate);
          d.setDate(baseDate.getDate() + i);
          days.push(d.toISOString().slice(0, 10));
        }
        const hasAnyShift = shifts.some((s) => s.shift_date >= today);

        if (!hasAnyShift) {
          return (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 py-16 text-center">
              <CalendarDays className="mb-3 h-12 w-12 text-gray-300" />
              <p className="font-semibold text-gray-500">No upcoming shifts</p>
              <p className="text-sm text-gray-400">Schedule not published yet</p>
            </div>
          );
        }

        return (
          <div className="space-y-2">
            {days.map((dateStr) => {
              const dayShifts = shiftsByDate.get(dateStr) || [];
              const isToday = dateStr === today;
              const d = new Date(dateStr + "T00:00:00");
              const dayName = DAY_NAMES[d.getDay()];
              const dayNum = d.getDate();
              const month = d.toLocaleDateString("en-MY", { month: "short" });
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;

              // Rest day — no shifts that day
              if (dayShifts.length === 0) {
                return (
                  <div
                    key={dateStr}
                    className={`flex items-center gap-4 rounded-2xl border border-dashed p-4 ${
                      isToday ? "border-terracotta/60 bg-orange-50/40" : "border-gray-200 bg-gray-50/60"
                    }`}
                  >
                    <div className={`flex h-14 w-14 flex-col items-center justify-center rounded-xl ${
                      isToday ? "bg-terracotta/90 text-white" : isWeekend ? "bg-gray-200 text-gray-600" : "bg-gray-100 text-gray-500"
                    }`}>
                      <span className="text-[10px] font-bold uppercase">{dayName}</span>
                      <span className="text-lg font-bold leading-tight">{dayNum}</span>
                      <span className="text-[10px]">{month}</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 text-gray-500">
                        <Coffee className="h-4 w-4" />
                        <span className="text-sm font-medium">Rest day</span>
                      </div>
                      <p className="text-xs text-gray-400">
                        {isToday ? "Enjoy your day off" : "No shift scheduled"}
                      </p>
                    </div>
                    {isToday && (
                      <span className="rounded-full bg-terracotta px-2 py-0.5 text-[10px] font-bold text-white">
                        TODAY
                      </span>
                    )}
                  </div>
                );
              }

              // Day with shift(s) — pick the style of the first shift
              return (
                <div key={dateStr} className="space-y-2">
                  {dayShifts.map((shift) => {
                    const kind = classifyShift(shift.start_time, shift.end_time, shift.role_type);
                    const style = SHIFT_STYLE[kind];
                    const Icon = style.icon;
                    return (
                      <div
                        key={shift.id}
                        className={`flex items-center gap-4 rounded-2xl border p-4 ${
                          isToday ? "ring-2 ring-terracotta ring-offset-1" : ""
                        } ${style.card}`}
                      >
                        <div className={`flex h-14 w-14 flex-col items-center justify-center rounded-xl ${style.dateChip}`}>
                          <span className="text-[10px] font-bold uppercase">{dayName}</span>
                          <span className="text-lg font-bold leading-tight">{dayNum}</span>
                          <span className="text-[10px]">{month}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={`flex items-center gap-2 ${style.dateText}`}>
                            <Icon className={`h-4 w-4 ${style.iconColor}`} />
                            <span className="font-semibold">
                              {shift.start_time.slice(0, 5)} — {shift.end_time.slice(0, 5)}
                            </span>
                            <span className={`text-[10px] font-semibold uppercase tracking-wide ${style.iconColor}`}>
                              {style.label}
                            </span>
                          </div>
                          {shift.role_type && (
                            <p className={`mt-0.5 text-xs ${style.dateText} opacity-75`}>{shift.role_type}</p>
                          )}
                        </div>
                        {isToday && (
                          <span className="rounded-full bg-terracotta px-2 py-0.5 text-[10px] font-bold text-white">
                            TODAY
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* My Sent Swap Requests */}
      {sentSwaps.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-500">
            <ArrowLeftRight className="h-4 w-4" /> My Swap Requests
          </h2>
          <div className="space-y-2">
            {sentSwaps.map((swap) => (
              <div key={swap.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3">
                <ArrowLeftRight className="h-4 w-4 text-gray-400" />
                <div className="flex-1">
                  <p className="text-sm">
                    {swap.requester_shift?.shift_date} ↔ {swap.target_shift?.shift_date}
                  </p>
                  <p className="text-xs text-gray-400">
                    {new Date(swap.created_at).toLocaleDateString("en-MY")}
                  </p>
                </div>
                {statusBadge(swap.status)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
