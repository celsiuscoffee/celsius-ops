"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { Bot, Banknote, Loader2, CheckCircle2, FileText, CalendarDays, Download, FileSpreadsheet, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { HrPageHeader } from "@/components/hr/page-header";
import { KeyNumber } from "@/components/ui/key-number";

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
  // jsonb: the RM200 performance pool under `performance`, plus any recurring
  // catalog items keyed by their code (negative amount = pre-tax deduction).
  allowances: Record<string, {
    amount?: number;
    pool?: number;
    /** Present only on a partial month — the pool before proration. */
    prorated_from?: number;
    prorate_days_worked?: number;
    prorate_days_total?: number;
  }> | null;
};

/**
 * The performance allowance actually paid on a line — already net of the
 * attendance and negative-review deductions, and prorated for a partial month.
 * Gross was previously the only place this showed up, which made a line like
 * "basic 354.84, gross 534.84" impossible to read off the table.
 */
function perfAllowance(item: PayrollItem): number {
  return Number(item.allowances?.performance?.amount ?? 0);
}

import { monthlyCycleEndMs, cycleStillOpen, lastEndedCycle } from "@/lib/hr/cycle-window";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function PayrollPage() {
  const now = new Date();
  // Default to the month that just ENDED, not the current one — the current
  // month cannot be computed (see lib/hr/cycle-window), so defaulting to it
  // opened the page on a disabled option.
  const defaultCycle = lastEndedCycle(now.getTime());
  const [month, setMonth] = useState(defaultCycle.month);
  const [year, setYear] = useState(defaultCycle.year);
  const { data, mutate } = useFetch<{ runs: PayrollRun[] }>("/api/hr/payroll");
  const [computing, setComputing] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [result, setResult] = useState<{ notes: string[] } | null>(null);
  const [viewRunId, setViewRunId] = useState<string | null>(null);
  const { data: detailData } = useFetch<{ run: PayrollRun; items: PayrollItem[] }>(
    viewRunId ? `/api/hr/payroll?run_id=${viewRunId}` : null,
  );

  const runs = data?.runs || [];
  // Latest and previous run by period, for the key numbers. These only read
  // totals the run list already shows; no pay is worked out here.
  const byPeriod = [...runs].sort((a, b) => (b.period_year * 12 + b.period_month) - (a.period_year * 12 + a.period_month));
  const latest = byPeriod[0];
  const previous = byPeriod[1];
  const waitingToConfirm = runs.filter((r) => r.status === "ai_computed").length;
  const STATUS_WORD: Record<string, string> = { ai_computed: "Computed", confirmed: "Confirmed", paid: "Paid", draft: "Draft" };

  // Fetch-based download (not window.location) so the route can refuse with a
  // JSON 409 we can actually SHOW — the bank file omits staff with no bank
  // account / non-positive net, and that omission used to travel only in a
  // response header nobody read. On a skipped-staff 409 the operator sees who
  // will be left out and explicitly acknowledges before the file is produced.
  const downloadFile = async (url: string) => {
    const res = await fetch(url);
    if (res.status === 409) {
      const body = await res.json().catch(() => null);
      if (body?.reason === "skipped_staff") {
        const names = (body.skipped as { name: string; why: string }[])
          .map((s) => `• ${s.name} — ${s.why}`)
          .join("\n");
        const ok = window.confirm(
          `This payment file will OMIT ${body.skipped.length} staff:\n\n${names}\n\nThey will NOT be paid by this upload. Generate the file anyway?`,
        );
        if (!ok) return;
        return downloadFile(`${url}&ack_skips=1`);
      }
      alert(body?.error || "Could not generate the file.");
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      alert(body?.error || `Download failed (${res.status})`);
      return;
    }
    const blob = await res.blob();
    const dispo = res.headers.get("Content-Disposition") || "";
    const filename = /filename="([^"]+)"/.exec(dispo)?.[1] || "download";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
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

  const handleConfirm = async (runId: string, overrides: Record<string, boolean> = {}) => {
    setConfirming(runId);
    try {
      const res = await fetch("/api/hr/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", run_id: runId, ...overrides }),
      });
      if (res.ok) {
        mutate();
        return;
      }
      const body = await res.json().catch(() => null);
      // Guards with a deliberate escape hatch offer their override inline —
      // each one requires its own explicit yes, and every override is
      // audit-logged server-side. Negative net and empty runs have no
      // override on purpose.
      const OVERRIDABLE: Record<string, string> = {
        cycle_not_ended: "allow_early_confirm",
        missing_bank: "allow_missing_bank",
        resignation_not_prorated: "allow_unprorated_resignation",
      };
      const flag = body?.reason ? OVERRIDABLE[body.reason] : undefined;
      if (flag && !overrides[flag]) {
        if (confirm(`${body.error}\n\nConfirm anyway?`)) {
          setConfirming(null);
          await handleConfirm(runId, { ...overrides, [flag]: true });
        }
        return;
      }
      alert(body?.error || "Confirm failed");
    } finally {
      setConfirming(null);
    }
  };

  // Revert takes a confirmed run back to ai_computed IN PLACE (same run id) so
  // it can be recomputed. This is the recovery path DELETE points at — deleting
  // a confirmed run is refused since the July 2026 data loss.
  const [reverting, setReverting] = useState<string | null>(null);
  const handleRevert = async (runId: string) => {
    if (!confirm("Revert this confirmed run to computed? Payslips and bank files already generated from it will no longer match until it is re-confirmed.")) return;
    setReverting(runId);
    try {
      const res = await fetch("/api/hr/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revert", run_id: runId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        alert(body?.error || "Revert failed");
      }
      mutate();
    } finally {
      setReverting(null);
    }
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const handleDelete = async (runId: string) => {
    if (!confirm("Delete this payroll run? All its lines will be removed.")) return;
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

  // Key numbers round to whole ringgit so they fit a phone; the run list keeps sen.
  const rmWhole = (n: number) => `RM ${Math.round(Number(n || 0)).toLocaleString("en-MY")}`;
  const fmt = (n: number) => `RM ${Number(n || 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6 px-4 pt-6 pb-10 md:px-8">
      <HrPageHeader
        title="Payroll"
        description="Monthly pay for full-time staff: which months are computed, confirmed and paid, and what each one cost."
        action={
          <Link
            href="/hr/payroll/weekly"
            className="inline-flex h-10 items-center gap-1.5 rounded-ctl border border-line px-3 text-sm font-medium hover:bg-sunken"
          >
            <CalendarDays className="h-4 w-4" />
            Weekly pay (part-time)
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KeyNumber word label="Latest month" value={data ? (latest ? `${MONTHS[latest.period_month - 1]} ${latest.period_year}` : "None yet") : null}
          note={latest ? (STATUS_WORD[latest.status] ?? latest.status.replace("_", " ")) : "no runs yet"} />
        <KeyNumber label="Net pay, latest month" value={data ? (latest ? rmWhole(latest.total_net) : "–") : null}
          note={latest ? <>gross <b className="font-semibold text-text-2">{rmWhole(latest.total_gross)}</b></> : "—"} />
        <KeyNumber label="Cost to us, latest month" value={data ? (latest ? rmWhole(latest.total_employer_cost) : "–") : null}
          note={previous ? <>{MONTHS[previous.period_month - 1]}: <b className="font-semibold text-text-2">{rmWhole(previous.total_employer_cost)}</b></> : "no month before to compare"} />
        <KeyNumber label="Waiting to confirm" value={data ? String(waitingToConfirm) : null} tone={waitingToConfirm > 0 ? "warn" : undefined}
          note={waitingToConfirm > 0 ? "computed, not confirmed yet" : "nothing waiting"} />
      </div>

      {/* Compute Controls */}
      <div className="rounded-card border border-line bg-surface p-5">
        <h2 className="mb-4 flex items-center gap-2 font-semibold">
          <Bot className="h-5 w-5 text-brand-text" />
          Compute a month
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-2">Month</span>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
              {/* A cycle that has not ended cannot be computed — basic salary
                  would compute in full against attendance that does not exist
                  yet. The API refuses it too; this stops it being picked. */}
              {MONTHS.map((m, i) => {
                const open = cycleStillOpen(monthlyCycleEndMs(year, i + 1), Date.now());
                return (
                  <option key={i} value={i + 1} disabled={open}>
                    {m}{open ? " — not ended" : ""}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-2">Year</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
              <option value={2025}>2025</option>
              <option value={2026}>2026</option>
            </select>
          </label>
          <button
            onClick={handleCompute}
            disabled={computing}
            className="flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-sunken disabled:opacity-50"
          >
            {computing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
            Quick compute
          </button>
          <Link
            href="/hr/payroll/run"
            className="flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-on-ink hover:bg-ink-hover"
          >
            <Bot className="h-4 w-4" /> Run payroll
          </Link>
        </div>
        {result && (
          <div className="mt-4 rounded-lg bg-sunken p-3 text-sm">
            {result.notes.map((n, i) => <p key={i} className="text-text-2">{n}</p>)}
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
            <div key={run.id} className="rounded-card border border-line bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{MONTHS[run.period_month - 1]} {run.period_year}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      isConfirmed ? "bg-ok-soft text-ok-text" :
                      isComputed ? "bg-info-soft text-info-text" :
                      "bg-sunken text-text-2"
                    }`}>
                      {STATUS_WORD[run.status] ?? run.status.replace("_", " ")}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[13px] text-text-2">
                    <span>Gross: {fmt(run.total_gross)}</span>
                    <span>Net: {fmt(run.total_net)}</span>
                    <span>Employer: {fmt(run.total_employer_cost)}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setViewRunId(isViewing ? null : run.id)}
                    className="inline-flex h-9 items-center gap-1 rounded-ctl border border-line px-3 text-xs font-medium hover:bg-sunken"
                  >
                    <FileText className="inline h-3 w-3 mr-1" />{isViewing ? "Hide" : "Details"}
                  </button>
                  {isComputed && (
                    <button
                      onClick={() => handleConfirm(run.id)}
                      disabled={confirming === run.id}
                      className="inline-flex h-9 items-center gap-1 rounded-ctl bg-ink px-3 text-xs font-medium text-on-ink hover:bg-ink-hover disabled:opacity-50"
                    >
                      {confirming === run.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                      Confirm
                    </button>
                  )}
                  {isConfirmed && (
                    <>
                      <CheckCircle2 className="h-5 w-5 text-ok-text" />
                      <button
                        onClick={() => handleRevert(run.id)}
                        disabled={reverting === run.id}
                        title="Revert to computed so the run can be recomputed (keeps the run)"
                        className="inline-flex h-9 items-center gap-1 rounded-ctl border border-line px-3 text-xs font-medium hover:bg-sunken disabled:opacity-50"
                      >
                        {reverting === run.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
                        Revert
                      </button>
                    </>
                  )}
                  {/* Confirmed and paid runs are not deletable server-side —
                      confirmed reverts instead, paid is a dead end. */}
                  {!isConfirmed && run.status !== "paid" && (
                    <button
                      onClick={() => handleDelete(run.id)}
                      disabled={deletingId === run.id}
                      title="Delete run"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-ctl border border-danger/30 text-xs font-medium text-danger-text hover:bg-danger-soft disabled:opacity-50"
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
                      className="inline-flex h-9 items-center gap-1.5 rounded-ctl border border-line px-3 text-xs font-medium hover:bg-sunken"
                    >
                      <FileText className="h-3 w-3" /> Payslips (all, PDF)
                    </button>
                    <button
                      onClick={() => downloadFile(`/api/hr/payroll/submission-files?run_id=${run.id}&type=maybank`)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-ctl border border-line px-3 text-xs font-medium hover:bg-sunken"
                    >
                      <Download className="h-3 w-3" /> Maybank M2u
                    </button>
                    <button
                      onClick={() => downloadFile(`/api/hr/payroll/submission-files?run_id=${run.id}&type=kwsp`)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-ctl border border-line px-3 text-xs font-medium hover:bg-sunken"
                    >
                      <FileSpreadsheet className="h-3 w-3" /> KWSP Form A
                    </button>
                    <button
                      onClick={() => downloadFile(`/api/hr/payroll/submission-files?run_id=${run.id}&type=perkeso`)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-ctl border border-line px-3 text-xs font-medium hover:bg-sunken"
                    >
                      <FileSpreadsheet className="h-3 w-3" /> PERKESO
                    </button>
                    <button
                      onClick={() => downloadFile(`/api/hr/payroll/submission-files?run_id=${run.id}&type=cp39`)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-ctl border border-line px-3 text-xs font-medium hover:bg-sunken"
                    >
                      <FileSpreadsheet className="h-3 w-3" /> CP39 (PCB)
                    </button>
                    <button
                      onClick={() => downloadFile(`/api/hr/payroll/submission-files?run_id=${run.id}&type=hrdf`)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-ctl border border-line px-3 text-xs font-medium hover:bg-sunken"
                    >
                      <FileSpreadsheet className="h-3 w-3" /> HRDF
                    </button>
                    <button
                      onClick={() => downloadFile(`/api/hr/payroll/submission-files?run_id=${run.id}&type=by_outlet`)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-ctl border border-line px-3 text-xs font-medium hover:bg-sunken"
                      title="Per-outlet cost (gross + employer contributions) with subtotals — what each outlet owes HQ"
                    >
                      <FileSpreadsheet className="h-3 w-3" /> By outlet (CSV)
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-left text-text-2">
                          <th className="pb-2 pr-3">Employee</th>
                          <th className="pb-2 pr-3 text-right">Basic</th>
                          <th className="pb-2 pr-3 text-right">OT</th>
                          <th className="pb-2 pr-3 text-right">Allowance</th>
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
                            <td
                              className="py-2 pr-3 text-right"
                              title={
                                item.allowances?.performance?.prorated_from != null
                                  ? `${fmt(item.allowances.performance.prorated_from)} earned, prorated to `
                                    + `${item.allowances.performance.prorate_days_worked}/`
                                    + `${item.allowances.performance.prorate_days_total} days`
                                  : undefined
                              }
                            >
                              {perfAllowance(item) > 0 ? fmt(perfAllowance(item)) : "—"}
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
                                className="text-brand-text hover:underline text-xs"
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
                <p className="border-t px-4 py-2 text-xs text-text-2">{run.ai_notes}</p>
              )}
            </div>
          );
        })}

        {runs.length === 0 && (
          <div className="rounded-card border border-line bg-surface py-16 text-center">
            <Banknote className="mx-auto mb-3 h-12 w-12 text-text-3" />
            <p className="text-lg font-semibold text-text">No payroll runs yet</p>
            <p className="text-sm text-text-2">Pick a month above and compute it.</p>
          </div>
        )}
      </div>
    </div>
  );
}
