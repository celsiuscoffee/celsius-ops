"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import Link from "next/link";
import { CalendarOff, CheckCircle2, XCircle, Clock, Loader2, Bot, Plus, ArrowLeft } from "lucide-react";
import type { LeaveBalance, LeaveRequest } from "@/lib/hr/types";
import { LEAVE_TYPES } from "@/lib/hr/constants";

export default function LeavePage() {
  const { data, mutate } = useFetch<{ balances: LeaveBalance[]; requests: LeaveRequest[] }>("/api/hr/leave");
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const [form, setForm] = useState({
    leave_type: "annual",
    start_date: "",
    end_date: "",
    reason: "",
  });

  const balances = data?.balances || [];
  const requests = data?.requests || [];

  const totalDays = form.start_date && form.end_date
    ? Math.max(1, Math.ceil((new Date(form.end_date).getTime() - new Date(form.start_date).getTime()) / (1000 * 60 * 60 * 24)) + 1)
    : 0;

  const handleSubmit = async () => {
    if (!form.start_date || !form.end_date) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/hr/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, total_days: totalDays }),
      });
      const data = await res.json();
      if (res.ok) {
        const decision = data.request?.decision || data.request?.ai_decision;
        setResult({
          success: true,
          message: decision === "approve"
            ? "Leave auto-approved by AI!"
            : "Leave submitted for review.",
        });
        setShowForm(false);
        setForm({ leave_type: "annual", start_date: "", end_date: "", reason: "" });
        mutate();
      } else {
        setResult({ success: false, message: data.error || "Failed" });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const statusIcon = (status: string) => {
    if (status === "ai_approved" || status === "approved") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (status === "rejected") return <XCircle className="h-4 w-4 text-red-500" />;
    if (status === "ai_escalated") return <Bot className="h-4 w-4 text-amber-500" />;
    return <Clock className="h-4 w-4 text-gray-400" />;
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
        <h1 className="flex-1 text-2xl font-bold">Leave</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1 rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white"
        >
          <Plus className="h-4 w-4" /> Request
        </button>
      </div>

      {/* Result feedback */}
      {result && (
        <div className={`mb-4 rounded-xl px-4 py-2.5 text-sm font-medium ${
          result.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
        }`}>
          {result.message}
        </div>
      )}

      {/* Leave Request Form */}
      {showForm && (
        <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="mb-3 font-semibold">New Leave Request</h2>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-500">Type</span>
              <select
                value={form.leave_type}
                onChange={(e) => setForm((f) => ({ ...f, leave_type: e.target.value }))}
                className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
              >
                {Object.entries(LEAVE_TYPES).map(([key, val]) => (
                  <option key={key} value={key}>{val.label}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-500">From</span>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-500">To</span>
                <input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
              </label>
            </div>
            {totalDays > 0 && (
              <p className="text-sm font-medium text-terracotta">{totalDays} day{totalDays !== 1 ? "s" : ""}</p>
            )}
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-500">Reason (optional)</span>
              <textarea
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                rows={2}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                placeholder="Why are you taking leave?"
              />
            </label>
            <button
              onClick={handleSubmit}
              disabled={submitting || !form.start_date || !form.end_date}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-terracotta py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Submit Request
            </button>
          </div>
        </div>
      )}

      {/* Leave Balances */}
      {balances.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-gray-500">Balances</h2>
          <div className="grid grid-cols-2 gap-2">
            {balances.map((b) => {
              const typeInfo = LEAVE_TYPES[b.leave_type as keyof typeof LEAVE_TYPES];
              const remaining = Number(b.entitled_days) + Number(b.carried_forward) - Number(b.used_days) - Number(b.pending_days);
              return (
                <div key={b.id} className="rounded-xl border border-gray-100 bg-white p-3">
                  <p className="text-xs font-medium text-gray-500">{typeInfo?.label || b.leave_type}</p>
                  <p className="text-xl font-bold">{remaining}</p>
                  <p className="text-[10px] text-gray-400">of {b.entitled_days} days</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Request History */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-gray-500">History</h2>
        {requests.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 bg-gray-50 py-10 text-center">
            <CalendarOff className="mx-auto mb-2 h-8 w-8 text-gray-300" />
            <p className="text-sm text-gray-400">No leave requests yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {requests.map((req) => (
              <div key={req.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3">
                {statusIcon(req.status)}
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    {LEAVE_TYPES[req.leave_type as keyof typeof LEAVE_TYPES]?.label || req.leave_type}
                  </p>
                  <p className="text-xs text-gray-400">
                    {req.start_date} → {req.end_date} · {req.total_days}d
                  </p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  req.status.includes("approved") ? "bg-green-50 text-green-600" :
                  req.status === "rejected" ? "bg-red-50 text-red-600" :
                  req.status === "ai_escalated" ? "bg-amber-50 text-amber-600" :
                  "bg-gray-50 text-gray-500"
                }`}>
                  {req.status.replace("ai_", "").replace("_", " ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
