"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { Clock, CheckCircle2, XCircle, Loader2, Plus, AlertTriangle, Calendar, X } from "lucide-react";

type OTRequest = {
  id: string;
  user_id: string;
  outlet_id: string | null;
  date: string;
  request_type: "pre_approval" | "post_hoc";
  hours_requested: number;
  hours_approved: number | null;
  ot_type: string;
  reason: string;
  shift_start_time: string | null;
  shift_end_time: string | null;
  status: "pending" | "approved" | "rejected" | "partial" | "cancelled";
  requested_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  manager_notes: string | null;
  created_at: string;
  staff: { id: string; name: string; fullName: string | null } | null;
};

type Employee = { id: string; name: string; fullName: string | null };

export default function OvertimeRequestsPage() {
  const [tab, setTab] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const qs = tab === "all" ? "" : `?status=${tab}`;
  const { data, mutate } = useFetch<{ requests: OTRequest[] }>(`/api/hr/overtime-requests${qs}`);
  const { data: empData } = useFetch<{ employees: Employee[] }>("/api/hr/employees");
  const [reviewing, setReviewing] = useState<OTRequest | null>(null);
  const [newOT, setNewOT] = useState<{ user_id: string; date: string; hours: string; reason: string; ot_type: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const requests = data?.requests || [];
  const employees = empData?.employees || [];

  const review = async (status: "approved" | "rejected" | "partial", hours?: number, reason?: string, notes?: string) => {
    if (!reviewing) return;
    setSaving(true);
    try {
      await fetch("/api/hr/overtime-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: reviewing.id, status, hours_approved: hours, rejection_reason: reason, manager_notes: notes }),
      });
      mutate();
      setReviewing(null);
    } finally {
      setSaving(false);
    }
  };

  const createOT = async () => {
    if (!newOT?.user_id || !newOT?.date || !newOT?.hours || !newOT?.reason) return;
    setSaving(true);
    try {
      await fetch("/api/hr/overtime-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: newOT.user_id,
          date: newOT.date,
          hours_requested: Number(newOT.hours),
          reason: newOT.reason,
          ot_type: newOT.ot_type,
          request_type: "post_hoc",
        }),
      });
      mutate();
      setNewOT(null);
    } finally {
      setSaving(false);
    }
  };

  const statusPill = (s: string) => {
    const map: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800",
      approved: "bg-green-100 text-green-800",
      rejected: "bg-red-100 text-red-800",
      partial: "bg-blue-100 text-blue-800",
      cancelled: "bg-gray-100 text-gray-600",
    };
    return <span className={`rounded px-2 py-0.5 text-xs font-medium ${map[s] || "bg-gray-100"}`}>{s}</span>;
  };

  const counts = {
    pending: requests.filter(r => r.status === "pending").length,
    approved: requests.filter(r => r.status === "approved").length,
    rejected: requests.filter(r => r.status === "rejected").length,
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Overtime Requests</h1>
          <p className="text-sm text-muted-foreground">Pre-approve planned OT, or retroactively approve OT hours logged during attendance review</p>
        </div>
        <button
          onClick={() => setNewOT({ user_id: "", date: new Date().toISOString().slice(0, 10), hours: "", reason: "", ot_type: "1.5x" })}
          className="flex items-center gap-1 rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white hover:bg-terracotta-dark"
        >
          <Plus className="h-4 w-4" /> Post-hoc OT
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {([
          { k: "pending", l: `Pending (${counts.pending})`, icon: AlertTriangle },
          { k: "approved", l: `Approved (${counts.approved})`, icon: CheckCircle2 },
          { k: "rejected", l: `Rejected (${counts.rejected})`, icon: XCircle },
          { k: "all", l: "All", icon: Calendar },
        ] as const).map(t => {
          const Ic = t.icon;
          return (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium -mb-px ${
                tab === t.k ? "border-terracotta text-terracotta" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <Ic className="h-4 w-4" /> {t.l}
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="rounded-xl border bg-card p-4">
        {requests.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Clock className="mx-auto mb-2 h-8 w-8 opacity-30" />
            No {tab === "all" ? "" : tab} OT requests
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Staff</th>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Hours</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Flow</th>
                  <th className="py-2 pr-3">Reason</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {requests.map(r => (
                  <tr key={r.id} className="border-b last:border-b-0 hover:bg-gray-50/50">
                    <td className="py-2.5 pr-3 font-medium">{r.staff?.name || "—"}</td>
                    <td className="py-2.5 pr-3">{r.date}</td>
                    <td className="py-2.5 pr-3">
                      {r.hours_requested}h
                      {r.hours_approved != null && r.status !== "pending" && (
                        <span className="ml-1 text-xs text-gray-500">→ {r.hours_approved}h approved</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-xs">{r.ot_type}</td>
                    <td className="py-2.5 pr-3 text-xs">
                      <span className={r.request_type === "pre_approval" ? "text-blue-700" : "text-purple-700"}>
                        {r.request_type === "pre_approval" ? "pre-approval" : "post-hoc"}
                      </span>
                    </td>
                    <td className="max-w-[240px] truncate py-2.5 pr-3 text-xs text-gray-600" title={r.reason}>{r.reason}</td>
                    <td className="py-2.5 pr-3">{statusPill(r.status)}</td>
                    <td className="py-2.5 pr-3 text-right">
                      {r.status === "pending" && (
                        <button onClick={() => setReviewing(r)} className="rounded bg-terracotta px-3 py-1 text-xs font-medium text-white hover:bg-terracotta-dark">
                          Review
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Review modal */}
      {reviewing && (
        <ReviewModal req={reviewing} onClose={() => setReviewing(null)} onDecide={review} saving={saving} />
      )}

      {/* New post-hoc modal */}
      {newOT && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setNewOT(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Post-hoc OT Request</h3>
              <button onClick={() => setNewOT(null)} className="rounded p-1 hover:bg-gray-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Staff</span>
                <select value={newOT.user_id} onChange={e => setNewOT({ ...newOT, user_id: e.target.value })} className="w-full rounded border px-3 py-2 text-sm">
                  <option value="">— Select —</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Date of OT</span>
                <input type="date" value={newOT.date} onChange={e => setNewOT({ ...newOT, date: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Hours</span>
                  <input type="number" step="0.25" value={newOT.hours} onChange={e => setNewOT({ ...newOT, hours: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">OT Rate</span>
                  <select value={newOT.ot_type} onChange={e => setNewOT({ ...newOT, ot_type: e.target.value })} className="w-full rounded border px-3 py-2 text-sm">
                    <option value="1x">1x (straight)</option>
                    <option value="1.5x">1.5x (standard OT)</option>
                    <option value="2x">2x (rest day)</option>
                    <option value="3x">3x (public holiday OT)</option>
                    <option value="rest_day">Rest day</option>
                    <option value="public_holiday">Public holiday</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Reason</span>
                <textarea value={newOT.reason} onChange={e => setNewOT({ ...newOT, reason: e.target.value })} rows={3} className="w-full rounded border px-3 py-2 text-sm" placeholder="Why was OT needed?" />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setNewOT(null)} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
              <button onClick={createOT} disabled={saving || !newOT.user_id || !newOT.date || !newOT.hours || !newOT.reason} className="flex items-center gap-1 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create & Review
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewModal({ req, onClose, onDecide, saving }: {
  req: OTRequest;
  onClose: () => void;
  onDecide: (status: "approved" | "rejected" | "partial", hours?: number, reason?: string, notes?: string) => void;
  saving: boolean;
}) {
  const [hours, setHours] = useState(String(req.hours_requested));
  const [notes, setNotes] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Review OT Request</h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="mb-4 rounded-lg bg-gray-50 p-3 text-sm">
          <div className="font-semibold">{req.staff?.name}</div>
          <div className="mt-1 text-xs text-gray-600">
            {req.date} · <strong>{req.hours_requested}h</strong> at <strong>{req.ot_type}</strong> rate · {req.request_type === "pre_approval" ? "Pre-approval" : "Post-hoc (after attendance)"}
          </div>
          <p className="mt-2 text-sm">{req.reason}</p>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Hours to approve (partial reduces)</span>
            <input type="number" step="0.25" value={hours} onChange={e => setHours(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Manager notes (optional)</span>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full rounded border px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Rejection reason (only if rejecting)</span>
            <input value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" placeholder="e.g. No prior approval sought" />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
          <button
            onClick={() => onDecide("rejected", 0, rejectionReason || "Rejected", notes)}
            disabled={saving}
            className="flex items-center gap-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Reject
          </button>
          <button
            onClick={() => onDecide("partial", Number(hours), undefined, notes)}
            disabled={saving || Number(hours) <= 0 || Number(hours) >= req.hours_requested}
            className="flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Partial ({hours}h)
          </button>
          <button
            onClick={() => onDecide("approved", Number(hours), undefined, notes)}
            disabled={saving}
            className="flex items-center gap-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve
          </button>
        </div>
      </div>
    </div>
  );
}
