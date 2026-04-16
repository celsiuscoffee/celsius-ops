"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { CalendarDays, Clock, ArrowLeftRight, Loader2, CheckCircle2, XCircle, Clock4 } from "lucide-react";

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
      <h1 className="mb-6 text-2xl font-bold">My Shifts</h1>

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

      {/* My Shifts */}
      {shifts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 py-16 text-center">
          <CalendarDays className="mb-3 h-12 w-12 text-gray-300" />
          <p className="font-semibold text-gray-500">No upcoming shifts</p>
          <p className="text-sm text-gray-400">Schedule not published yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {shifts.map((shift) => {
            const isToday = shift.shift_date === today;
            const date = new Date(shift.shift_date + "T00:00:00");
            const dayName = DAY_NAMES[date.getDay()];
            const dayNum = date.getDate();
            const month = date.toLocaleDateString("en-MY", { month: "short" });

            return (
              <div
                key={shift.id}
                className={`flex items-center gap-4 rounded-2xl border p-4 ${
                  isToday ? "border-terracotta bg-orange-50" : "border-gray-100 bg-white"
                }`}
              >
                <div className={`flex h-14 w-14 flex-col items-center justify-center rounded-xl ${
                  isToday ? "bg-terracotta text-white" : "bg-gray-100 text-gray-600"
                }`}>
                  <span className="text-[10px] font-bold uppercase">{dayName}</span>
                  <span className="text-lg font-bold leading-tight">{dayNum}</span>
                  <span className="text-[10px]">{month}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-gray-400" />
                    <span className="font-semibold">
                      {shift.start_time.slice(0, 5)} — {shift.end_time.slice(0, 5)}
                    </span>
                  </div>
                  {shift.role_type && (
                    <p className="mt-0.5 text-sm text-gray-500">{shift.role_type}</p>
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
      )}

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
