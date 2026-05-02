"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { Bot, Banknote, Loader2, CheckCircle2, FileText, CalendarDays, Download, FileSpreadsheet, Trash2 } from "lucide-react";
import Link from "next/link";
import { HrPageHeader } from "@/components/hr/page-header";

type PayrollRun = {
  id: string;
  period_month: number;
  period_year: number;
  status: string;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  total_employer_cost: number;
  ai_notes: string | null;
  confirmed_at: string | null;
};

type PayrollItem = {
  id: string;
  user_id: string;
  employee_name?: string;
  basic_salary: number;
  total_ot_hours: number;
  ot_1_5x_amount: number;
  ot_2x_amount: number;
  ot_3x_amount: number;
  total_gross: number;
  epf_employee: number;
  socso_employee: number;
  eis_employee: number;
  pcb_tax: number;
  total_deductions: number;
  net_pay: number;
  computation_details: { employment_type: string; hourly_rate: number; attendance_records: number } | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function PayrollPage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const { data, mutate } = useFetch<{ runs: PayrollRun[] }>("/api/hr/payroll");
  const [computing, setComputing] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [result, setResult] = useState<{ notes: string[] } | null>(null);
  const [viewRunId, setViewRunId] = useState<string | null>(null);
  const { data: detailData } = useFetch<{ run: PayrollRun; items: PayrollItem[] }>(
    viewRunId ? `/api/hr/payroll?run_id=${viewRunId}` : null,
  );

  const runs = data?.runs || [];

  const downloadFile = (url: string) => {
    window.location.href = url;
  };

  const handleCompute = async () => {
    setComputing(true);
    setResult(null);
    try {
      const res = await fetch("/api/hr/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "compute", month, year }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult(data);
        mutate();
      } else {
        setResult({ notes: [data.error || "Failed"] });
      }
    } finally {
      setComputing(false);
    }
  };

  const handleConfirm = async (runId: string) => {
    setConfirming(runId);
    try {
      await fetch("/api/hr/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", run_id: runId }),
      });
      mutate();
    } finally {
      setConfirming(null);
    }
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const handleDelete = async (runId: string) => {
    if (!confirm("Delete this payroll run? Items will be removed. Paid runs cannot be deleted.")) return;
    setDeletingId(runId);
    try {
      const res = await fetch(`/api/hr/payroll?run_id=${runId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        alert(body?.error || "Delete failed");
      } else {
        mutate();
      }
    } finally {
      setDeletingId(null);
    }
  };

  const fmt = (n: number) => `RM ${Number(n || 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <HrPageHeader
        title="Payroll (Monthly · Full-Timers)"
        action={
          <Link
            href="/hr/payroll/weekly"
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            <CalendarDays className="h-4 w-4" />
            Weekly (Part-Timers)
          </Link>
        }
      />

      {/* Compute Controls */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 flex items-center gap-2 font-semibold">
          <Bot className="h-5 w-5 text-terracotta" />
          AI Payroll Calculator
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Month</span>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="rounded-lg border bg-background px-3 py-2 text-sm">
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Year</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-lg border bg-background px-3 py-2 text-sm">
              <option value={2025}>2025</option>
              <option value={2026}>2026</option>
            </select>
          </label>
          <button
            onClick={handleCompute}
            disabled={computing}
            className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            {computing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
            Quick Compute
          </button>
          <Link
            href="/hr/payroll/run"
            className="flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark"
          >
            <Bot className="h-4 w-4" /> Run Payroll
          </Link>
        </div>
        {result && (
          <div className="mt-4 rounded-lg bg-muted/50 p-3 text-sm">
            {result.notes.map((n, i) => <p key={i} className="text-muted-foreground">{n}</p>)}
          </div>
        )}
      </div>

      {/* Payroll Runs */}
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
                    <p className="font-semibold">{MONTHS[run.period_month - 1]} {run.period_year}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      isConfirmed ? "bg-green-100 text-green-700" :
                      isComputed ? "bg-blue-100 text-blue-700" :
                      "bg-gray-100 text-gray-600"
                    }`}>
                      {run.status.replace("_", " ")}
                    </span>
                  </div>
                  <div className="mt-1 flex gap-4 text-sm text-muted-foreground">
                    <span>Gross: {fmt(run.total_gross)}</span>
                    <span>Net: {fmt(run.total_net)}</span>
                    <span>Employer: {fmt(run.total_employer_cost)}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setViewRunId(isViewing ? null : run.id)}
                    className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    <FileText className="inline h-3 w-3 mr-1" />{isViewing ? "Hide" : "Details"}
                  </button>
                  {isComputed && (
                    <button
                      onClick={() => handleConfirm(run.id)}
                      disabled={confirming === run.id}
                      className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {confirming === run.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                      Confirm
                    </button>
                  )}
                  {isConfirmed && <CheckCircle2 className="h-5 w-5 text-green-500" />}
                  {run.status !== "paid" && (
                    <button
                      onClick={() => handleDelete(run.id)}
                      disabled={deletingId === run.id}
                      title="Delete run (paid runs cannot be deleted)"
                      className="flex items-center rounded-lg border border-red-200 px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      {deletingId === run.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    </button>
                  )}
                </div>
              </div>

              {/* Detail Table */}
              {isViewing && detailData?.items && (
                <div className="border-t px-4 pb-4 pt-3">
                  <div className="mb-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => downloadFile(`/api/hr/payroll/payslip?run_id=${run.id}`)}
                      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                    >
                      <FileText className="h-3 w-3" /> Payslips (all, PDF)
                    </button>
                    <button
                      onClick={() => downloadFile(`/api/hr/payroll/submission-files?run_id=${run.id}&type=maybank`)}
                      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                    >
                      <Download className="h-3 w-3" /> Maybank M2u
                    </button>
                    <button
                      onClick={() => downloadFile(`/api/hr/payroll/submission-files?run_id=${run.id}&type=kwsp`)}
                      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                    >
                      <FileSpreadsheet className="h-3 w-3" /> KWSP Form A
                    </button>
                    <button
                      onClick={() => downloadFile(`/api/hr/payroll/submission-files?run_id=${run.id}&type=perkeso`)}
                      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                    >
                      <FileSpreadsheet className="h-3 w-3" /> PERKESO
                    </button>
                    <button
                      onClick={() => downloadFile(`/api/hr/payroll/submission-files?run_id=${run.id}&type=cp39`)}
                      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                    >
                      <FileSpreadsheet className="h-3 w-3" /> CP39 (PCB)
                    </button>
                    <button
                      onClick={() => downloadFile(`/api/hr/payroll/submission-files?run_id=${run.id}&type=hrdf`)}
                      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                    >
                      <FileSpreadsheet className="h-3 w-3" /> HRDF
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-2 pr-3">Employee</th>
                          <th className="pb-2 pr-3 text-right">Basic</th>
                          <th className="pb-2 pr-3 text-right">OT</th>
                          <th className="pb-2 pr-3 text-right">Gross</th>
                          <th className="pb-2 pr-3 text-right">EPF</th>
                          <th className="pb-2 pr-3 text-right">SOCSO</th>
                          <th className="pb-2 pr-3 text-right">EIS</th>
                          <th className="pb-2 pr-3 text-right">PCB</th>
                          <th className="pb-2 text-right font-semibold">Net</th>
                          <th className="pb-2 pl-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailData.items.map((item) => (
                          <tr key={item.id} className="border-b last:border-0">
                            <td className="py-2 pr-3 font-medium">{item.employee_name ?? item.user_id.slice(0, 8)}</td>
                            <td className="py-2 pr-3 text-right">{fmt(item.basic_salary)}</td>
                            <td className="py-2 pr-3 text-right">
                              {Number(item.total_ot_hours) > 0 ? `${item.total_ot_hours}h` : "—"}
                            </td>
                            <td className="py-2 pr-3 text-right">{fmt(item.total_gross)}</td>
                            <td className="py-2 pr-3 text-right">{fmt(item.epf_employee)}</td>
                            <td className="py-2 pr-3 text-right">{fmt(item.socso_employee)}</td>
                            <td className="py-2 pr-3 text-right">{fmt(item.eis_employee)}</td>
                            <td className="py-2 pr-3 text-right">{fmt(item.pcb_tax)}</td>
                            <td className="py-2 text-right font-semibold">{fmt(item.net_pay)}</td>
                            <td className="py-2 pl-2">
                              <button
                                onClick={() => downloadFile(`/api/hr/payroll/payslip?run_id=${run.id}&user_id=${item.user_id}`)}
                                className="text-terracotta hover:underline text-xs"
                                title="Download payslip PDF"
                              >
                                PDF
                              </button>
                            </td>
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
            <p className="text-lg font-semibold">No payroll runs yet</p>
            <p className="text-sm text-muted-foreground">Use the AI calculator above to compute</p>
          </div>
        )}
      </div>
    </div>
  );
}
