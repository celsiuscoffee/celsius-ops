"use client";

import { useState } from "react";
import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";
import { ArrowLeft, ArrowLeftRight, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "@celsius/ui";

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

const STATUSES = ["pending", "consented", "approved", "rejected", "cancelled", "all"] as const;

export default function ShiftSwapsPage() {
  const [filter, setFilter] = useState<typeof STATUSES[number]>("pending");
  const { data, mutate } = useFetch<{ requests: SwapRequest[] }>(`/api/hr/shift-swaps?status=${filter}`);
  const requests = data?.requests || [];

  const [acting, setActing] = useState<string | null>(null);
  const decide = async (id: string, action: "approve" | "reject") => {
    setActing(id);
    let rejectionReason: string | null = null;
    if (action === "reject") {
      rejectionReason = prompt("Reason for rejection (shown to staff)") || null;
    }
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
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/hr" className="text-xs text-muted-foreground hover:underline">
            <ArrowLeft className="inline h-3 w-3" /> HR
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ArrowLeftRight className="h-6 w-6 text-terracotta" /> Shift Swap Requests
          </h1>
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof STATUSES[number])}
          className="rounded-lg border bg-background px-3 py-1.5 text-sm"
        >
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <p className="text-sm text-muted-foreground">
        Approving a request swaps the user_id on both shifts. Reject if the swap creates coverage gaps.
      </p>

      {requests.length === 0 ? (
        <p className="rounded-lg border bg-muted/10 p-12 text-center text-sm text-muted-foreground">
          No {filter} requests.
        </p>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <div key={r.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("en-MY")}</div>
                  <div className="mt-0.5 text-sm">
                    <strong>{r.requester_name}</strong>
                    {" wants to swap with "}
                    <strong>{r.target_name}</strong>
                  </div>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                  r.status === "approved" ? "bg-emerald-100 text-emerald-700"
                  : r.status === "rejected" ? "bg-red-100 text-red-700"
                  : r.status === "pending" ? "bg-amber-100 text-amber-800"
                  : "bg-gray-100 text-gray-600"
                }`}>{r.status}</span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div className="rounded border p-2">
                  <div className="font-medium text-gray-600">{r.requester_name}'s shift</div>
                  {r.requester_shift ? (
                    <div className="mt-1 font-mono">{r.requester_shift.shift_date} · {r.requester_shift.start_time}–{r.requester_shift.end_time}</div>
                  ) : <div className="mt-1 italic text-red-600">Shift no longer exists</div>}
                </div>
                <div className="rounded border p-2">
                  <div className="font-medium text-gray-600">{r.target_name}'s shift</div>
                  {r.target_shift ? (
                    <div className="mt-1 font-mono">{r.target_shift.shift_date} · {r.target_shift.start_time}–{r.target_shift.end_time}</div>
                  ) : <div className="mt-1 italic text-red-600">Shift no longer exists</div>}
                </div>
              </div>

              {r.reason && <p className="mt-2 text-xs text-muted-foreground">Reason: {r.reason}</p>}
              {r.rejection_reason && <p className="mt-2 text-xs text-red-600">Rejected: {r.rejection_reason}</p>}

              {(r.status === "pending" || r.status === "consented") && (
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    onClick={() => decide(r.id, "reject")}
                    disabled={acting === r.id}
                    className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                  >
                    {acting === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                    Reject
                  </button>
                  <button
                    onClick={() => decide(r.id, "approve")}
                    disabled={acting === r.id}
                    className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {acting === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                    Approve & Swap
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
