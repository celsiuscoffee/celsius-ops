"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import Link from "next/link";
import { Receipt, ChevronDown, ChevronUp, ArrowLeft } from "lucide-react";

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
    period_month: number;
    period_year: number;
    confirmed_at: string;
  };
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function PayslipsPage() {
  const { data } = useFetch<{ payslips: Payslip[] }>("/api/hr/payslips");
  const [expanded, setExpanded] = useState<string | null>(null);

  const payslips = data?.payslips || [];
  const fmt = (n: number) => `RM ${Number(n || 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

  return (
    <div className="px-4 pt-6">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/hr"
          aria-label="Back"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600 active:scale-95 active:bg-gray-200"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold">Payslips</h1>
      </div>

      {payslips.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 py-16 text-center">
          <Receipt className="mb-3 h-12 w-12 text-gray-300" />
          <p className="font-semibold text-gray-500">No payslips yet</p>
          <p className="text-sm text-gray-400">Payslips appear after payroll is confirmed</p>
        </div>
      ) : (
        <div className="space-y-3">
          {payslips.map((slip) => {
            const period = `${MONTHS[slip.hr_payroll_runs.period_month - 1]} ${slip.hr_payroll_runs.period_year}`;
            const isOpen = expanded === slip.id;
            const totalOT =
              Number(slip.ot_1x_amount || 0) +
              Number(slip.ot_1_5x_amount || 0) +
              Number(slip.ot_2x_amount || 0) +
              Number(slip.ot_3x_amount || 0);
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
              <div key={slip.id} className="rounded-2xl border border-gray-100 bg-white shadow-sm">
                <button
                  onClick={() => setExpanded(isOpen ? null : slip.id)}
                  className="flex w-full items-center justify-between p-4 text-left"
                >
                  <div>
                    <p className="font-semibold">{period}</p>
                    <p className="text-2xl font-bold text-terracotta">{fmt(slip.net_pay)}</p>
                  </div>
                  {isOpen ? <ChevronUp className="h-5 w-5 text-gray-400" /> : <ChevronDown className="h-5 w-5 text-gray-400" />}
                </button>

                {isOpen && (
                  <div className="border-t px-4 pb-4 pt-3 text-sm">
                    {/* Earnings */}
                    <p className="mb-2 font-semibold text-green-700">Earnings</p>
                    <Row label="Basic Salary" value={fmt(slip.basic_salary)} />
                    {totalOT > 0 && (
                      <>
                        {Number(slip.ot_1x_amount) > 0 && <Row label="OT 1x" value={fmt(slip.ot_1x_amount)} />}
                        {Number(slip.ot_1_5x_amount) > 0 && <Row label="OT 1.5x" value={fmt(slip.ot_1_5x_amount)} />}
                        {Number(slip.ot_2x_amount) > 0 && <Row label="OT 2x (Rest Day)" value={fmt(slip.ot_2x_amount)} />}
                        {Number(slip.ot_3x_amount) > 0 && <Row label="OT 3x (PH)" value={fmt(slip.ot_3x_amount)} />}
                      </>
                    )}
                    {totalAllowances > 0 && allowanceEntries.map(([key, a]) => (
                      <Row
                        key={key}
                        label={key === "attendance" ? "Attendance Allowance" : key === "performance" ? "Performance Allowance" : key.replace(/_/g, " ")}
                        value={fmt(Number(a.amount))}
                      />
                    ))}
                    {isImported && importedGross > 0 && (
                      <Row label="Other Earnings (imported)" value={fmt(importedGross)} />
                    )}
                    <Row label="Total Gross" value={fmt(slip.total_gross)} bold />

                    {/* Deductions */}
                    <p className="mb-2 mt-4 font-semibold text-red-700">Deductions</p>
                    <Row label="EPF (Employee)" value={`-${fmt(slip.epf_employee)}`} />
                    <Row label="SOCSO" value={`-${fmt(slip.socso_employee)}`} />
                    <Row label="EIS" value={`-${fmt(slip.eis_employee)}`} />
                    <Row label="PCB (Tax)" value={`-${fmt(slip.pcb_tax)}`} />
                    {unpaidLeave > 0 && <Row label="Unpaid Leave" value={`-${fmt(unpaidLeave)}`} />}
                    {zakat > 0 && <Row label="Zakat" value={`-${fmt(zakat)}`} />}
                    {reviewPenalty > 0 && <Row label="Review Penalty" value={`-${fmt(reviewPenalty)}`} />}
                    <Row label="Total Deductions" value={`-${fmt(slip.total_deductions)}`} bold />

                    {/* Net */}
                    <div className="mt-4 rounded-xl bg-terracotta/10 p-3">
                      <Row label="Net Pay" value={fmt(slip.net_pay)} bold />
                    </div>

                    {/* Hours */}
                    <p className="mt-4 text-xs text-gray-400">
                      {slip.total_regular_hours}h regular{Number(slip.total_ot_hours) > 0 ? ` + ${slip.total_ot_hours}h OT` : ""}
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

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between py-1 ${bold ? "font-semibold" : ""}`}>
      <span className="text-gray-600">{label}</span>
      <span>{value}</span>
    </div>
  );
}
