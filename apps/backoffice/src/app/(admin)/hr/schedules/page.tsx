"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { Bot, CalendarDays, Send, Loader2, CheckCircle2, ArrowLeftRight, XCircle } from "lucide-react";
import type { Schedule } from "@/lib/hr/types";

type ScheduleWithShifts = Schedule & { outlet_name?: string };

type SwapRequest = {
  id: string;
  status: string;
  reason: string | null;
  requester_id: string;
  target_id: string;
  requester_shift: { shift_date: string; start_time: string; end_time: string; user_id: string } | null;
  target_shift: { shift_date: string; start_time: string; end_time: string; user_id: string } | null;
  created_at: string;
};

export default function SchedulesPage() {
  const [selectedOutlet, setSelectedOutlet] = useState<string>("");
  const [weekStart, setWeekStart] = useState(() => getNextMonday());
  const { data, mutate } = useFetch<{ schedules: ScheduleWithShifts[]; outlets: { id: string; name: string }[] }>("/api/hr/schedules");
  const { data: swapData, mutate: mutateSwaps } = useFetch<{ swaps: SwapRequest[] }>("/api/hr/swap");
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [swapAction, setSwapAction] = useState<string | null>(null);
  const [result, setResult] = useState<{ shifts: number; totalHours: number; estimatedCost: number; notes: string[] } | null>(null);

  const outlets = data?.outlets || [];
  const schedules = data?.schedules || [];
  const pendingSwaps = swapData?.swaps || [];

  const handleGenerate = async () => {
    if (!selectedOutlet) return;
    setGenerating(true);
    setResult(null);
    try {
      const res = await fetch("/api/hr/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", outlet_id: selectedOutlet, week_start: weekStart }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult(data);
        mutate();
      } else {
        setResult({ shifts: 0, totalHours: 0, estimatedCost: 0, notes: [data.error || "Failed"] });
      }
    } finally {
      setGenerating(false);
    }
  };

  const handlePublish = async (scheduleId: string) => {
    setPublishing(scheduleId);
    try {
      await fetch("/api/hr/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish", schedule_id: scheduleId }),
      });
      mutate();
    } finally {
      setPublishing(null);
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
    } finally {
      setSwapAction(null);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Schedules</h1>

      {/* Pending Swap Approvals */}
      {pendingSwaps.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-amber-800">
            <ArrowLeftRight className="h-5 w-5" />
            Shift Swap Requests ({pendingSwaps.length})
          </h2>
          <div className="space-y-3">
            {pendingSwaps.map((swap) => (
              <div key={swap.id} className="rounded-lg bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="text-sm">
                    <p className="font-medium">
                      {swap.requester_id.slice(0, 8)}... wants to swap with {swap.target_id.slice(0, 8)}...
                    </p>
                    <p className="text-muted-foreground">
                      {swap.requester_shift?.shift_date} {swap.requester_shift?.start_time?.slice(0, 5)}-{swap.requester_shift?.end_time?.slice(0, 5)}
                      {" ↔ "}
                      {swap.target_shift?.shift_date} {swap.target_shift?.start_time?.slice(0, 5)}-{swap.target_shift?.end_time?.slice(0, 5)}
                    </p>
                    {swap.reason && <p className="text-xs text-gray-500 mt-1">{swap.reason}</p>}
                    <p className="text-[10px] text-gray-400 mt-1">Both parties consented</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSwap(swap.id, "approve")}
                      disabled={swapAction === swap.id}
                      className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {swapAction === swap.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                      Approve
                    </button>
                    <button
                      onClick={() => handleSwap(swap.id, "reject")}
                      disabled={swapAction === swap.id}
                      className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      <XCircle className="h-3 w-3" /> Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Schedule Generator */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 flex items-center gap-2 font-semibold">
          <Bot className="h-5 w-5 text-terracotta" />
          AI Schedule Generator
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Outlet</span>
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
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Week Starting</span>
            <input
              type="date"
              value={weekStart}
              onChange={(e) => setWeekStart(e.target.value)}
              className="rounded-lg border bg-background px-3 py-2 text-sm"
            />
          </label>
          <button
            onClick={handleGenerate}
            disabled={generating || !selectedOutlet}
            className="flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
            Generate Schedule
          </button>
        </div>

        {result && (
          <div className="mt-4 rounded-lg bg-muted/50 p-3 text-sm">
            <p className="font-medium">{result.shifts} shifts generated · {result.totalHours}h total · RM {result.estimatedCost.toLocaleString()}</p>
            {result.notes.map((n, i) => (
              <p key={i} className="text-muted-foreground">{n}</p>
            ))}
          </div>
        )}
      </div>

      {/* Schedules List */}
      <div className="space-y-3">
        {schedules.map((sched) => {
          const outletName = outlets.find((o) => o.id === sched.outlet_id)?.name || sched.outlet_id;
          const isAiGenerated = sched.status === "ai_generated";
          const isPublished = sched.status === "published";

          return (
            <div key={sched.id} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{outletName}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      isPublished ? "bg-green-100 text-green-700" :
                      isAiGenerated ? "bg-blue-100 text-blue-700" :
                      "bg-gray-100 text-gray-600"
                    }`}>
                      {sched.status.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {sched.week_start} → {sched.week_end} · {sched.total_labor_hours}h · RM {Number(sched.estimated_labor_cost || 0).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  {isAiGenerated && (
                    <button
                      onClick={() => handlePublish(sched.id)}
                      disabled={publishing === sched.id}
                      className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {publishing === sched.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                      Publish
                    </button>
                  )}
                  {isPublished && <CheckCircle2 className="h-5 w-5 text-green-500" />}
                </div>
              </div>
              {sched.ai_notes && (
                <p className="mt-2 text-xs text-muted-foreground whitespace-pre-line">{sched.ai_notes}</p>
              )}
            </div>
          );
        })}

        {schedules.length === 0 && (
          <div className="rounded-xl border bg-card py-16 text-center">
            <CalendarDays className="mx-auto mb-3 h-12 w-12 text-gray-300" />
            <p className="text-lg font-semibold">No schedules yet</p>
            <p className="text-sm text-muted-foreground">Use the AI generator above to create one</p>
          </div>
        )}
      </div>
    </div>
  );
}

function getNextMonday(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  const next = new Date(now);
  next.setDate(now.getDate() + diff);
  return next.toISOString().slice(0, 10);
}
