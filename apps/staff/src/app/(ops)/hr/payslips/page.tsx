"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { HRPageHeader } from "@/components/hr-page-header";
import { Receipt, ChevronDown, ChevronUp, Download } from "lucide-react";
import { PAYROLL_UI_ENABLED } from "@/lib/hr/constants";
import { FetchError } from "@/components/fetch-error";
import { earningsLines } from "@celsius/shared/src/hr/pay-lines";

type AllowanceItem = { amount: number; base?: number; score?: number };
type OtherDeductions = {
  unpaid_leave?: number;
  zakat?: number;
  review_penalty?: { amount: number; entries?: unknown[] };
};
type ComputationDetails = {
  source?: string;
  gross_additions?: number;
  briohr_internal_id?: string;
  basis?: string;
  hourly_rate?: number;
  ph_premium_hours?: number;
  ph_premium_amount?: number;
  ph_days_worked?: number;
  rest_day_pay_amount?: number;
  rest_day_days_worked?: number;
  ot_hours_1x?: number;
  ot_hours_1_5x?: number;
  ot_hours_2x?: number;
  ot_hours_3x?: number;
};

type Payslip = {
  id: string;
  basic_salary: number;
  total_regular_hours: number;
  total_ot_hours: number;
  ot_1x_amount: number;
  ot_1_5x_amount: number;
  ot_2x_amount: number;
  ot_3x_amount: number;
  allowances: Record<string, AllowanceItem> | null;
  total_gross: number;
  epf_employee: number;
  socso_employee: number;
  eis_employee: number;
  pcb_tax: number;
  other_deductions: OtherDeductions | null;
  total_deductions: number;
  net_pay: number;
  computation_details: ComputationDetails | null;
  hr_payroll_runs: {
    cycle_type: string | null;
    period_month: number | null;
    period_year: number | null;
    period_start: string | null;
    period_end: string | null;
    confirmed_at: string;
  };
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-06-30" → "30 Jun 2026" (no Date parsing — avoids TZ drift on date-only strings)
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export default function PayslipsPage() {
  // Payroll hidden pre-launch: don't fetch (SWR skips null keys) and show a notice.
  const { data, error, mutate } = useFetch<{ payslips: Payslip[] }>(PAYROLL_UI_ENABLED ? "/api/hr/payslips" : null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const payslips = data?.payslips || [];
  const fmt = (n: number) => `RM ${Number(n || 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

  if (!PAYROLL_UI_ENABLED) {
    return (
      <div className="px-4 pb-6">
        <HRPageHeader title="Payslips" subtitle="Your pay, month by month." />
        <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-sunken/60 py-16 text-center">
          <Receipt className="mb-3 h-12 w-12 text-line-ctl" />
          <p className="font-semibold text-text-3">Payslips coming soon</p>
          <p className="text-sm text-text-3">Your payslips will appear here once payroll goes live.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pb-6">
      <HRPageHeader title="Payslips" subtitle="Your pay, month by month." />

      {!data && error ? (
        <FetchError error={error} onRetry={() => mutate()} what="your payslips" />
      ) : payslips.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-sunken/60 py-16 text-center">
          <Receipt className="mb-3 h-12 w-12 text-line-ctl" />
          <p className="font-semibold text-text-3">No payslips yet</p>
          <p className="text-sm text-text-3">Payslips appear after payroll is confirmed</p>
        </div>
      ) : (
        <div className="space-y-3">
          {payslips.map((slip) => {
            const run = slip.hr_payroll_runs;
            const isWeekly = run.cycle_type === "weekly" || run.period_month == null;
            const period = isWeekly
              ? `Week of ${fmtDate(run.period_start)}`
              : `${MONTHS[(run.period_month as number) - 1]} ${run.period_year}`;
            const hourlyRate = Number(slip.computation_details?.hourly_rate || 0);
            const isOpen = expanded === slip.id;
            const allowances = slip.allowances || {};
            const allowanceEntries = Object.entries(allowances).filter(([, v]) => Number(v?.amount || 0) > 0);
            const totalAllowances = allowanceEntries.reduce((s, [, v]) => s + Number(v.amount || 0), 0);
            const other = slip.other_deductions || {};
            const unpaidLeave = Number(other.unpaid_leave || 0);
            const zakat = Number(other.zakat || 0);
            const reviewPenalty = Number(other.review_penalty?.amount || 0);
            const isImported = slip.computation_details?.source === "briohr_import";
            const importedGross = Number(slip.computation_details?.gross_additions || 0);

            return (
              <div key={slip.id} className="rounded-2xl border border-line bg-surface shadow-sm">
                <button
                  onClick={() => setExpanded(isOpen ? null : slip.id)}
                  className="flex w-full items-center justify-between p-4 text-left"
                >
                  <div>
                    <p className="font-semibold">{period}</p>
                    <p className="text-2xl font-bold text-brand-text">{fmt(slip.net_pay)}</p>
                  </div>
                  {isOpen ? <ChevronUp className="h-5 w-5 text-text-3" /> : <ChevronDown className="h-5 w-5 text-text-3" />}
                </button>

                {isOpen && (
                  <div className="border-t px-4 pb-4 pt-3 text-sm">
                    {/* Earnings */}
                    <p className="mb-2 font-semibold text-ok-text">Earnings</p>
                    {/* Basic + every OT / day-type line, derived once in
                        pay-lines.ts so this page, the run page, the PDF and the
                        manager app cannot drift apart again. */}
                    {earningsLines({
                      basicSalary: Number(slip.basic_salary || 0),
                      isWeekly,
                      regularHours: Number(slip.total_regular_hours || 0),
                      hourlyRate,
                      ot1xAmount: Number(slip.ot_1x_amount || 0),
                      ot1_5xAmount: Number(slip.ot_1_5x_amount || 0),
                      ot2xAmount: Number(slip.ot_2x_amount || 0),
                      ot3xAmount: Number(slip.ot_3x_amount || 0),
                      details: (slip.computation_details || {}) as Record<string, unknown>,
                    }).map((line) => (
                      <Row key={line.key} label={line.label} detail={line.detail} value={fmt(line.amount)} />
                    ))}
                    {totalAllowances > 0 && allowanceEntries.map(([key, a]) => (
                      <Row
                        key={key}
                        label={key === "attendance" ? "Attendance allowance" : key === "performance" ? "Performance allowance" : key.replace(/_/g, " ")}
                        value={fmt(Number(a.amount))}
                      />
                    ))}
                    {isImported && importedGross > 0 && (
                      <Row label="Other earnings (imported)" value={fmt(importedGross)} />
                    )}
                    <Row label="Total gross" value={fmt(slip.total_gross)} bold />

                    {/* Deductions */}
                    <p className="mb-2 mt-4 font-semibold text-danger-text">Deductions</p>
                    <Row label="EPF (Employee)" value={`-${fmt(slip.epf_employee)}`} />
                    <Row label="SOCSO" value={`-${fmt(slip.socso_employee)}`} />
                    <Row label="EIS" value={`-${fmt(slip.eis_employee)}`} />
                    <Row label="PCB (Tax)" value={`-${fmt(slip.pcb_tax)}`} />
                    {unpaidLeave > 0 && <Row label="Unpaid leave" value={`-${fmt(unpaidLeave)}`} />}
                    {zakat > 0 && <Row label="Zakat" value={`-${fmt(zakat)}`} />}
                    {reviewPenalty > 0 && <Row label="Review penalty" value={`-${fmt(reviewPenalty)}`} />}
                    <Row label="Total deductions" value={`-${fmt(slip.total_deductions)}`} bold />

                    {/* Net */}
                    <div className="mt-4 rounded-xl bg-brand-soft p-3">
                      <Row label="Net pay" value={fmt(slip.net_pay)} bold />
                    </div>

                    {/* Download — official PDF (company details, statutory numbers,
                        YTD) suitable for loan / financing applications. */}
                    <a
                      href={`/api/hr/payslips/pdf?item_id=${slip.id}`}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-ink py-2.5 font-semibold text-on-ink active:scale-95"
                    >
                      <Download className="h-4 w-4" /> Download PDF
                    </a>

                    {/* Hours */}
                    <p className="mt-4 text-xs text-text-3">
                      {slip.total_regular_hours}h {isWeekly ? "clocked" : "regular"}{Number(slip.total_ot_hours) > 0 ? ` + ${slip.total_ot_hours}h OT` : ""}
                      {isWeekly && " · from staff app clock-in/out"}
                      {isImported && " · imported from BrioHR"}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, detail, bold }: { label: string; value: string; detail?: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between py-1 ${bold ? "font-semibold" : ""}`}>
      <span className="text-text-2">
        {label}
        {/* Quantity and rate. The Employment Act wants the hours and the rate
            shown rather than a lump sum; at this width they read better under
            the description than as their own columns. */}
        {detail ? <span className="ml-2 text-[11px] text-text-3">{detail}</span> : null}
      </span>
      <span>{value}</span>
    </div>
  );
}
