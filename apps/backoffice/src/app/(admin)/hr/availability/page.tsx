"use client";

/**
 * Part-Timer Weekly Availability
 *
 * Captures recurring weekly hours each PT can work (e.g. "Mon-Fri 3pm-11pm").
 * Schedule grid uses this to avoid assigning shifts outside available windows.
 *
 * Backed by hr_staff_weekly_availability.
 */

import { useEffect, useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Loader2, Plus, Trash2, Clock, Star } from "lucide-react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Availability = {
  id: string;
  user_id: string;
  day_of_week: number;
  available_from: string;
  available_until: string;
  is_preferred: boolean;
  max_shifts_per_week: number | null;
  notes: string | null;
};

type Employee = {
  id: string;
  name: string;
  fullName: string | null;
  role: string;
  hrProfile?: { employment_type?: string } | null;
};

export default function AvailabilityPage() {
  const { data: empData } = useFetch<{ employees: Employee[] }>("/api/hr/employees");
  const partTimers = (empData?.employees ?? []).filter(
    (e) => e.hrProfile?.employment_type === "part_time",
  );
  const [userId, setUserId] = useState<string>("");
  useEffect(() => {
    if (!userId && partTimers.length > 0) setUserId(partTimers[0].id);
  }, [partTimers, userId]);

  const { data: availData, mutate } = useFetch<{ availability: Availability[] }>(
    userId ? `/api/hr/availability?user_id=${userId}` : null,
  );
  const availability = availData?.availability ?? [];

  const [day, setDay] = useState(1);
  const [from, setFrom] = useState("09:00");
  const [until, setUntil] = useState("17:00");
  const [preferred, setPreferred] = useState(true);
  const [maxShifts, setMaxShifts] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    if (!userId) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/hr/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          day_of_week: day,
          available_from: from + ":00",
          available_until: until + ":00",
          is_preferred: preferred,
          max_shifts_per_week: maxShifts ? Number(maxShifts) : null,
          notes: notes || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Save failed");
      mutate();
      setNotes("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this availability window?")) return;
    await fetch(`/api/hr/availability?id=${id}`, { method: "DELETE" });
    mutate();
  };

  const byDay = new Map<number, Availability[]>();
  for (const a of availability) {
    const arr = byDay.get(a.day_of_week) ?? [];
    arr.push(a);
    byDay.set(a.day_of_week, arr);
  }

  const selectedEmp = partTimers.find((e) => e.id === userId);

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold">Part-Timer Availability</h1>
        <p className="text-sm text-muted-foreground">
          Hours each part-timer can work, per day of week. Schedule grid respects these windows when assigning shifts.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Part-Timer</label>
        <select value={userId} onChange={(e) => setUserId(e.target.value)} className="w-full max-w-md rounded-md border px-3 py-2 text-sm">
          {partTimers.length === 0 && <option value="">No part-timers found</option>}
          {partTimers.map((e) => (
            <option key={e.id} value={e.id}>{e.fullName || e.name}</option>
          ))}
        </select>
      </div>

      {selectedEmp && (
        <>
          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Weekly Availability — {selectedEmp.fullName || selectedEmp.name}
            </h2>
            <div className="grid grid-cols-7 gap-2 text-xs">
              {DAYS.map((d, i) => {
                const windows = byDay.get(i) ?? [];
                return (
                  <div key={i} className={`rounded-md border p-2 ${windows.length ? "border-emerald-200 bg-emerald-50/50" : "border-gray-200 bg-gray-50"}`}>
                    <p className="mb-1.5 font-semibold">{d}</p>
                    {windows.length === 0 ? (
                      <p className="text-[10px] italic text-gray-400">Not available</p>
                    ) : (
                      <div className="space-y-1">
                        {windows.map((w) => (
                          <div key={w.id} className="flex items-center justify-between rounded bg-white px-1.5 py-1 text-[11px]">
                            <span className="font-mono">{w.available_from.slice(0,5)}–{w.available_until.slice(0,5)}</span>
                            <div className="flex items-center gap-0.5">
                              {w.is_preferred && <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />}
                              <button onClick={() => remove(w.id)} className="rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-600">
                                <Trash2 className="h-2.5 w-2.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Add Availability Window</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Day</span>
                <select value={day} onChange={(e) => setDay(Number(e.target.value))} className="w-full rounded-md border px-3 py-2 text-sm">
                  {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">From</span>
                <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Until</span>
                <input type="time" value={until} onChange={(e) => setUntil(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Max shifts/week</span>
                <input type="number" min="0" value={maxShifts} onChange={(e) => setMaxShifts(e.target.value)} placeholder="optional" className="w-full rounded-md border px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Preferred</span>
                <label className="mt-1 flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={preferred} onChange={(e) => setPreferred(e.target.checked)} />
                  Happy to work
                </label>
              </label>
            </div>
            <div className="mt-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Notes (optional)</span>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. only until end of exam" className="w-full rounded-md border px-3 py-2 text-sm" />
              </label>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              {err && <span className="text-xs text-red-600">{err}</span>}
              <button onClick={add} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add Window
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <Clock className="mb-1 inline h-3 w-3" /> Multiple windows per day are allowed (e.g. 09:00-12:00 and 18:00-22:00 for split availability).
          </div>
        </>
      )}
    </div>
  );
}
