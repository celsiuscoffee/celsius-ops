"use client";

// PT Hours — the manager's weekly sign-off before part-timers get paid
// (owner rule 2026-07-19: "managers need to confirm each PT hours first
// before paying"). One screen per week: every PT's clocked shifts with the
// day's rate (weekday / weekend / public-holiday 2×) and pay, a one-click
// "Confirm all clean" for unflagged logs, and per-log confirm. Flagged logs
// keep their existing review flow in HR → Attendance (link provided) —
// rejecting or adjusting there updates this screen too. The weekly payment
// file refuses to generate until every shift here is confirmed.

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import Link from "next/link";
import { CheckCircle2, AlertTriangle, Loader2, ChevronLeft, ChevronRight } from "lucide-react";

type PtLog = {
  id: string; date: string; clock_in: string; clock_out: string;
  worked_hours: number; rate: number; pay: number;
  is_weekend_rate: boolean; is_holiday: boolean;
  state: "pending" | "flagged" | "confirmed" | "rejected";
  ai_flags: string[]; outlet_name: string | null;
};
type PtRow = { user_id: string; name: string; logs: PtLog[]; total_hours: number; total_pay: number; pending: number };

function mondayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}
function shiftWeek(weekStart: string, weeks: number): string {
  const d = new Date(`${weekStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kuala_Lumpur" });
const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-MY", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export default function PtHoursPage() {
  const [weekStart, setWeekStart] = useState(mondayOf(new Date()));
  const { data, mutate } = useFetch<{ pts: PtRow[]; week_end?: string }>(
    `/api/hr/payroll/weekly/pt-hours?week_start=${weekStart}`,
  );
  const [busy, setBusy] = useState(false);

  const pts = data?.pts || [];
  const pendingTotal = pts.reduce((s, p) => s + p.pending, 0);
  const confirmIds = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await fetch("/api/hr/payroll/weekly/pt-hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", log_ids: ids }),
      });
      mutate();
    } finally {
      setBusy(false);
    }
  };
  // "Clean" = pending with no AI flags — safe to confirm in bulk. Flagged
  // ones deserve eyes; they confirm per-log or resolve in the Attendance queue.
  const cleanIds = pts.flatMap((p) => p.logs.filter((l) => l.state === "pending" && l.ai_flags.length === 0).map((l) => l.id));

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Confirm PT Hours</h1>
          <p className="text-sm text-muted-foreground">
            Sign off every part-timer&apos;s clocked shifts for the week — payroll can&apos;t generate the payment
            file until everything here is confirmed. Rates: weekday / weekend / public-holiday 2×.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekStart(shiftWeek(weekStart, -1))} className="rounded-lg border p-2 hover:bg-muted"><ChevronLeft className="h-4 w-4" /></button>
          <span className="text-sm font-medium tabular-nums">{weekStart} → {data?.week_end ?? shiftWeek(weekStart, 1)}</span>
          <button onClick={() => setWeekStart(shiftWeek(weekStart, 1))} className="rounded-lg border p-2 hover:bg-muted"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {pendingTotal === 0 && pts.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-700">
            <CheckCircle2 className="h-4 w-4" /> All {pts.length} part-timers confirmed — payroll can pay this week
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700">
            <AlertTriangle className="h-4 w-4" /> {pendingTotal} shift{pendingTotal === 1 ? "" : "s"} awaiting confirmation
          </span>
        )}
        {cleanIds.length > 0 && (
          <button
            onClick={() => confirmIds(cleanIds)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-terracotta px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Confirm all clean ({cleanIds.length})
          </button>
        )}
      </div>

      {pts.length === 0 && (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          No part-timer clock-ins for this week (at your outlets).
        </div>
      )}

      {pts.map((p) => (
        <div key={p.user_id} className="rounded-xl border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <div className="font-medium">{p.name}</div>
            <div className="text-sm text-muted-foreground tabular-nums">
              {p.total_hours}h · RM{p.total_pay.toFixed(2)}
              {p.pending > 0
                ? <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700">{p.pending} to confirm</span>
                : <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-xs font-semibold text-green-700">confirmed</span>}
            </div>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {p.logs.map((l) => (
                <tr key={l.id} className={`border-b last:border-0 ${l.state === "rejected" ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2 whitespace-nowrap">{fmtDay(l.date)}</td>
                  <td className="px-2 py-2 tabular-nums whitespace-nowrap">{fmtTime(l.clock_in)} – {fmtTime(l.clock_out)}</td>
                  <td className="px-2 py-2 tabular-nums">{l.worked_hours}h</td>
                  <td className="px-2 py-2 tabular-nums whitespace-nowrap">
                    RM{l.rate}/h
                    {l.is_holiday && <span className="ml-1 rounded bg-red-100 px-1 text-[10px] font-semibold text-red-700">PH 2×</span>}
                    {l.is_weekend_rate && <span className="ml-1 rounded bg-blue-100 px-1 text-[10px] font-semibold text-blue-700">wknd</span>}
                  </td>
                  <td className="px-2 py-2 tabular-nums font-medium whitespace-nowrap">{l.state === "rejected" ? "—" : `RM${l.pay.toFixed(2)}`}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">{l.outlet_name ?? ""}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {l.state === "confirmed" && <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700"><CheckCircle2 className="h-3.5 w-3.5" /> Confirmed</span>}
                    {l.state === "rejected" && <span className="text-xs font-medium text-red-600">Rejected</span>}
                    {l.state === "pending" && (
                      <button onClick={() => confirmIds([l.id])} disabled={busy} className="rounded border px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50">Confirm</button>
                    )}
                    {l.state === "flagged" && (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-xs text-amber-700" title={l.ai_flags.join(", ")}>⚠ {l.ai_flags.join(", ") || "flagged"}</span>
                        <Link href="/hr/roster-attendance" className="rounded border px-2 py-1 text-xs font-medium hover:bg-muted">Review</Link>
                        <button onClick={() => confirmIds([l.id])} disabled={busy} className="rounded border px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50">Confirm anyway</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
