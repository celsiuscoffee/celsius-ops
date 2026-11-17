"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { CheckCircle2, XCircle, Loader2, Bot, Ban } from "lucide-react";
import { toast, useConfirm, usePrompt } from "@celsius/ui";
import { HrPageHeader } from "@/components/hr/page-header";
import type { LeaveRequest } from "@/lib/hr/types";

type EnrichedLeaveRequest = LeaveRequest & { user_name?: string | null; outlet_name?: string | null };

export default function LeaveReviewPage() {
  // Open the page on what needs a decision. "All" buried the two August 2026
  // sick-leave requests that the AI never processed among a month of history.
  const [filter, setFilter] = useState("needs_review");
  const { data, mutate } = useFetch<{ requests: EnrichedLeaveRequest[] }>(`/api/hr/leave?status=${filter === "needs_review" ? "all" : filter}`);
  const [actioning, setActioning] = useState<string | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();
  const { prompt, PromptDialog } = usePrompt();

  const requests = (data?.requests || []).filter((r) =>
    filter === "needs_review" ? r.status === "pending" || r.status === "ai_escalated" : true,
  );

  const handleAction = async (id: string, action: "approve" | "reject" | "cancel", reason?: string) => {
    setActioning(id);
    try {
      const res = await fetch("/api/hr/leave", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, ...(reason ? { reason } : {}) }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) { toast.error(j?.error ?? `Failed (${res.status}) — nothing was changed.`); return; }
      toast.success(
        action === "approve" ? "Leave approved"
          : action === "reject" ? "Leave rejected"
          : j?.restored_days ? `Leave cancelled — ${j.restored_days} day(s) restored to the balance`
          : "Leave cancelled",
      );
      mutate();
    } catch {
      toast.error("Network error — nothing was changed.");
    } finally {
      setActioning(null);
    }
  };

  // Cancel: a pending request just needs a confirm (releases the hold); an
  // approved one is a balance restore, so it asks for a reason (owner/admin —
  // the API refuses managers and says so).
  const handleCancel = async (req: EnrichedLeaveRequest) => {
    const approved = req.status === "approved" || req.status === "ai_approved";
    if (approved) {
      const reason = await prompt({
        title: "Cancel approved leave?",
        description: `${req.total_days} day(s) will be returned to the ${req.leave_type} balance. Only an owner/admin can do this.`,
        placeholder: "Why is this leave being cancelled? (e.g. staff came to work)",
        required: true,
        confirmLabel: "Cancel leave",
      });
      if (reason === null) return;
      await handleAction(req.id, "cancel", reason);
      return;
    }
    const ok = await confirm({
      title: "Cancel this leave request?",
      description: "The request is withdrawn without a decision and the held days are released.",
      confirmLabel: "Cancel request",
      cancelLabel: "Keep it",
      destructive: true,
    });
    if (!ok) return;
    await handleAction(req.id, "cancel");
  };

  return (
    <div className="space-y-6 px-4 pt-6 pb-10 md:px-8">
      <ConfirmDialog />
      <PromptDialog />
      <HrPageHeader
        title="Leave requests"
        description={`Who wants time off, and what waits for your decision. ${requests.length} request${requests.length !== 1 ? "s" : ""} shown.`}
        action={
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-10 rounded-ctl border border-line bg-surface px-3 text-sm text-text"
          >
            <option value="needs_review">Needs review</option>
            <option value="all">All</option>
            <option value="ai_escalated">Escalated (need review)</option>
            <option value="pending">Pending</option>
            <option value="ai_approved">AI Approved</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        }
      />

      {requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-16 text-center">
          <CheckCircle2 className="mb-3 h-12 w-12 text-ok-text" />
          <p className="text-lg font-semibold">All clear</p>
          <p className="text-sm text-text-3">No leave requests need review</p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => (
            <div key={req.id} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{req.user_name || req.user_id.slice(0, 8) + "…"}</p>
                    {req.outlet_name && (
                      <span className="text-xs text-text-3">· {req.outlet_name}</span>
                    )}
                    <span className="rounded-full bg-info-soft px-2 py-0.5 text-[10px] font-medium text-info-text">
                      {req.leave_type}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      req.status === "ai_escalated" ? "bg-warn-soft text-warn-text" :
                      req.status === "ai_approved" ? "bg-ok-soft text-ok-text" :
                      req.status === "approved" ? "bg-ok-soft text-ok-text" :
                      req.status === "rejected" ? "bg-danger-soft text-danger-text" :
                      "bg-sunken text-text-2"
                    }`}>
                      {req.status.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-sm text-text-3">
                    {req.start_date} → {req.end_date} ({req.total_days} day{Number(req.total_days) !== 1 ? "s" : ""})
                  </p>
                  {req.reason && <p className="mt-1 text-sm">{req.reason}</p>}
                  {req.ai_reason && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-text-3">
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
                    className="flex items-center gap-1 rounded-lg bg-ok px-3 py-1.5 text-xs font-medium text-white hover:bg-ok disabled:opacity-50"
                  >
                    {actioning === req.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                    Approve
                  </button>
                  <button
                    onClick={() => handleAction(req.id, "reject")}
                    disabled={actioning === req.id}
                    className="flex items-center gap-1 rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white hover:bg-danger disabled:opacity-50"
                  >
                    <XCircle className="h-3 w-3" /> Reject
                  </button>
                  <button
                    onClick={() => handleCancel(req)}
                    disabled={actioning === req.id}
                    className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium text-text-3 hover:bg-sunken disabled:opacity-50"
                    title="Withdraw without a decision (releases the held days)"
                  >
                    <Ban className="h-3 w-3" /> Cancel
                  </button>
                </div>
              )}
              {(req.status === "approved" || req.status === "ai_approved") && (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleCancel(req)}
                    disabled={actioning === req.id}
                    className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium text-text-3 hover:bg-sunken disabled:opacity-50"
                    title="Cancel this approved leave and return the days to the balance (owner/admin)"
                  >
                    {actioning === req.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                    Cancel leave
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
