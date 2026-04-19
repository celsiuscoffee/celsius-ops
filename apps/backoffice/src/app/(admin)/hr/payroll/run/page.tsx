"use client";

/**
 * Payroll Run Wizard — single-screen replacement for BrioHR's 4-modal flow.
 *
 * Three panes stacked vertically, no modals:
 *   1. Cycle setup (period, payday, cadence)
 *   2. Employee table (after compute, with prorate + anomaly chips)
 *   3. Anomalies + totals + approve
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Loader2, CalendarDays, Users, AlertTriangle,
  CheckCircle2, Play, Sparkles, ChevronDown, ChevronRight,
} from "lucide-react";
import { detectAnomalies, type AnomalyFlag } from "@/lib/hr/payroll/anomalies";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type PayrollRun = {
  id: string;
  period_month: number;
  period_year: number;
  status: string;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  total_employer_cost: number;
};

type PayrollItem = {
  id: string;
  user_id: string;
  employee_name?: string;
  basic_salary: number;
  total_regular_hours: number;
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
  epf_employer: number;
  socso_employer: number;
  eis_employer: number;
  prorate_reason: string | null;
  prorate_days_worked: number | null;
  prorate_days_total: number | null;
  computation_details: { employment_type?: string; hourly_rate?: number; unpaid_days?: number } | null;
};

type Step = "setup" | "review" | "approved";

export default function PayrollRunPage() {
  const router = useRouter();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  // Payday defaults to the 3rd of the following month. Format as local date
  // (not toISOString — UTC conversion shifts MYT back a day).
  const fmtLocal = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const [payday, setPayday] = useState(() => fmtLocal(new Date(now.getFullYear(), now.getMonth() + 1, 3)));

  const [step, setStep] = useState<Step>("setup");
  const [computing, setComputing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [run, setRun] = useState<PayrollRun | null>(null);
  const [items, setItems] = useState<PayrollItem[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const cycleStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const cycleEnd = fmtLocal(new Date(year, month, 0));

  const runCompute = async () => {
    setComputing(true);
    setErr(null);
    try {
      const res = await fetch("/api/hr/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "compute", month, year }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Compute failed");

      // Fetch the run + items with name enrichment
      const detail = await fetch(`/api/hr/payroll?run_id=${body.payrollRunId}`).then((r) => r.json());
      setRun(detail.run);
      setItems(detail.items || []);
      setStep("review");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setComputing(false);
    }
  };

  const approve = async () => {
    if (!run) return;
    setConfirming(true);
    try {
      const res = await fetch("/api/hr/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", run_id: run.id }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Approve failed");
      }
      setStep("approved");
      setTimeout(() => router.push("/hr/payroll"), 1200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setConfirming(false);
    }
  };

  // Compute anomalies per item (client-side, no network)
  const anomaliesByItem = new Map<string, AnomalyFlag[]>();
  for (const item of items) {
    const flags = detectAnomalies(
      item,
      { user_id: item.user_id, name: item.employee_name, payroll_cadence: "MONTHLY" },
      [], // prior items — would fetch separately for MoM spike; skip in v1
    );
    if (flags.length) anomaliesByItem.set(item.id, flags);
  }
  const totalAnomalies = Array.from(anomaliesByItem.values()).reduce((s, a) => s + a.length, 0);
  const blockingCount = Array.from(anomaliesByItem.values()).flat().filter((f) => f.severity === "block").length;
  const canApprove = blockingCount === 0 && items.length > 0 && step === "review";

  const filteredItems = items.filter((i) => {
    if (!search) return true;
    return (i.employee_name || i.user_id).toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/hr/payroll" className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Run Payroll</h1>
            <p className="text-sm text-muted-foreground">Single-screen wizard — compute, review, approve.</p>
          </div>
        </div>
        {/* Status progress bar */}
        <StepIndicator step={step} />
      </div>

      {/* Pane 1 — Cycle Setup */}
      <section className="rounded-lg border bg-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Cycle Setup</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Field label="Period — Month">
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              disabled={step !== "setup"}
              className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-60"
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Year">
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              disabled={step !== "setup"}
              className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-60"
            >
              {[year - 1, year, year + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </Field>
          <Field label="Payday">
            <input
              type="date"
              value={payday}
              onChange={(e) => setPayday(e.target.value)}
              disabled={step !== "setup"}
              className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-60"
            />
          </Field>
          <Field label="Cycle Period">
            <div className="rounded-md border bg-gray-50 px-3 py-2 text-sm font-mono text-gray-600">
              {cycleStart} → {cycleEnd}
            </div>
          </Field>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          {step === "setup" ? (
            <button
              onClick={runCompute}
              disabled={computing}
              className="inline-flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
            >
              {computing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {computing ? "Computing…" : "Preview Compute"}
            </button>
          ) : (
            <button
              onClick={() => { setStep("setup"); setRun(null); setItems([]); }}
              className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
            >
              Edit setup
            </button>
          )}
        </div>
        {err && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>
        )}
      </section>

      {/* Pane 2 — Employees table (only after compute) */}
      {step !== "setup" && (
        <section className="rounded-lg border bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Employees <span className="ml-1 text-gray-400">({items.length})</span>
              </h2>
            </div>
            <input
              placeholder="Search staff…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-md border px-3 py-1.5 text-sm"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3"></th>
                  <th className="py-2 pr-3">Employee</th>
                  <th className="py-2 pr-3 text-right">Basic</th>
                  <th className="py-2 pr-3 text-right">OT hrs</th>
                  <th className="py-2 pr-3 text-right">Gross</th>
                  <th className="py-2 pr-3 text-right">EPF</th>
                  <th className="py-2 pr-3 text-right">PCB</th>
                  <th className="py-2 pr-3 text-right">Net</th>
                  <th className="py-2 pr-3">Flags</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const flags = anomaliesByItem.get(item.id) ?? [];
                  const isExpanded = expanded === item.id;
                  return (
                    <>
                      <tr
                        key={item.id}
                        onClick={() => setExpanded(isExpanded ? null : item.id)}
                        className="cursor-pointer border-b last:border-b-0 hover:bg-gray-50/60"
                      >
                        <td className="py-2.5 pr-2">
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
                        </td>
                        <td className="py-2.5 pr-3 font-medium">
                          {item.employee_name ?? item.user_id.slice(0, 8)}
                          {item.prorate_reason && (
                            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                              Prorated {item.prorate_days_worked}/{item.prorate_days_total}d
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono">RM {item.basic_salary.toFixed(2)}</td>
                        <td className="py-2.5 pr-3 text-right font-mono">{item.total_ot_hours.toFixed(1)}</td>
                        <td className="py-2.5 pr-3 text-right font-mono">RM {item.total_gross.toFixed(2)}</td>
                        <td className="py-2.5 pr-3 text-right font-mono text-gray-500">RM {item.epf_employee.toFixed(2)}</td>
                        <td className="py-2.5 pr-3 text-right font-mono text-gray-500">RM {item.pcb_tax.toFixed(2)}</td>
                        <td className="py-2.5 pr-3 text-right font-mono font-semibold">RM {item.net_pay.toFixed(2)}</td>
                        <td className="py-2.5 pr-3">
                          {flags.length > 0 && (
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              flags.some((f) => f.severity === "block")
                                ? "bg-red-100 text-red-800"
                                : flags.some((f) => f.severity === "warn")
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-gray-100 text-gray-700"
                            }`}>
                              <AlertTriangle className="h-2.5 w-2.5" />
                              {flags.length}
                            </span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-gray-50/60">
                          <td colSpan={9} className="px-6 py-3">
                            <EmployeeBreakdown item={item} flags={flags} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
                {filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-sm text-muted-foreground">No employees match your search.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Pane 3 — Anomalies + Totals + Approve */}
      {step === "review" && run && (
        <section className="rounded-lg border bg-card p-5">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Anomalies */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Anomalies
                  {totalAnomalies > 0 && (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">{totalAnomalies}</span>
                  )}
                </h2>
              </div>
              {totalAnomalies === 0 ? (
                <p className="text-sm text-emerald-700">✓ No anomalies detected. Ready to approve.</p>
              ) : (
                <ul className="space-y-1.5 text-xs">
                  {Array.from(anomaliesByItem.values()).flat().slice(0, 8).map((f, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className={`mt-0.5 shrink-0 rounded px-1 text-[9px] font-bold uppercase ${
                        f.severity === "block" ? "bg-red-100 text-red-800"
                        : f.severity === "warn" ? "bg-amber-100 text-amber-800"
                        : "bg-gray-100 text-gray-700"
                      }`}>{f.severity}</span>
                      <span>
                        {f.message}
                        {f.fixUrl && <Link href={f.fixUrl} className="ml-2 text-blue-600 hover:underline">Fix →</Link>}
                      </span>
                    </li>
                  ))}
                  {totalAnomalies > 8 && (
                    <li className="text-gray-400">+ {totalAnomalies - 8} more (expand rows above)</li>
                  )}
                </ul>
              )}
            </div>

            {/* Totals */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Totals</h2>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <span className="text-gray-500">Gross</span>
                <span className="text-right font-mono">RM {run.total_gross.toFixed(2)}</span>
                <span className="text-gray-500">Deductions</span>
                <span className="text-right font-mono text-red-700">− RM {run.total_deductions.toFixed(2)}</span>
                <span className="text-gray-500 font-medium">Net payout</span>
                <span className="text-right font-mono font-semibold text-emerald-700">RM {run.total_net.toFixed(2)}</span>
                <span className="text-gray-500">Employer statutory</span>
                <span className="text-right font-mono text-gray-600">+ RM {run.total_employer_cost.toFixed(2)}</span>
                <span className="col-span-2 mt-1 border-t pt-1 text-xs text-gray-400">Total company outflow: RM {(run.total_net + run.total_employer_cost).toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between border-t pt-4">
            <div className="text-xs text-gray-500">
              {canApprove ? "All checks passed. Safe to approve." : blockingCount > 0 ? `${blockingCount} blocking issue${blockingCount === 1 ? "" : "s"} must be fixed first.` : "Cycle is empty."}
            </div>
            <div className="flex items-center gap-2">
              <Link href="/hr/payroll" className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50">
                Save Draft & Exit
              </Link>
              <button
                onClick={approve}
                disabled={!canApprove || confirming}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Approve & Generate
              </button>
            </div>
          </div>
        </section>
      )}

      {step === "approved" && (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-8 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
          <p className="mt-2 text-lg font-semibold text-emerald-900">Cycle approved. Redirecting…</p>
          <p className="text-sm text-emerald-700">Payslips are generating. You can send them from the payroll dashboard.</p>
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "setup", label: "Setup" },
    { key: "review", label: "Review" },
    { key: "approved", label: "Approved" },
  ];
  const idx = steps.findIndex((s) => s.key === step);
  return (
    <div className="hidden items-center gap-1.5 md:flex">
      {steps.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={s.key} className="flex items-center gap-1.5">
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
              done ? "bg-emerald-500 text-white"
              : active ? "bg-terracotta text-white"
              : "bg-gray-200 text-gray-500"
            }`}>
              {done ? "✓" : i + 1}
            </span>
            <span className={`text-xs ${active ? "font-semibold text-gray-900" : "text-gray-500"}`}>{s.label}</span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-gray-300" />}
          </div>
        );
      })}
    </div>
  );
}

function EmployeeBreakdown({ item, flags }: { item: PayrollItem; flags: AnomalyFlag[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 text-xs md:grid-cols-3">
      {/* Earnings */}
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Earnings</p>
        <Row label="Basic" value={item.basic_salary} />
        {item.total_ot_hours > 0 && <Row label={`OT (${item.total_ot_hours.toFixed(1)} hrs)`} value={item.ot_1_5x_amount + item.ot_2x_amount + item.ot_3x_amount} />}
        <Row label="Gross" value={item.total_gross} bold />
        {item.prorate_reason && (
          <p className="mt-1 text-[10px] italic text-amber-700">
            Prorated ({item.prorate_reason}): {item.prorate_days_worked}/{item.prorate_days_total} days
          </p>
        )}
      </div>

      {/* Deductions */}
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Deductions (Employee)</p>
        <Row label="EPF" value={item.epf_employee} />
        <Row label="SOCSO" value={item.socso_employee} />
        <Row label="EIS" value={item.eis_employee} />
        <Row label="PCB Tax" value={item.pcb_tax} />
        <Row label="Total" value={item.total_deductions} bold />
        <p className="mt-2 font-semibold text-emerald-700">Net: RM {item.net_pay.toFixed(2)}</p>
      </div>

      {/* Employer + flags */}
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Employer Contributions</p>
        <Row label="EPF" value={item.epf_employer} />
        <Row label="SOCSO" value={item.socso_employer} />
        <Row label="EIS" value={item.eis_employer} />
        {flags.length > 0 && (
          <div className="mt-2 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">Flags</p>
            {flags.map((f, i) => (
              <p key={i} className="rounded bg-amber-50 p-1.5 text-[10px] text-amber-900">
                {f.message}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, bold = false }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "border-t pt-1 font-medium" : ""}`}>
      <span className="text-gray-500">{label}</span>
      <span className="font-mono">RM {value.toFixed(2)}</span>
    </div>
  );
}
