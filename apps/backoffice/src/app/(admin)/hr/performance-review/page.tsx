"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { toast } from "sonner";
import {
  Trophy, Loader2, Save, RotateCcw, PencilLine, AlertTriangle, Lock,
} from "lucide-react";
import { HrPageHeader } from "@/components/hr/page-header";

type Lever = {
  key: string; label: string; applicable: boolean; score: number;
  tier: "under" | "ok" | "perform"; slice: number; earned: number; detail: string;
};

type StaffSummary = {
  userId: string;
  name: string;
  fullName: string | null;
  outletName: string | null;
  eligible: boolean;
  levers: Lever[];
  performanceEarned: number;
  attendanceDeducted: number;
  reviewPenaltyTotal: number;
  totalEarned: number;
  totalMax: number;
  lateCount: number;
  absentCount: number;
};

type Override = {
  user_id: string;
  override_amount: number;
  computed_amount: number | null;
  reason: string;
  updated_at: string | null;
  updated_by_name: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TIER_STYLE: Record<string, string> = {
  perform: "bg-green-100 text-green-700",
  ok: "bg-amber-100 text-amber-700",
  under: "bg-red-100 text-red-700",
};
const rm = (n: number) => `RM ${Number(n || 0).toFixed(2)}`;

export default function PerformanceReviewPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const qs = new URLSearchParams({ year: String(year), month: String(month) });
  const { data, isLoading } = useFetch<{ staff: StaffSummary[] }>(`/api/hr/allowances?${qs}`);
  const { data: ovData, mutate: mutateOv } = useFetch<{ overrides: Override[] }>(
    `/api/hr/performance-overrides?${qs}`,
  );

  const [editing, setEditing] = useState<StaffSummary | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const staff = data?.staff || [];
  const overrideByUser = new Map((ovData?.overrides || []).map((o) => [o.user_id, o]));

  const open = (s: StaffSummary) => {
    const existing = overrideByUser.get(s.userId);
    setEditing(s);
    setAmount(existing ? String(existing.override_amount) : String(s.totalEarned.toFixed(2)));
    setReason(existing?.reason ?? "");
  };

  const save = async () => {
    if (!editing) return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < 0) { toast.error("Enter an amount of RM0 or more."); return; }
    if (!reason.trim()) { toast.error("A reason is required."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/hr/performance-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: editing.userId, year, month,
          override_amount: parsed,
          computed_amount: editing.totalEarned,
          reason: reason.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed");
      toast.success(body.message || "Saved.");
      setEditing(null);
      mutateOv();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  const clear = async (s: StaffSummary) => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/hr/performance-overrides?user_id=${s.userId}&year=${year}&month=${month}`,
        { method: "DELETE" },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed");
      toast.success(body.message || "Override removed.");
      mutateOv();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  const overriddenCount = overrideByUser.size;

  return (
    <div className="space-y-5">
      <HrPageHeader
        title="Performance review"
        description="What the levers scored, and what we actually pay. An override replaces the whole outcome for that month — deductions included — and needs a reason."
        action={
          <div className="flex gap-2">
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="rounded border bg-background px-3 py-1.5 text-sm">
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded border bg-background px-3 py-1.5 text-sm">
              {[now.getFullYear(), now.getFullYear() - 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        }
      />

      {overriddenCount > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-900">
          <PencilLine className="h-4 w-4 shrink-0" />
          <span>
            <strong>{overriddenCount}</strong> line{overriddenCount === 1 ? "" : "s"} manually overridden for
            {" "}{MONTHS[month - 1]} {year}. Recompute the payroll run for these to reach the payslips.
          </span>
        </div>
      )}

      <section className="rounded-xl border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <Trophy className="h-4 w-4" />
          {MONTHS[month - 1]} {year} — {staff.length} staff
        </h2>

        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : staff.length === 0 ? (
          <p className="rounded border bg-muted/10 p-4 text-center text-xs text-muted-foreground">
            No eligible staff for this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="py-2 pr-3 font-medium">Levers</th>
                  <th className="py-2 pr-3 text-right font-medium">Earned</th>
                  <th className="py-2 pr-3 text-right font-medium">Deductions</th>
                  <th className="py-2 pr-3 text-right font-medium">Computed</th>
                  <th className="py-2 pr-3 text-right font-medium">Paying</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => {
                  const ov = overrideByUser.get(s.userId);
                  const deductions = (s.attendanceDeducted || 0) + (s.reviewPenaltyTotal || 0);
                  const paying = ov ? ov.override_amount : s.totalEarned;
                  return (
                    <tr key={s.userId} className={`border-b last:border-0 ${ov ? "bg-amber-50/40" : ""}`}>
                      <td className="py-2 pr-3">
                        <div className="font-medium">{s.name}</div>
                        <div className="text-[11px] text-muted-foreground">{s.outletName || "—"}</div>
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap gap-1">
                          {s.levers.filter((l) => l.applicable).map((l) => (
                            <span key={l.key} title={l.detail}
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${TIER_STYLE[l.tier]}`}>
                              {l.label.split(" ")[0]} {l.score}%
                            </span>
                          ))}
                          {s.levers.every((l) => !l.applicable) && (
                            <span className="text-[11px] text-muted-foreground">not scored</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">{rm(s.performanceEarned)}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">
                        {deductions > 0 ? (
                          <span className="text-red-600" title={`${s.lateCount} late, ${s.absentCount} absent`}>
                            −{rm(deductions)}
                          </span>
                        ) : "—"}
                      </td>
                      <td className={`py-2 pr-3 text-right font-mono tabular-nums ${ov ? "text-muted-foreground line-through" : ""}`}>
                        {rm(s.totalEarned)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono font-semibold tabular-nums">
                        {rm(paying)}
                        {ov && (
                          <div className="text-[10px] font-normal text-amber-700" title={ov.reason}>
                            {ov.reason.length > 28 ? `${ov.reason.slice(0, 28)}…` : ov.reason}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => open(s)}
                            className="rounded-lg border px-2 py-1 text-xs font-medium hover:bg-muted">
                            {ov ? "Edit" : "Override"}
                          </button>
                          {ov && (
                            <button onClick={() => clear(s)} disabled={busy} title="Remove override"
                              className="rounded-lg border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
                              <RotateCcw className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border bg-card p-5">
            <h3 className="mb-1 font-semibold">Override — {editing.name}</h3>
            <p className="mb-4 text-xs text-muted-foreground">
              {MONTHS[month - 1]} {year}. The engine computed <strong>{rm(editing.totalEarned)}</strong>
              {" "}({rm(editing.performanceEarned)} earned
              {(editing.attendanceDeducted + editing.reviewPenaltyTotal) > 0 &&
                <> less {rm(editing.attendanceDeducted + editing.reviewPenaltyTotal)} deductions</>}).
            </p>

            <div className="mb-3 rounded-lg border bg-muted/20 p-3">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Lever detail</div>
              <ul className="space-y-0.5 text-xs">
                {editing.levers.map((l) => (
                  <li key={l.key} className="flex justify-between gap-3">
                    <span className={l.applicable ? "" : "text-muted-foreground"}>{l.label}</span>
                    <span className="text-right text-muted-foreground">{l.detail}</span>
                  </li>
                ))}
              </ul>
              {(editing.lateCount > 0 || editing.absentCount > 0) && (
                <div className="mt-2 flex items-center gap-1 text-[11px] text-red-600">
                  <AlertTriangle className="h-3 w-3" />
                  {editing.lateCount} late · {editing.absentCount} absent — −{rm(editing.attendanceDeducted)}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Pay this amount (RM)</span>
                <input type="number" step="0.01" min={0} value={amount}
                  onChange={(e) => setAmount(e.target.value)} className="input w-full" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  Reason <span className="text-terracotta">*</span>
                </span>
                <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
                  className="input w-full"
                  placeholder="e.g. absence on 12 Jul was approved leave, deduction waived" />
              </label>
              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                Replaces the whole outcome for this month, deductions included, and does not carry into
                the next month. Saved overrides only reach a payslip when the run is recomputed, and a
                confirmed or paid run can&apos;t be changed.
              </p>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded-lg border px-3 py-1.5 text-xs hover:bg-muted">Cancel</button>
              <button onClick={save} disabled={busy || !reason.trim()}
                className="flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-xs font-medium text-white hover:bg-terracotta-dark disabled:opacity-50">
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save override
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
