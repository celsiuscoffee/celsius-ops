"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import Link from "next/link";
import { Clock, Plus, Loader2, CheckCircle2, XCircle, AlertTriangle, X, ArrowLeft } from "lucide-react";

type OTRequest = {
  id: string;
  date: string;
  hours_requested: number;
  hours_approved: number | null;
  ot_type: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "partial" | "cancelled";
  rejection_reason: string | null;
  manager_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
};

export default function StaffOTPage() {
  const { data, mutate } = useFetch<{ requests: OTRequest[] }>("/api/hr/overtime");
  const [form, setForm] = useState<null | { date: string; hours: string; ot_type: string; reason: string; start: string; end: string }>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const requests = data?.requests || [];
  const pending = requests.filter(r => r.status === "pending");
  const historic = requests.filter(r => r.status !== "pending");

  const submit = async () => {
    if (!form?.date || !form?.hours || !form?.reason) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/hr/overtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: form.date,
          hours_requested: Number(form.hours),
          ot_type: form.ot_type,
          reason: form.reason,
          shift_start_time: form.start || null,
          shift_end_time: form.end || null,
        }),
      });
      if (res.ok) {
        setResult("Submitted! Manager will review.");
        setForm(null);
        mutate();
      } else {
        const d = await res.json();
        setResult(d.error || "Failed");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async (id: string) => {
    if (!confirm("Cancel this OT request?")) return;
    await fetch(`/api/hr/overtime?id=${id}`, { method: "DELETE" });
    mutate();
  };

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      pending: "bg-amber-100 text-amber-800",
      approved: "bg-green-100 text-green-800",
      rejected: "bg-red-100 text-red-800",
      partial: "bg-blue-100 text-blue-800",
      cancelled: "bg-gray-100 text-gray-600",
    };
    return <span className={`rounded px-2 py-0.5 text-xs font-medium ${map[s] || "bg-gray-100"}`}>{s}</span>;
  };

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-start gap-3">
        <Link
          href="/hr"
          aria-label="Back"
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600 active:scale-95 active:bg-gray-200"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">Overtime Requests</h1>
          <p className="text-xs text-muted-foreground">Submit an OT request before your shift so your extra hours get paid correctly.</p>
        </div>
        <button
          onClick={() => setForm({ date: new Date().toISOString().slice(0, 10), hours: "", ot_type: "1.5x", reason: "", start: "", end: "" })}
          className="flex items-center gap-1 shrink-0 rounded-lg bg-terracotta px-3 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> New OT
        </button>
      </div>

      {result && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{result}</div>
      )}

      {/* Pending */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Pending ({pending.length})</h2>
        {pending.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-white p-4 text-center text-xs text-muted-foreground">
            No pending OT requests
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map(r => (
              <div key={r.id} className="rounded-lg border bg-white p-3">
                <div className="mb-1 flex items-center justify-between">
                  <div className="text-sm font-semibold">{r.date} · {r.hours_requested}h at {r.ot_type}</div>
                  {statusBadge(r.status)}
                </div>
                <p className="text-xs text-gray-600">{r.reason}</p>
                <button onClick={() => cancel(r.id)} className="mt-2 text-xs text-red-600 hover:underline">Cancel</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* History */}
      {historic.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Recent Decisions</h2>
          <div className="space-y-2">
            {historic.map(r => (
              <div key={r.id} className="rounded-lg border bg-white p-3">
                <div className="mb-1 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {r.status === "approved" && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                    {r.status === "rejected" && <XCircle className="h-4 w-4 text-red-600" />}
                    {(r.status === "partial" || r.status === "cancelled") && <AlertTriangle className="h-4 w-4 text-amber-600" />}
                    <span className="text-sm font-semibold">{r.date} · {r.hours_requested}h at {r.ot_type}</span>
                  </div>
                  {statusBadge(r.status)}
                </div>
                <p className="text-xs text-gray-600">{r.reason}</p>
                {r.status === "partial" && r.hours_approved != null && (
                  <p className="mt-1 text-xs text-blue-700">Approved for {r.hours_approved}h (reduced)</p>
                )}
                {r.status === "rejected" && r.rejection_reason && (
                  <p className="mt-1 text-xs text-red-700">Reason: {r.rejection_reason}</p>
                )}
                {r.manager_notes && (
                  <p className="mt-1 text-xs text-gray-500">Manager note: {r.manager_notes}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Submit form modal */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setForm(null)}>
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2"><Clock className="h-5 w-5 text-terracotta" /> New OT Request</h3>
              <button onClick={() => setForm(null)} className="rounded p-1 hover:bg-gray-100"><X className="h-4 w-4" /></button>
            </div>

            <p className="mb-4 rounded-lg bg-blue-50 p-2 text-xs text-blue-800">
              Submit this <strong>before</strong> your shift. Your manager approves → hours get paid at OT rate.
            </p>

            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-gray-700">Date of OT</span>
                <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-base" />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-gray-700">Hours</span>
                  <input type="number" step="0.25" inputMode="decimal" value={form.hours} onChange={e => setForm({ ...form, hours: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-base" placeholder="2" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-gray-700">Rate</span>
                  <select value={form.ot_type} onChange={e => setForm({ ...form, ot_type: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-base">
                    <option value="1x">1x</option>
                    <option value="1.5x">1.5x (normal OT)</option>
                    <option value="2x">2x (rest day)</option>
                    <option value="3x">3x (public holiday)</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-gray-700">Start time (optional)</span>
                  <input type="time" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-base" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-gray-700">End time (optional)</span>
                  <input type="time" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-base" />
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-gray-700">Reason</span>
                <textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} rows={3} className="w-full rounded-lg border px-3 py-2 text-base" placeholder="e.g. Cover for teammate, extra event, high-traffic day" />
              </label>
            </div>

            <button
              onClick={submit}
              disabled={submitting || !form.date || !form.hours || !form.reason}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-terracotta px-4 py-3 text-base font-semibold text-white hover:bg-terracotta-dark disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />} Submit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
