"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import Link from "next/link";
import { CalendarDays, Clock, ArrowLeftRight, Loader2, CheckCircle2, XCircle, ArrowLeft, Sunrise, Sun, Moon, Coffee, MapPin } from "lucide-react";
import { FetchError } from "@/components/fetch-error";

type Shift = {
  id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  role_type: string | null;
  break_minutes: number;
  user_id: string;
  schedule_id: string;
  /** Resolved server-side from the schedule's outlet_id — see api/hr/shifts. */
  outlet_name?: string | null;
};

type SwapRequest = {
  id: string;
  status: string;
  reason: string | null;
  requester_shift: Shift;
  target_shift: Shift;
  target_id: string;
  requester_id: string;
  requester_name?: string | null;
  target_name?: string | null;
  created_at: string;
};

type SwapCandidate = {
  shift_id: string;
  user_id: string;
  name: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  role_type: string | null;
};

// "Sat 12 Sep" from a YYYY-MM-DD, parsed as UTC so the label matches the MYT
// calendar date whatever the device timezone.
function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${d.toLocaleDateString("en-MY", { month: "short", timeZone: "UTC" })}`;
}
const hhmm = (t: string | null | undefined) => (t ?? "").slice(0, 5);

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Visual palette per shift kind. Enough distinct buckets so a morning /
// middle / afternoon / evening rotation reads as four different colours.
type ShiftKind = "morning" | "middle" | "afternoon" | "evening" | "full_day" | "rest_day";
const SHIFT_STYLE: Record<ShiftKind, {
  label: string;
  icon: typeof Sunrise;
  card: string;
  dateChip: string;
  dateText: string;
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
  middle: {
    label: "Middle",
    icon: Sun,
    card: "border-cyan-200 bg-cyan-50",
    dateChip: "bg-cyan-500 text-white",
    dateText: "text-cyan-900",
    iconColor: "text-cyan-600",
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
  rest_day: {
    label: "Rest day",
    icon: Coffee,
    card: "border-gray-200 bg-gray-50",
    dateChip: "bg-gray-300 text-gray-700",
    dateText: "text-gray-700",
    iconColor: "text-gray-500",
  },
};

function classifyShift(startTime: string, endTime: string, roleType: string | null): ShiftKind {
  // Primary signal: explicit label on the shift (role_type).
  if (roleType) {
    const rt = roleType.toLowerCase();
    if (rt.includes("rest")) return "rest_day";
    if (rt.includes("full")) return "full_day";
    if (rt.includes("morning")) return "morning";
    if (rt.includes("middle") || rt.includes("mid ") || rt.includes("mid-") || rt.includes("opening")) return "middle";
    if (rt.includes("afternoon")) return "afternoon";
    if (rt.includes("evening") || rt.includes("night") || rt.includes("closing")) return "evening";
  }
  // Fallback: by start time (no label provided).
  const [sh] = startTime.split(":").map(Number);
  if (!Number.isFinite(sh) || (startTime === "00:00:00" && endTime === "00:00:00")) return "rest_day";
  if (sh < 10) return "morning";
  if (sh < 13) return "middle";
  if (sh < 16) return "afternoon";
  return "evening";
}

export default function MyShiftsPage() {
  const { data, error: shiftsError, mutate: mutateShifts } = useFetch<{ shifts: Shift[] }>("/api/hr/shifts");
  const { data: swapData, mutate: mutateSwaps } = useFetch<{ sent: SwapRequest[]; pendingConsent: SwapRequest[] }>("/api/hr/swap");
  const [swapAction, setSwapAction] = useState<string | null>(null);
  // Swap picker: which of MY shifts I'm offering. The request action has
  // existed in /api/hr/swap since launch, but nothing in the app called it —
  // staff could only accept swaps that a coworker somehow raised.
  const [swapFor, setSwapFor] = useState<Shift | null>(null);
  const [swapNotice, setSwapNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const shifts = data?.shifts || [];
  const pendingConsent = swapData?.pendingConsent || [];
  const sentSwaps = swapData?.sent || [];
  // MYT "today" — a plain toISOString() is UTC, which is yesterday before
  // 08:00 MYT and badges the wrong day.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });

  const handleSwapResponse = async (swapId: string, action: "consent" | "decline" | "cancel") => {
    if (action === "cancel" && !window.confirm("Withdraw this swap request?")) return;
    setSwapAction(swapId);
    setSwapNotice(null);
    try {
      const res = await fetch("/api/hr/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, swap_id: swapId }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        setSwapNotice({ ok: false, text: j?.error ?? `Couldn't update the swap (${res.status}).` });
      } else if (action === "consent") {
        setSwapNotice({ ok: true, text: "Accepted — your manager will confirm the swap." });
      } else if (action === "cancel") {
        setSwapNotice({ ok: true, text: "Swap request withdrawn." });
      }
      mutateSwaps();
    } catch {
      setSwapNotice({ ok: false, text: "Network error — nothing was changed." });
    } finally {
      setSwapAction(null);
    }
  };

  const openSwaps = sentSwaps.filter((s) => s.status === "pending_consent" || s.status === "pending_approval");
  const shiftsInOpenSwap = new Set(openSwaps.map((s) => s.requester_shift?.id).filter(Boolean));

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

      {swapNotice && (
        <div className={`mb-4 rounded-xl px-4 py-2.5 text-sm font-medium ${
          swapNotice.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
        }`}>
          {swapNotice.text}
        </div>
      )}

      {/* Pending swap consent requests FROM coworkers */}
      {pendingConsent.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-amber-600">Swap Requests for You</h2>
          {pendingConsent.map((swap) => (
            <div key={swap.id} className="mb-2 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium">
                <strong>{swap.requester_name ?? "A coworker"}</strong> wants to swap your{" "}
                <strong>{dayLabel(swap.target_shift.shift_date)} {hhmm(swap.target_shift.start_time)}-{hhmm(swap.target_shift.end_time)}</strong>
                {" "}with their{" "}
                <strong>{dayLabel(swap.requester_shift.shift_date)} {hhmm(swap.requester_shift.start_time)}-{hhmm(swap.requester_shift.end_time)}</strong>
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
        // Build the window by UTC arithmetic on the MYT date string. Parsing
        // `today + "T00:00:00"` as LOCAL time and re-serialising to UTC was the
        // off-by-one that put a phantom "yesterday" card at the top and dropped
        // the 14th day. Anchoring at ...Z and stepping in UTC keeps each label
        // equal to the MYT calendar date regardless of the device timezone.
        const days: string[] = [];
        const baseDate = new Date(today + "T00:00:00Z");
        for (let i = 0; i < 14; i++) {
          const d = new Date(baseDate);
          d.setUTCDate(baseDate.getUTCDate() + i);
          days.push(d.toISOString().slice(0, 10));
        }
        const hasAnyShift = shifts.some((s) => s.shift_date >= today);

        // A failed fetch is not "no shifts" — the old empty state told a
        // staffer with an expired session that the schedule wasn't published.
        if (!data && shiftsError) {
          return <FetchError error={shiftsError} onRetry={() => mutateShifts()} what="your shifts" />;
        }

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
              const rawShifts = shiftsByDate.get(dateStr) || [];
              // "Rest Day" rows (00:00-00:00 or role_type "Rest day") come
              // through the schedule but should render as rest, not a shift.
              const dayShifts = rawShifts.filter((s) => classifyShift(s.start_time, s.end_time, s.role_type) !== "rest_day");
              const hasRestRow = rawShifts.length > 0 && dayShifts.length === 0;
              const isToday = dateStr === today;
              const d = new Date(dateStr + "T00:00:00");
              const dayName = DAY_NAMES[d.getDay()];
              const dayNum = d.getDate();
              const month = d.toLocaleDateString("en-MY", { month: "short" });
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;

              // Rest day — no shifts that day, OR the schedule explicitly
              // rostered a "Rest day" row for this date.
              if (dayShifts.length === 0) {
                const subtitle = hasRestRow ? "Rostered rest day" : isToday ? "Enjoy your day off" : "No shift scheduled";
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
                      <p className="text-xs text-gray-400">{subtitle}</p>
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
                          {(shift.role_type || shift.outlet_name) && (
                            <p className={`mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs ${style.dateText} opacity-75`}>
                              {shift.role_type && <span>{shift.role_type}</span>}
                              {shift.role_type && shift.outlet_name && <span aria-hidden>·</span>}
                              {/* Rotating staff work several outlets in one week —
                                  without this the card never said where. */}
                              {shift.outlet_name && (
                                <span className="inline-flex items-center gap-1 font-medium">
                                  <MapPin className="h-3 w-3 shrink-0" />
                                  {shift.outlet_name}
                                </span>
                              )}
                            </p>
                          )}
                        </div>
                        {isToday ? (
                          <span className="rounded-full bg-terracotta px-2 py-0.5 text-[10px] font-bold text-white">
                            TODAY
                          </span>
                        ) : shiftsInOpenSwap.has(shift.id) ? (
                          <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                            Swap pending
                          </span>
                        ) : (
                          // Only future days: the API refuses same-day swaps.
                          <button
                            onClick={() => { setSwapNotice(null); setSwapFor(shift); }}
                            aria-label="Request a swap for this shift"
                            className="flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-gray-700 shadow-sm active:scale-95"
                          >
                            <ArrowLeftRight className="h-3 w-3" /> Swap
                          </button>
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

      {swapFor && (
        <SwapPicker
          shift={swapFor}
          onClose={() => setSwapFor(null)}
          onDone={(text) => {
            setSwapFor(null);
            setSwapNotice({ ok: true, text });
            mutateSwaps();
          }}
        />
      )}

      {/* My Sent Swap Requests */}
      {sentSwaps.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-500">
            <ArrowLeftRight className="h-4 w-4" /> My Swap Requests
          </h2>
          <div className="space-y-2">
            {sentSwaps.map((swap) => {
              const cancellable = swap.status === "pending_consent" || swap.status === "pending_approval";
              return (
                <div key={swap.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3">
                  <ArrowLeftRight className="h-4 w-4 shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      {swap.requester_shift ? dayLabel(swap.requester_shift.shift_date) : "?"}
                      {" ↔ "}
                      {swap.target_shift ? dayLabel(swap.target_shift.shift_date) : "?"}
                      {swap.target_name ? <span className="text-gray-500"> with {swap.target_name}</span> : null}
                    </p>
                    <p className="text-xs text-gray-400">
                      Sent {new Date(swap.created_at).toLocaleDateString("en-MY")}
                    </p>
                  </div>
                  {statusBadge(swap.status)}
                  {cancellable && (
                    <button
                      onClick={() => handleSwapResponse(swap.id, "cancel")}
                      disabled={swapAction === swap.id}
                      aria-label="Withdraw swap request"
                      title="Withdraw this request"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-400 active:bg-gray-100 disabled:opacity-50"
                    >
                      {swapAction === swap.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Bottom sheet: pick a coworker's shift to swap `shift` with, add an optional
// note, send. Candidates come from /api/hr/swap/candidates (same outlet,
// published, future, not already in a swap).
function SwapPicker({
  shift,
  onClose,
  onDone,
}: {
  shift: Shift;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { data, error, isLoading } = useFetch<{ myShiftBusy?: boolean; candidates: SwapCandidate[] }>(
    `/api/hr/swap/candidates?shift_id=${shift.id}`,
  );
  const [picked, setPicked] = useState<SwapCandidate | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const candidates = data?.candidates ?? [];
  const byDate = new Map<string, SwapCandidate[]>();
  for (const c of candidates) {
    const list = byDate.get(c.shift_date) ?? [];
    list.push(c);
    byDate.set(c.shift_date, list);
  }

  const submit = async () => {
    if (!picked) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/hr/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "request",
          my_shift_id: shift.id,
          target_shift_id: picked.shift_id,
          target_id: picked.user_id,
          reason: reason.trim() || null,
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        setErr(j?.error ?? `Couldn't send the request (${res.status}).`);
        return;
      }
      onDone(`Swap request sent to ${picked.name}. They need to accept, then your manager confirms.`);
    } catch {
      setErr("Network error — the request was not sent.");
    } finally {
      setSubmitting(false);
    }
  };

  // The fetch hook throws a bare status on non-2xx; the candidates route
  // answers 409 with a reason for shifts that can't be swapped at all.
  const fetchMessage = error
    ? /\b409\b/.test(String((error as Error).message))
      ? "This shift can't be swapped (it may be unpublished, a rest day, or already today)."
      : /\b401\b/.test(String((error as Error).message))
        ? "Your session has expired — sign in again."
        : "Couldn't load coworkers' shifts. Try again."
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Request a shift swap"
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-bold">Swap this shift</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1 text-gray-400 active:bg-gray-100">
            <XCircle className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-sm text-gray-600">
          Your <strong>{dayLabel(shift.shift_date)} {hhmm(shift.start_time)}–{hhmm(shift.end_time)}</strong>
          {shift.outlet_name ? <span> at {shift.outlet_name}</span> : null}
        </p>

        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : fetchMessage ? (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">{fetchMessage}</p>
        ) : data?.myShiftBusy ? (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
            This shift already has a swap request in progress. Withdraw it first.
          </p>
        ) : candidates.length === 0 ? (
          <p className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-500">
            No coworker shifts to swap with in the two weeks around this one. Ask your manager instead.
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Take over a coworker&apos;s shift</p>
            <div className="mb-4 max-h-[40vh] space-y-3 overflow-y-auto pr-1">
              {Array.from(byDate.entries()).map(([date, list]) => (
                <div key={date}>
                  <p className="mb-1 text-xs font-semibold text-gray-500">{dayLabel(date)}</p>
                  <div className="space-y-1.5">
                    {list.map((c) => {
                      const selected = picked?.shift_id === c.shift_id;
                      return (
                        <button
                          key={c.shift_id}
                          onClick={() => setPicked(c)}
                          className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left ${
                            selected ? "border-terracotta bg-orange-50" : "border-gray-200 bg-white"
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{c.name}</p>
                            <p className="text-xs text-gray-500">
                              {hhmm(c.start_time)}–{hhmm(c.end_time)}{c.role_type ? ` · ${c.role_type}` : ""}
                            </p>
                          </div>
                          {selected && <CheckCircle2 className="h-4 w-4 shrink-0 text-terracotta" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium text-gray-500">Note to your coworker (optional)</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="e.g. Family event that evening"
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </label>
            {err && <p className="mb-3 text-sm font-medium text-red-600">{err}</p>}
            <button
              onClick={submit}
              disabled={!picked || submitting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-terracotta py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
              {picked ? `Ask ${picked.name} to swap` : "Pick a shift"}
            </button>
            <p className="mt-2 text-center text-[11px] text-gray-400">
              They accept first, then your manager confirms. Nothing changes until then.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
