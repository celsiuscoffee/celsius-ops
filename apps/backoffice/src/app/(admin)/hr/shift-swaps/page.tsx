"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { ArrowLeftRight, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast, usePrompt } from "@celsius/ui";
import { HrPageHeader } from "@/components/hr/page-header";

type SwapRequest = {
  id: string;
  status: string;
  reason: string | null;
  created_at: string;
  requester_id: string;
  target_id: string;
  requester_name: string;
  target_name: string;
  requester_shift: { shift_date: string; start_time: string; end_time: string } | null;
  target_shift: { shift_date: string; start_time: string; end_time: string } | null;
  rejection_reason: string | null;
  approved_at: string | null;
  approved_by: string | null;
};

const STATUSES = [
  "actionable",       // pending_consent + pending_approval — default
  "pending_consent",  // target hasn't replied yet
  "pending_approval", // target consented, awaiting admin
  "approved",
  "rejected",
  "consent_declined",
  "cancelled",
  "all",
] as const;
const STATUS_LABEL: Record<typeof STATUSES[number], string> = {
  actionable: "Awaiting action",
  pending_consent: "Awaiting target consent",
  pending_approval: "Awaiting admin approval",
  approved: "Approved",
  rejected: "Rejected",
  consent_declined: "Target declined",
  cancelled: "Cancelled",
  all: "All",
};

export default function ShiftSwapsPage() {
  const [filter, setFilter] = useState<typeof STATUSES[number]>("actionable");
  const { data, mutate } = useFetch<{ requests: SwapRequest[] }>(`/api/hr/shift-swaps?status=${filter}`);
  const requests = data?.requests || [];

  const { prompt, PromptDialog } = usePrompt();
  const [acting, setActing] = useState<string | null>(null);
  const decide = async (id: string, action: "approve" | "reject") => {
    let rejectionReason: string | null = null;
    if (action === "reject") {
      rejectionReason = await prompt({
        title: "Reason for rejection",
        description: "Shown to the staff who requested the swap.",
        placeholder: "e.g. coverage gap on Tue evening",
        multiline: true,
        required: true,
      });
      if (rejectionReason === null) return; // cancelled
    }
    setActing(id);
    try {
      const res = await fetch("/api/hr/shift-swaps", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ swap_id: id, action, rejection_reason: rejectionReason }),
      });
      const body = await res.json();
      if (!res.ok) toast.error(body.error || "Failed");
      else {
        toast.success(action === "approve" ? "Swap approved — shifts updated" : "Swap rejected");
        mutate();
      }
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="space-y-6 px-4 pt-6 pb-10 md:px-8">
      <PromptDialog />
      <HrPageHeader
        title="Shift swaps"
        icon={<ArrowLeftRight className="h-6 w-6 text-brand-text" />}
        description="Staff who agreed to swap shifts, waiting for a manager. Approving swaps the two shifts; decline if it leaves a shift short."
        action={
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof STATUSES[number])}
            className="h-10 rounded-ctl border border-line bg-surface px-3 text-sm text-text"
          >
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        }
      />

      {requests.length === 0 ? (
        <p className="rounded-lg border bg-sunken p-12 text-center text-sm text-text-3">
          No {STATUS_LABEL[filter].toLowerCase()} requests.
        </p>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <div key={r.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-3">{new Date(r.created_at).toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</div>
                  <div className="mt-0.5 text-sm">
                    <strong>{r.requester_name}</strong>
                    {" wants to swap with "}
                    <strong>{r.target_name}</strong>
                  </div>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                  r.status === "approved" ? "bg-ok-soft text-ok-text"
                  : (r.status === "rejected" || r.status === "consent_declined") ? "bg-danger-soft text-danger-text"
                  : r.status === "pending_approval" ? "bg-warn-soft text-warn-text"
                  : r.status === "pending_consent" ? "bg-info-soft text-info-text"
                  : "bg-sunken text-text-2"
                }`}>{r.status.replace(/_/g, " ")}</span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div className="rounded border p-2">
                  <div className="font-medium text-text-2">{r.requester_name}&apos;s shift</div>
                  {r.requester_shift ? (
                    <div className="mt-1 font-mono">{r.requester_shift.shift_date} · {r.requester_shift.start_time}–{r.requester_shift.end_time}</div>
                  ) : <div className="mt-1 italic text-danger-text">Shift no longer exists</div>}
                </div>
                <div className="rounded border p-2">
                  <div className="font-medium text-text-2">{r.target_name}&apos;s shift</div>
                  {r.target_shift ? (
                    <div className="mt-1 font-mono">{r.target_shift.shift_date} · {r.target_shift.start_time}–{r.target_shift.end_time}</div>
                  ) : <div className="mt-1 italic text-danger-text">Shift no longer exists</div>}
                </div>
              </div>

              {r.reason && <p className="mt-2 text-xs text-text-3">Reason: {r.reason}</p>}
              {r.rejection_reason && <p className="mt-2 text-xs text-danger-text">Rejected: {r.rejection_reason}</p>}

              {(r.status === "pending_consent" || r.status === "pending_approval") && (
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    onClick={() => decide(r.id, "reject")}
                    disabled={acting === r.id}
                    className="flex items-center gap-1 rounded-lg border border-danger/30 bg-danger-soft px-3 py-1.5 text-xs font-medium text-danger-text hover:bg-danger-soft disabled:opacity-50"
                  >
                    {acting === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                    Reject
                  </button>
                  {/* Approve only after target consents — otherwise the swap isn't bilateral. */}
                  {r.status === "pending_approval" && (
                    <button
                      onClick={() => decide(r.id, "approve")}
                      disabled={acting === r.id}
                      className="flex items-center gap-1 rounded-lg bg-ok px-3 py-1.5 text-xs font-medium text-white hover:bg-ok disabled:opacity-50"
                    >
                      {acting === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                      Approve & Swap
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
