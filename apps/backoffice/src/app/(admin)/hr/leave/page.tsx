"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { CalendarOff, CheckCircle2, XCircle, Loader2, Bot } from "lucide-react";
import type { LeaveRequest } from "@/lib/hr/types";

export default function LeaveReviewPage() {
  const [filter, setFilter] = useState("ai_escalated");
  const { data, mutate } = useFetch<{ requests: LeaveRequest[] }>(`/api/hr/leave?status=${filter}`);
  const [actioning, setActioning] = useState<string | null>(null);

  const requests = data?.requests || [];

  const handleAction = async (id: string, action: "approve" | "reject") => {
    setActioning(id);
    try {
      await fetch("/api/hr/leave", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      mutate();
    } finally {
      setActioning(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Leave Requests</h1>
          <p className="text-sm text-muted-foreground">{requests.length} request{requests.length !== 1 ? "s" : ""}</p>
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-lg border bg-background px-3 py-2 text-sm"
        >
          <option value="ai_escalated">Escalated (need review)</option>
          <option value="pending">Pending</option>
          <option value="ai_approved">AI Approved</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
      </div>

      {requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-16 text-center">
          <CheckCircle2 className="mb-3 h-12 w-12 text-green-500" />
          <p className="text-lg font-semibold">All clear</p>
          <p className="text-sm text-muted-foreground">No leave requests need review</p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => (
            <div key={req.id} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{req.user_id.slice(0, 8)}...</p>
                    <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700">
                      {req.leave_type}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      req.status === "ai_escalated" ? "bg-amber-100 text-amber-700" :
                      req.status === "ai_approved" ? "bg-green-100 text-green-700" :
                      req.status === "approved" ? "bg-green-100 text-green-700" :
                      req.status === "rejected" ? "bg-red-100 text-red-700" :
                      "bg-gray-100 text-gray-600"
                    }`}>
                      {req.status.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {req.start_date} → {req.end_date} ({req.total_days} day{Number(req.total_days) !== 1 ? "s" : ""})
                  </p>
                  {req.reason && <p className="mt-1 text-sm">{req.reason}</p>}
                  {req.ai_reason && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <Bot className="h-3 w-3" /> {req.ai_reason}
                    </p>
                  )}
                </div>
              </div>
              {(req.status === "ai_escalated" || req.status === "pending") && (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleAction(req.id, "approve")}
                    disabled={actioning === req.id}
                    className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {actioning === req.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                    Approve
                  </button>
                  <button
                    onClick={() => handleAction(req.id, "reject")}
                    disabled={actioning === req.id}
                    className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    <XCircle className="h-3 w-3" /> Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
