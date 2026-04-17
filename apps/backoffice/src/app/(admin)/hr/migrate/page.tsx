"use client";

import { useState } from "react";
import Link from "next/link";
import { Upload, Loader2, CheckCircle2, AlertCircle, ArrowLeft, Users, CalendarOff, CalendarClock, Clock, Banknote, FileText, Eye, Send } from "lucide-react";

type MigrateType = "employees" | "leave_balances" | "leave_history" | "attendance" | "payroll";

type MigrateResult = {
  type: string;
  total: number;
  imported?: number;
  matched?: number;
  unmatched?: number;
  created?: number;
  updated?: number;
  errors?: string[];
  results?: Array<{ briohr_id: string; name: string; user_id: string | null; score: number; match_name: string; status: string }>;
  totals?: { gross: number; deductions: number; net: number; employerCost: number };
  dryRun?: boolean;
};

const STEPS: { type: MigrateType; label: string; icon: typeof Users; description: string; required: boolean; sample: string; fields: string }[] = [
  {
    type: "employees",
    label: "1. Employees",
    icon: Users,
    description: "Employee list with salaries, IC, statutory numbers. DO THIS FIRST — everything else depends on it.",
    required: true,
    fields: "employee_id, employee_name, email, job_title, employment_type, join_date, basic_salary, ic_number, epf_number, socso_number, tax_number",
    sample: `employee_id,employee_name,email,job_title,employment_type,join_date,basic_salary,ic_number,epf_number,socso_number,tax_number
CC001,Ammar bin Shahrin,ammar.shahrin+1@gmail.com,Director,part_time,2021-01-01,5000,900101-10-1234,12345678,B12345678,OG12345678
CC006,Muhamad Syafiq Aiman bin Mohamed Kaberi,syafiqkaberii@gmail.com,Barista Lead,full_time,2022-06-15,2500,950615-10-5678,87654321,B87654321,OG87654321`,
  },
  {
    type: "leave_balances",
    label: "2. Leave Balances",
    icon: CalendarOff,
    description: "Current year leave entitlements + days used for each employee (one row per leave type).",
    required: false,
    fields: "employee_id, employee_name, leave_type, entitlement, used, carried_forward",
    sample: `employee_id,employee_name,leave_type,entitlement,used,carried_forward
CC001,Ammar bin Shahrin,annual,12,3,0
CC001,Ammar bin Shahrin,sick,14,1,0
CC006,Muhamad Syafiq Aiman,annual,8,5,0
CC006,Muhamad Syafiq Aiman,sick,14,2,0`,
  },
  {
    type: "leave_history",
    label: "3. Leave History",
    icon: CalendarClock,
    description: "Past approved/rejected leave requests (for audit trail and records).",
    required: false,
    fields: "employee_id, employee_name, leave_type, start_date, end_date, days, reason, status",
    sample: `employee_id,employee_name,leave_type,start_date,end_date,days,reason,status
CC001,Ammar bin Shahrin,annual,2026-01-15,2026-01-16,2,Family event,approved
CC006,Muhamad Syafiq Aiman,sick,2026-02-03,2026-02-03,1,Flu,approved`,
  },
  {
    type: "attendance",
    label: "4. Attendance Logs",
    icon: Clock,
    description: "Past clock-in/out records. Each row = one day's attendance per employee.",
    required: false,
    fields: "employee_id, employee_name, date, clock_in, clock_out, total_hours, overtime_hours",
    sample: `employee_id,employee_name,date,clock_in,clock_out,total_hours,overtime_hours
CC006,Muhamad Syafiq Aiman,2026-04-15,08:00,17:30,8.5,0.5
CC006,Muhamad Syafiq Aiman,2026-04-16,08:15,18:00,8.75,1.25`,
  },
  {
    type: "payroll",
    label: "5. Payroll History",
    icon: Banknote,
    description: "Past payslips. Upload ONE file per month — the wizard creates a payroll run per upload.",
    required: false,
    fields: "employee_id, employee_name, basic_salary, overtime, gross_pay, epf_employee, epf_employer, socso_employee, socso_employer, eis_employee, eis_employer, pcb, net_pay",
    sample: `employee_id,employee_name,basic_salary,overtime,gross_pay,epf_employee,epf_employer,socso_employee,socso_employer,eis_employee,eis_employer,pcb,net_pay
CC001,Ammar bin Shahrin,5000,0,5000,550,600,25,87.50,10,10,120,4295
CC006,Muhamad Syafiq Aiman,2500,250,2750,302.50,330,13.75,48.13,5.50,5.50,0,2428.25`,
  },
];

export default function MigratePage() {
  const [activeStep, setActiveStep] = useState<MigrateType>("employees");
  const [csvText, setCsvText] = useState("");
  const [loading, setLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<MigrateResult | null>(null);
  const [applyResult, setApplyResult] = useState<MigrateResult | null>(null);
  const [completed, setCompleted] = useState<Set<MigrateType>>(new Set());

  // Payroll-specific inputs
  const [payrollMonth, setPayrollMonth] = useState(new Date().getMonth() + 1);
  const [payrollYear, setPayrollYear] = useState(new Date().getFullYear());

  // Balance-specific year
  const [balanceYear, setBalanceYear] = useState(new Date().getFullYear());

  const currentStep = STEPS.find((s) => s.type === activeStep)!;
  const StepIcon = currentStep.icon;

  const resetForNewStep = (type: MigrateType) => {
    setActiveStep(type);
    setCsvText("");
    setDryRunResult(null);
    setApplyResult(null);
  };

  const callMigrate = async (dryRun: boolean) => {
    setLoading(true);
    if (dryRun) setDryRunResult(null);
    else setApplyResult(null);

    try {
      const body: Record<string, unknown> = {
        type: activeStep,
        csv: csvText,
        dryRun,
      };
      if (activeStep === "payroll") { body.month = payrollMonth; body.year = payrollYear; }
      if (activeStep === "leave_balances") { body.year = balanceYear; }

      const res = await fetch("/api/hr/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed");
        return;
      }
      if (dryRun) setDryRunResult(data);
      else {
        setApplyResult(data);
        setCompleted((c) => new Set([...c, activeStep]));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center gap-3">
        <Link href="/hr/employees" className="rounded-lg p-1 hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Migrate from BrioHR</h1>
          <p className="text-sm text-muted-foreground">One-time import of all your data. Do steps in order.</p>
        </div>
      </div>

      {/* Step Navigation */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
        {STEPS.map((s) => {
          const Icon = s.icon;
          const isActive = activeStep === s.type;
          const isDone = completed.has(s.type);
          return (
            <button
              key={s.type}
              onClick={() => resetForNewStep(s.type)}
              className={`flex items-start gap-2 rounded-xl border p-3 text-left transition-all ${
                isActive ? "border-terracotta bg-orange-50" :
                isDone ? "border-green-500 bg-green-50" :
                "border-gray-200 bg-card hover:bg-muted"
              }`}
            >
              <div className={`rounded-lg p-1.5 ${isActive ? "bg-terracotta text-white" : isDone ? "bg-green-500 text-white" : "bg-gray-200"}`}>
                {isDone ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <div className="flex-1 text-xs">
                <p className="font-semibold">{s.label}</p>
                {s.required && <span className="text-[10px] text-terracotta">Required</span>}
              </div>
            </button>
          );
        })}
      </div>

      {/* Active Step */}
      <div className="rounded-xl border bg-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <StepIcon className="h-5 w-5 text-terracotta" />
          <h2 className="font-semibold">{currentStep.label}</h2>
          {currentStep.required && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600">Required</span>}
        </div>
        <p className="mb-4 text-sm text-muted-foreground">{currentStep.description}</p>

        {/* Payroll: month/year */}
        {activeStep === "payroll" && (
          <div className="mb-4 flex items-end gap-3 rounded-lg bg-muted/50 p-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Month</span>
              <select value={payrollMonth} onChange={(e) => setPayrollMonth(Number(e.target.value))} className="rounded-lg border bg-background px-3 py-2 text-sm">
                {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Year</span>
              <select value={payrollYear} onChange={(e) => setPayrollYear(Number(e.target.value))} className="rounded-lg border bg-background px-3 py-2 text-sm">
                <option value={2024}>2024</option>
                <option value={2025}>2025</option>
                <option value={2026}>2026</option>
              </select>
            </label>
          </div>
        )}

        {/* Balance: year */}
        {activeStep === "leave_balances" && (
          <div className="mb-4 flex items-end gap-3 rounded-lg bg-muted/50 p-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Year</span>
              <select value={balanceYear} onChange={(e) => setBalanceYear(Number(e.target.value))} className="rounded-lg border bg-background px-3 py-2 text-sm">
                <option value={2025}>2025</option>
                <option value={2026}>2026</option>
              </select>
            </label>
          </div>
        )}

        {/* Fields hint */}
        <div className="mb-3 rounded-lg bg-blue-50 p-3 text-xs">
          <p className="mb-1 font-medium text-blue-900">Expected CSV columns:</p>
          <p className="font-mono text-blue-800">{currentStep.fields}</p>
        </div>

        {/* CSV Input */}
        <textarea
          value={csvText}
          onChange={(e) => { setCsvText(e.target.value); setDryRunResult(null); setApplyResult(null); }}
          rows={8}
          placeholder={currentStep.sample}
          className="w-full rounded-lg border bg-background px-3 py-2 font-mono text-xs"
        />

        {/* Action buttons */}
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setCsvText(currentStep.sample)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Use sample
          </button>
          <div className="flex-1" />
          <button
            onClick={() => callMigrate(true)}
            disabled={loading || !csvText.trim()}
            className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            Preview
          </button>
          <button
            onClick={() => callMigrate(false)}
            disabled={loading || !csvText.trim() || !dryRunResult}
            className="flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Import
          </button>
        </div>
      </div>

      {/* Preview result */}
      {dryRunResult && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-blue-900">
            <Eye className="h-5 w-5" /> Preview (not saved yet)
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total rows" value={dryRunResult.total} />
            {dryRunResult.matched !== undefined && <Stat label="Matched" value={dryRunResult.matched} color="text-green-700" />}
            {dryRunResult.unmatched !== undefined && <Stat label="Unmatched" value={dryRunResult.unmatched} color="text-red-700" />}
            {dryRunResult.imported !== undefined && <Stat label="Will import" value={dryRunResult.imported} color="text-blue-700" />}
          </div>

          {dryRunResult.results && dryRunResult.results.length > 0 && (
            <div className="mt-4 max-h-96 overflow-y-auto rounded-lg border bg-white">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50">
                  <tr>
                    <th className="p-2 text-left font-medium">BrioHR ID</th>
                    <th className="p-2 text-left font-medium">BrioHR Name</th>
                    <th className="p-2 text-left font-medium">Matched User</th>
                    <th className="p-2 text-right font-medium">Score</th>
                    <th className="p-2 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dryRunResult.results.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2 font-mono">{r.briohr_id}</td>
                      <td className="p-2">{r.name}</td>
                      <td className="p-2">{r.match_name || "—"}</td>
                      <td className="p-2 text-right">{Math.round(r.score * 100)}%</td>
                      <td className="p-2">
                        {r.status === "matched" ? (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">Matched</span>
                        ) : (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">No match</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {dryRunResult.errors && dryRunResult.errors.length > 0 && (
            <div className="mt-3 rounded-lg bg-red-50 p-3">
              <p className="mb-1 text-xs font-medium text-red-700">Issues ({dryRunResult.errors.length}):</p>
              <div className="max-h-32 overflow-y-auto">
                {dryRunResult.errors.slice(0, 20).map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
                {dryRunResult.errors.length > 20 && <p className="text-xs text-red-600 italic">...and {dryRunResult.errors.length - 20} more</p>}
              </div>
            </div>
          )}

          <p className="mt-3 text-xs text-blue-800">
            If this looks right, click <strong>Import</strong> above to save.
          </p>
        </div>
      )}

      {/* Apply result */}
      {applyResult && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-5">
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-green-900">
            <CheckCircle2 className="h-5 w-5" /> Import Complete
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total rows" value={applyResult.total} />
            {applyResult.created !== undefined && <Stat label="Created" value={applyResult.created} color="text-green-700" />}
            {applyResult.updated !== undefined && <Stat label="Updated" value={applyResult.updated} color="text-blue-700" />}
            {applyResult.imported !== undefined && <Stat label="Imported" value={applyResult.imported} color="text-green-700" />}
            {applyResult.unmatched !== undefined && applyResult.unmatched > 0 && <Stat label="Unmatched" value={applyResult.unmatched} color="text-red-700" />}
          </div>

          {applyResult.totals && (
            <div className="mt-3 rounded-lg bg-white p-3 text-sm">
              <p className="font-medium">Payroll totals:</p>
              <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
                <div>Gross: RM {applyResult.totals.gross.toLocaleString()}</div>
                <div>Deductions: RM {applyResult.totals.deductions.toLocaleString()}</div>
                <div>Net: RM {applyResult.totals.net.toLocaleString()}</div>
                <div>Employer cost: RM {applyResult.totals.employerCost.toLocaleString()}</div>
              </div>
            </div>
          )}

          {applyResult.errors && applyResult.errors.length > 0 && (
            <div className="mt-3 rounded-lg bg-red-50 p-3">
              <p className="mb-1 text-xs font-medium text-red-700">Errors ({applyResult.errors.length}):</p>
              <div className="max-h-32 overflow-y-auto">
                {applyResult.errors.slice(0, 10).map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
              </div>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            {STEPS.findIndex((s) => s.type === activeStep) < STEPS.length - 1 && (
              <button
                onClick={() => resetForNewStep(STEPS[STEPS.findIndex((s) => s.type === activeStep) + 1].type)}
                className="rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark"
              >
                Next: {STEPS[STEPS.findIndex((s) => s.type === activeStep) + 1].label}
              </button>
            )}
            {activeStep === "employees" && (
              <Link href="/hr/employees" className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted">
                View Employees
              </Link>
            )}
            {activeStep === "payroll" && (
              <Link href="/hr/payroll" className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted">
                View Payroll
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Help text */}
      <div className="rounded-xl bg-gray-50 p-4 text-xs">
        <p className="mb-2 flex items-center gap-1 font-medium"><FileText className="h-3 w-3" /> How to get CSVs from BrioHR:</p>
        <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
          <li>Login to BrioHR → <strong>Reports</strong> section</li>
          <li>For employees: Reports → Employee Directory → Export CSV</li>
          <li>For leave balances: Reports → Leave Summary → Export</li>
          <li>For attendance: Time & Attendance → Export (range per month)</li>
          <li>For payroll: Payroll Reports → Payslip Summary → Export per month</li>
          <li>Open CSV in Excel/Sheets, copy all, paste above</li>
        </ol>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-lg bg-white p-3 text-center shadow-sm">
      <p className={`text-2xl font-bold ${color || "text-gray-800"}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
