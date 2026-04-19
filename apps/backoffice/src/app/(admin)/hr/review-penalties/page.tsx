"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Star, Loader2, CheckCircle2, XCircle, RefreshCw, AlertTriangle } from "lucide-react";

type Attributed = { id: string; name: string | null; fullName: string | null };
type Suggested = { user_id: string; name: string | null; fullName: string | null; source?: "attendance" | "schedule" };

type ReviewPenalty = {
  id: string;
  gbp_review_id: string;
  outlet_id: string;
  outletName: string | null;
  review_date: string;
  rating: number;
  review_text: string | null;
  reviewer_name: string | null;
  status: "pending" | "applied" | "dismissed";
  attributed_user_ids: string[];
  attributed: Attributed[];
  suggestedAttribution: Suggested[];
  penalty_amount: number;
  reviewed_by: string | null;
  reviewed_at: string | null;
  dismiss_reason: string | null;
  created_at: string;
};

export default function ReviewPenaltiesPage() {
  const [tab, setTab] = useState<"pending" | "applied" | "dismissed">("pending");
  const { data, mutate, isLoading } = useFetch<{ items: ReviewPenalty[] }>(`/api/hr/review-penalties?status=${tab}`);
  const [reviewing, setReviewing] = useState<ReviewPenalty | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState<string>("50");
  const [dismissReason, setDismissReason] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const items = data?.items || [];

  const openReview = (rp: ReviewPenalty) => {
    setReviewing(rp);
    setSelectedUsers(new Set(rp.suggestedAttribution.map((s) => s.user_id)));
    setAmount(String(rp.penalty_amount || 50));
    setDismissReason("");
  };

  const toggleUser = (uid: string) => {
    setSelectedUsers((prev) => {
      const n = new Set(prev);
      if (n.has(uid)) n.delete(uid);
      else n.add(uid);
      return n;
    });
  };

  const apply = async () => {
    if (!reviewing || selectedUsers.size === 0) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/review-penalties/${reviewing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "apply",
          userIds: Array.from(selectedUsers),
          penaltyAmount: Number(amount),
        }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        alert(error || "Failed to apply");
        return;
      }
      mutate();
      setReviewing(null);
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    if (!reviewing) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/review-penalties/${reviewing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss", dismissReason }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        alert(error || "Failed to dismiss");
        return;
      }
      mutate();
      setReviewing(null);
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/hr/review-penalties/sync", { method: "POST" });
      const body = await res.json();
      if (res.ok) {
        alert(`Sync: ${body.created} new, ${body.autoDismissed} auto-dismissed${body.errors?.length ? ` (${body.errors.length} errors)` : ""}`);
        mutate();
      } else {
        alert(body.error || "Sync failed");
      }
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Review Penalties</h1>
          <p className="text-sm text-gray-600">Review 1–2★ Google reviews and attribute penalties to responsible staff.</p>
        </div>
        <button
          onClick={sync}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Sync from GBP
        </button>
      </div>

      <div className="flex gap-2 mb-4 border-b">
        {(["pending", "applied", "dismissed"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 capitalize border-b-2 ${tab === t ? "border-amber-600 font-semibold" : "border-transparent text-gray-600"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {isLoading && <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin inline" /></div>}

      {!isLoading && items.length === 0 && (
        <div className="py-10 text-center text-gray-500">No {tab} review penalties.</div>
      )}

      <div className="space-y-3">
        {items.map((rp) => (
          <div key={rp.id} className="border rounded-lg p-4 bg-white">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className={`w-4 h-4 ${i < rp.rating ? "fill-amber-400 text-amber-400" : "text-gray-300"}`} />
                    ))}
                  </div>
                  <span className="font-medium">{rp.reviewer_name || "Anonymous"}</span>
                  <span className="text-xs text-gray-500">• {rp.outletName}</span>
                  <span className="text-xs text-gray-500">• {rp.review_date}</span>
                </div>
                {rp.review_text && (
                  <p className="text-sm text-gray-700 mb-2 italic">&ldquo;{rp.review_text}&rdquo;</p>
                )}
                {rp.status === "pending" && rp.suggestedAttribution.length > 0 && (
                  <p className="text-xs text-gray-500">
                    {rp.suggestedAttribution[0]?.source === "schedule" ? "Scheduled that day" : "On shift at review time"}:{" "}
                    {rp.suggestedAttribution.map((s) => s.fullName || s.name).join(", ")}
                  </p>
                )}
                {rp.status === "applied" && (
                  <p className="text-xs text-green-700">
                    <CheckCircle2 className="w-3 h-3 inline mr-1" />
                    Applied RM{rp.penalty_amount} to: {rp.attributed.map((a) => a.fullName || a.name).join(", ")}
                  </p>
                )}
                {rp.status === "dismissed" && (
                  <p className="text-xs text-gray-500">
                    <XCircle className="w-3 h-3 inline mr-1" />
                    Dismissed{rp.dismiss_reason ? `: ${rp.dismiss_reason}` : ""}
                  </p>
                )}
              </div>
              {rp.status === "pending" && (
                <button
                  onClick={() => openReview(rp)}
                  className="px-3 py-1.5 rounded bg-amber-600 text-white text-sm hover:bg-amber-700"
                >
                  Review
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Review modal */}
      {reviewing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full max-h-[90vh] overflow-auto p-6">
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-lg font-bold">Review Penalty</h2>
              <button onClick={() => setReviewing(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span className="font-medium">{reviewing.rating}★ review at {reviewing.outletName}</span>
              </div>
              <p className="text-sm text-gray-700 italic">
                {reviewing.review_text ? `"${reviewing.review_text}"` : "(no text)"}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {reviewing.reviewer_name || "Anonymous"} • {reviewing.review_date}
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Attribute to staff on shift that day:</label>
              <p className="text-xs text-gray-500 mb-2">
                {reviewing.suggestedAttribution[0]?.source === "schedule"
                  ? "No attendance logs for that day — showing scheduled staff."
                  : "Staff who were clocked in at the moment this review was posted."}
              </p>
              {reviewing.suggestedAttribution.length === 0 ? (
                <p className="text-sm text-gray-500">No staff on shift that day.</p>
              ) : (
                <div className="space-y-2">
                  {reviewing.suggestedAttribution.map((s) => (
                    <label key={s.user_id} className="flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={selectedUsers.has(s.user_id)}
                        onChange={() => toggleUser(s.user_id)}
                      />
                      <span>{s.fullName || s.name}</span>
                      {s.source === "attendance" && (
                        <span className="ml-auto text-[10px] text-green-700 bg-green-50 px-1.5 py-0.5 rounded">clocked in</span>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Penalty amount per staff (RM):</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full border rounded px-3 py-2"
                min="0"
                step="0.01"
              />
              <p className="text-xs text-gray-500 mt-1">
                Edit if splitting across staff (e.g. RM50 ÷ {selectedUsers.size || 1} = RM{((Number(amount) || 0) / Math.max(1, selectedUsers.size)).toFixed(2)} each — but penalty shown is per-staff.)
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Or dismiss with reason:</label>
              <input
                type="text"
                value={dismissReason}
                onChange={(e) => setDismissReason(e.target.value)}
                placeholder="e.g. Complaint was about product, not staff"
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={dismiss}
                disabled={busy}
                className="px-4 py-2 rounded border text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Dismiss
              </button>
              <button
                onClick={apply}
                disabled={busy || selectedUsers.size === 0}
                className="px-4 py-2 rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {busy ? "Saving…" : `Apply to ${selectedUsers.size} staff`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
