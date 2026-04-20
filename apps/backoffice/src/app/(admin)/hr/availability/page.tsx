"use client";

/**
 * Part-Timer Blockout Dates
 *
 * Model: PTs are AVAILABLE by default. HR only captures exceptions —
 * specific dates when a PT can't work. These render as red "Blocked"
 * cells on the schedule grid.
 *
 * Backed by hr_staff_availability (per-date, not recurring).
 */

import { useEffect, useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Loader2, Plus, Trash2, CalendarOff } from "lucide-react";

type Blockout = {
  id: string;
  user_id: string;
  date: string;          // YYYY-MM-DD
  availability: string;  // "unavailable"
  reason: string | null;
  created_at: string;
};

type Employee = {
  id: string;
  name: string;
  fullName: string | null;
  role: string;
  hrProfile?: { employment_type?: string } | null;
};

export default function BlockoutsPage() {
  const { data: empData } = useFetch<{ employees: Employee[] }>("/api/hr/employees");
  const partTimers = (empData?.employees ?? []).filter(
    (e) => e.hrProfile?.employment_type === "part_time",
  );
  const [userId, setUserId] = useState<string>("");
  useEffect(() => {
    if (!userId && partTimers.length > 0) setUserId(partTimers[0].id);
  }, [partTimers, userId]);

  const { data: blockData, mutate } = useFetch<{ blockouts: Blockout[] }>(
    userId ? `/api/hr/blockouts?user_id=${userId}` : null,
  );
  const blockouts = blockData?.blockouts ?? [];

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    if (!userId || !date) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/hr/blockouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, date, reason: reason || null }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Save failed");
      mutate();
      setReason("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this blockout?")) return;
    await fetch(`/api/hr/blockouts?id=${id}`, { method: "DELETE" });
    mutate();
  };

  const selectedEmp = partTimers.find((e) => e.id === userId);

  const upcoming = blockouts
    .filter((b) => b.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const past = blockouts
    .filter((b) => b.date < today)
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold">Part-Timer Blockout Dates</h1>
        <p className="text-sm text-muted-foreground">
          Part-timers are available by default. Mark specific dates they can&apos;t work
          (exam, prior commitment, etc.) so the schedule grid blocks assignment.
        </p>
      </div>

      {/* Staff picker */}
      <div className="rounded-lg border bg-card p-4">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Part-Timer</label>
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="w-full max-w-md rounded-md border px-3 py-2 text-sm"
        >
          {partTimers.length === 0 && <option value="">No part-timers found</option>}
          {partTimers.map((e) => (
            <option key={e.id} value={e.id}>
              {e.fullName || e.name}
            </option>
          ))}
        </select>
      </div>

      {selectedEmp && (
        <>
          {/* Add form */}
          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Add Blockout Date
            </h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Date">
                <input
                  type="date"
                  value={date}
                  min={today}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Reason (optional)">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. exam, family event"
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </Field>
              <div className="flex items-end">
                <button
                  onClick={add}
                  disabled={saving || !date}
                  className="inline-flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Block this date
                </button>
              </div>
            </div>
            {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
          </div>

          {/* Upcoming */}
          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <CalendarOff className="h-4 w-4" /> Upcoming Blockouts ({upcoming.length})
            </h2>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upcoming blockouts.</p>
            ) : (
              <div className="divide-y">
                {upcoming.map((b) => (
                  <div key={b.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <span className="font-mono font-medium">{fmtDate(b.date)}</span>
                      {b.reason && <span className="ml-3 text-xs text-gray-500">{b.reason}</span>}
                    </div>
                    <button
                      onClick={() => remove(b.id)}
                      className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Past (collapsible if needed) */}
          {past.length > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Past Blockouts ({past.length})
              </h2>
              <div className="divide-y max-h-60 overflow-y-auto">
                {past.map((b) => (
                  <div key={b.id} className="flex items-center justify-between py-1.5 text-xs text-gray-500">
                    <div>
                      <span className="font-mono">{fmtDate(b.date)}</span>
                      {b.reason && <span className="ml-3">{b.reason}</span>}
                    </div>
                    <button onClick={() => remove(b.id)} className="rounded p-0.5 text-gray-300 hover:text-red-500">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  return `${dow} · ${iso}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
