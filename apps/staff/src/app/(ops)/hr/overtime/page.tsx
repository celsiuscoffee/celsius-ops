"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { HRPageHeader } from "@/components/hr-page-header";
import { Clock, Plus, Loader2, CheckCircle2, XCircle, AlertTriangle, X } from "lucide-react";
import { FetchError } from "@/components/fetch-error";

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
  const { data, error, mutate } = useFetch<{ requests: OTRequest[] }>("/api/hr/overtime");
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
      pending: "bg-warn-soft text-warn-text",
      approved: "bg-ok-soft text-ok-text",
      rejected: "bg-danger-soft text-danger-text",
      partial: "bg-info-soft text-info-text",
      cancelled: "bg-sunken text-text-2",
    };
    return <span className={`rounded px-2 py-0.5 text-xs font-medium ${map[s] || "bg-sunken"}`}>{s}</span>;
  };

  return (
    <div className="space-y-5 px-4 pb-6">
      <HRPageHeader
        title="Overtime"
        subtitle="Ask before the shift so the extra hours are paid right."
        right={
          <button
            onClick={() => setForm({ date: new Date().toISOString().slice(0, 10), hours: "", ot_type: "1.5x", reason: "", start: "", end: "" })}
            className="flex min-h-11 items-center gap-1 shrink-0 rounded-ctl bg-ink px-3.5 text-sm font-medium text-on-ink"
          >
            <Plus className="h-4 w-4" /> Ask
          </button>
        }
      />

      {result && (
        <div className="rounded-lg border border-ok/30 bg-ok-soft p-3 text-sm text-ok-text">{result}</div>
      )}

      {!data && error && (
        <FetchError error={error} onRetry={() => mutate()} what="your OT requests" />
      )}

      {/* Pending */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-text-2">Pending ({pending.length})</h2>
        {pending.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-surface p-4 text-center text-xs text-muted-foreground">
            No pending OT requests
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map(r => (
              <div key={r.id} className="rounded-lg border bg-surface p-3">
                <div className="mb-1 flex items-center justify-between">
                  <div className="text-sm font-semibold">{r.date} · {r.hours_requested}h at {r.ot_type}</div>
                  {statusBadge(r.status)}
                </div>
                <p className="text-xs text-text-2">{r.reason}</p>
                <button onClick={() => cancel(r.id)} className="mt-2 text-xs text-danger-text hover:underline">Cancel</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* History */}
      {historic.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-text-2">Recent decisions</h2>
          <div className="space-y-2">
            {historic.map(r => (
              <div key={r.id} className="rounded-lg border bg-surface p-3">
                <div className="mb-1 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {r.status === "approved" && <CheckCircle2 className="h-4 w-4 text-ok-text" />}
                    {r.status === "rejected" && <XCircle className="h-4 w-4 text-danger-text" />}
                    {(r.status === "partial" || r.status === "cancelled") && <AlertTriangle className="h-4 w-4 text-warn-text" />}
                    <span className="text-sm font-semibold">{r.date} · {r.hours_requested}h at {r.ot_type}</span>
                  </div>
                  {statusBadge(r.status)}
                </div>
                <p className="text-xs text-text-2">{r.reason}</p>
                {r.status === "partial" && r.hours_approved != null && (
                  <p className="mt-1 text-xs text-info-text">Approved for {r.hours_approved}h (reduced)</p>
                )}
                {r.status === "rejected" && r.rejection_reason && (
                  <p className="mt-1 text-xs text-danger-text">Reason: {r.rejection_reason}</p>
                )}
                {r.manager_notes && (
                  <p className="mt-1 text-xs text-text-3">Manager note: {r.manager_notes}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Submit form modal */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setForm(null)}>
          <div className="w-full max-w-md rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2"><Clock className="h-5 w-5 text-brand-text" /> New OT Request</h3>
              <button onClick={() => setForm(null)} className="rounded p-1 hover:bg-sunken"><X className="h-4 w-4" /></button>
            </div>

            <p className="mb-4 rounded-lg bg-info-soft p-2 text-xs text-info-text">
              Submit this <strong>before</strong> your shift. Your manager approves → hours get paid at OT rate.
            </p>

            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-text-2">Date of OT</span>
                <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-base" />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-text-2">Hours</span>
                <input type="number" step="0.25" inputMode="decimal" value={form.hours} onChange={e => setForm({ ...form, hours: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-base" placeholder="2" />
              </label>

              {/* Rate is set automatically from the public-holiday / rest-day
                  calendar for the chosen date — not picked here. */}
              <p className="rounded-lg bg-sunken/60 p-2 text-xs text-text-2">
                The OT rate is set automatically: <strong>1.5×</strong> on a normal
                day, <strong>2×</strong> on your rest day, <strong>3×</strong> on a
                public holiday.
              </p>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-text-2">Start time (optional)</span>
                  <input type="time" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-base" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-text-2">End time (optional)</span>
                  <input type="time" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-base" />
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-text-2">Reason</span>
                <textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} rows={3} className="w-full rounded-lg border px-3 py-2 text-base" placeholder="e.g. Cover for teammate, extra event, high-traffic day" />
              </label>
            </div>

            <button
              onClick={submit}
              disabled={submitting || !form.date || !form.hours || !form.reason}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-3 text-base font-semibold text-on-ink hover:bg-ink-hover disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />} Submit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
