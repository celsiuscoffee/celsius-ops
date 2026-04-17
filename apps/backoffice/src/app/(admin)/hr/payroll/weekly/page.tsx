"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { Bot, Banknote, Loader2, CheckCircle2, FileText, CalendarDays, ArrowLeft } from "lucide-react";
import Link from "next/link";

type PayrollRun = {
  id: string;
  cycle_type: string;
  period_start: string;
  period_end: string;
  status: string;
  total_gross: number;
  total_net: number;
  ai_notes: string | null;
  confirmed_at: string | null;
};

type PayrollItem = {
  id: string;
  user_id: string;
  total_regular_hours: number;
  total_ot_hours: number;
  ot_1_5x_amount: number;
  ot_2x_amount: number;
  ot_3x_amount: number;
  total_gross: number;
  net_pay: number;
  computation_details: { hourly_rate: number; attendance_records: number } | null;
};

/** Get the Monday of the current week (or given date) in YYYY-MM-DD */
function mondayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay(); // 0 Sun, 1 Mon, ...
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function formatWeek(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const fmt = (d: Date) => d.toLocaleDateString("en-MY", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${fmt(s)} – ${fmt(e)}`;
}

export default function WeeklyPayrollPage() {
  const [weekStart, setWeekStart] = useState(mondayOf(new Date()));
  const { data, mutate } = useFetch<{ runs: PayrollRun[] }>("/api/hr/payroll/weekly");
  const [computing, setComputing] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [result, setResult] = useState<{ notes: string[] } | null>(null);
  const [viewRunId, setViewRunId] = useState<string | null>(null);
  const { data: detailData } = useFetch<{ run: PayrollRun; items: PayrollItem[] }>(
    viewRunId ? `/api/hr/payroll/weekly?run_id=${viewRunId}` : null,
  );

  const runs = data?.runs || [];

  const handleCompute = async () => {
    setComputing(true);
    setResult(null);
    try {
      const res = await fetch("/api/hr/payroll/weekly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "compute", week_start: weekStart }),
      });
      const payload = await res.json();
      if (res.ok) {
        setResult(payload);
        mutate();
      } else {
        setResult({ notes: [payload.error || "Failed"] });
      }
    } finally {
      setComputing(false);
    }
  };

  const handleConfirm = async (runId: string) => {
    setConfirming(runId);
    try {
      await fetch("/api/hr/payroll/weekly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", run_id: runId }),
      });
      mutate();
    } finally {
      setConfirming(null);
    }
  };

  const fmt = (n: number) =>
    `RM ${Number(n || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center gap-3">
        <Link href="/hr/payroll" className="text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="inline h-4 w-4" /> Monthly
        </Link>
        <h1 className="text-2xl font-bold">Weekly Payroll (Part-Timers)</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Part-time payroll runs Mon–Sun, paid the following week. Gross = approved hours × hourly rate + OT.
      </p>

      {/* Compute Controls */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 flex items-center gap-2 font-semibold">
          <Bot className="h-5 w-5 text-terracotta" />
          Compute Weekly Payroll
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Week starting (Monday)</span>
            <input
              type="date"
              value={weekStart}
              onChange={(e) => {
                const d = new Date(`${e.target.value}T00:00:00Z`);
                setWeekStart(mondayOf(d));
              }}
              className="rounded-lg border bg-background px-3 py-2 text-sm"
            />
          </label>
          <button
            onClick={handleCompute}
            disabled={computing}
            className="flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
          >
            {computing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
            Compute
          </button>
        </div>
        {result && (
          <div className="mt-4 rounded-lg bg-muted/50 p-3 text-sm">
            {result.notes.map((n, i) => (
              <p key={i} className="text-muted-foreground">{n}</p>
            ))}
          </div>
        )}
      </div>

      {/* Runs */}
      <div className="space-y-3">
        {runs.map((run) => {
          const isComputed = run.status === "ai_computed";
          const isConfirmed = run.status === "confirmed";
          const isViewing = viewRunId === run.id;

          return (
            <div key={run.id} className="rounded-xl border bg-card shadow-sm">
              <div className="flex items-center justify-between p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    <p className="font-semibold">{formatWeek(run.period_start, run.period_end)}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        isConfirmed
                          ? "bg-green-100 text-green-700"
                          : isComputed
                          ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {run.status.replace("_", " ")}
                    </span>
                  </div>
                  <div className="mt-1 flex gap-4 text-sm text-muted-foreground">
                    <span>Gross: {fmt(run.total_gross)}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setViewRunId(isViewing ? null : run.id)}
                    className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    <FileText className="inline h-3 w-3 mr-1" />
                    {isViewing ? "Hide" : "Details"}
                  </button>
                  {isComputed && (
                    <button
                      onClick={() => handleConfirm(run.id)}
                      disabled={confirming === run.id}
                      className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {confirming === run.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3" />
                      )}
                      Confirm
                    </button>
                  )}
                  {isConfirmed && <CheckCircle2 className="h-5 w-5 text-green-500" />}
                </div>
              </div>

              {isViewing && detailData?.items && (
                <div className="border-t px-4 pb-4 pt-3">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-2 pr-3">Employee</th>
                          <th className="pb-2 pr-3 text-right">Rate</th>
                          <th className="pb-2 pr-3 text-right">Hours</th>
                          <th className="pb-2 pr-3 text-right">OT</th>
                          <th className="pb-2 pr-3 text-right">Shifts</th>
                          <th className="pb-2 text-right font-semibold">Gross</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailData.items.map((item) => (
                          <tr key={item.id} className="border-b last:border-0">
                            <td className="py-2 pr-3 font-medium">{item.user_id.slice(0, 8)}…</td>
                            <td className="py-2 pr-3 text-right">
                              {item.computation_details?.hourly_rate
                                ? `RM ${item.computation_details.hourly_rate}/h`
                                : "—"}
                            </td>
                            <td className="py-2 pr-3 text-right">{Number(item.total_regular_hours).toFixed(2)}h</td>
                            <td className="py-2 pr-3 text-right">
                              {Number(item.total_ot_hours) > 0 ? `${item.total_ot_hours}h` : "—"}
                            </td>
                            <td className="py-2 pr-3 text-right">{item.computation_details?.attendance_records ?? 0}</td>
                            <td className="py-2 text-right font-semibold">{fmt(item.total_gross)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {run.ai_notes && !isViewing && (
                <p className="border-t px-4 py-2 text-xs text-muted-foreground">{run.ai_notes}</p>
              )}
            </div>
          );
        })}

        {runs.length === 0 && (
          <div className="rounded-xl border bg-card py-16 text-center">
            <Banknote className="mx-auto mb-3 h-12 w-12 text-gray-300" />
            <p className="text-lg font-semibold">No weekly payroll runs yet</p>
            <p className="text-sm text-muted-foreground">Pick a Monday and compute above</p>
          </div>
        )}
      </div>
    </div>
  );
}
