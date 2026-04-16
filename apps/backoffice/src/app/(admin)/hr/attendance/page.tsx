"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, MapPinOff, Clock, Timer, Loader2 } from "lucide-react";
import type { AttendanceLog } from "@/lib/hr/types";

const FLAG_LABELS: Record<string, { label: string; icon: typeof AlertTriangle; color: string }> = {
  outside_geofence: { label: "Outside zone", icon: MapPinOff, color: "text-red-600 bg-red-50" },
  late_arrival: { label: "Late", icon: Clock, color: "text-amber-600 bg-amber-50" },
  no_clock_out: { label: "No clock-out", icon: Timer, color: "text-red-600 bg-red-50" },
  overtime_detected: { label: "OT detected", icon: Clock, color: "text-blue-600 bg-blue-50" },
  no_gps_data: { label: "No GPS", icon: MapPinOff, color: "text-gray-600 bg-gray-50" },
};

export default function AttendanceReviewPage() {
  const { data, mutate } = useFetch<{ logs: AttendanceLog[]; count: number }>("/api/hr/attendance?status=flagged");
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const handleReview = async (id: string, action: "approve" | "reject") => {
    setReviewingId(id);
    try {
      await fetch("/api/hr/attendance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      mutate();
    } finally {
      setReviewingId(null);
    }
  };

  const logs = data?.logs || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Attendance Review</h1>
        <p className="text-sm text-muted-foreground">
          {logs.length} flagged item{logs.length !== 1 ? "s" : ""} need review
        </p>
      </div>

      {logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-16 text-center">
          <CheckCircle2 className="mb-3 h-12 w-12 text-green-500" />
          <p className="text-lg font-semibold">All clear</p>
          <p className="text-sm text-muted-foreground">No flagged attendance items</p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => (
            <div key={log.id} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold">{log.user_id.slice(0, 8)}...</p>
                  <p className="text-sm text-muted-foreground">
                    {new Date(log.clock_in).toLocaleDateString("en-MY")} &middot;{" "}
                    {new Date(log.clock_in).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })}
                    {log.clock_out && (
                      <> &rarr; {new Date(log.clock_out).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })}</>
                    )}
                  </p>
                  {log.total_hours != null && (
                    <p className="text-sm text-muted-foreground">{log.total_hours}h total</p>
                  )}
                </div>
                <div className="flex gap-2">
                  {log.ai_flags.map((flag) => {
                    const info = FLAG_LABELS[flag] || { label: flag, color: "text-gray-600 bg-gray-50" };
                    return (
                      <span key={flag} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${info.color}`}>
                        {info.label}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => handleReview(log.id, "approve")}
                  disabled={reviewingId === log.id}
                  className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {reviewingId === log.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  Approve
                </button>
                <button
                  onClick={() => handleReview(log.id, "reject")}
                  disabled={reviewingId === log.id}
                  className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
