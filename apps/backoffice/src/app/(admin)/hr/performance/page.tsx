"use client";

// ONE performance screen (owner 2026-08-03: "consolidate these two, remove the
// old build"). Two tabs over the same month:
//
//   Allowance   — what the levers scored, what was deducted, what we pay, and
//                 the corrections: waive a single deduction, or (owner/admin)
//                 replace the whole month.
//   Scorecard   — the composite attendance/ops/reviews/audit view that used to
//                 be its own page at this URL.
//
// The Allowance tab is the one that touches pay, so it only renders for
// OWNER / ADMIN / MANAGER; the API scopes a manager to their own subtree and
// to line waivers regardless of what the UI shows.

import { useFetch } from "@/lib/use-fetch";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Trophy, Loader2, AlertTriangle, Lock, X, Undo2, PencilLine, TrendingUp,
} from "lucide-react";
import { HrPageHeader } from "@/components/hr/page-header";
import { PerformanceScorecard } from "@/components/hr/performance-scorecard";

type Lever = {
  key: string; lineKey: string; label: string; applicable: boolean; score: number;
  tier: "under" | "ok" | "perform"; slice: number; earned: number; detail: string;
  originalEarned: number; edited: boolean; editReason: string | null;
};

type Deduction = {
  key: string;
  kind: "late" | "absent" | "review";
  label: string;
  date: string | null;
  amount: number;
  originalAmount: number;
  edited: boolean;
  editReason: string | null;
};

type StaffSummary = {
  userId: string;
  name: string;
  fullName: string | null;
  outletName: string | null;
  eligible: boolean;
  levers: Lever[];
  deductions: Deduction[];
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
  line_key: string;
  amount: number;
  computed_amount: number | null;
  label: string | null;
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
const KIND_LABEL: Record<Deduction["kind"], string> = {
  late: "Late", absent: "Absent", review: "Review",
};
const rm = (n: number) => `RM ${Number(n || 0).toFixed(2)}`;

type Tab = "allowance" | "scorecard";

export default function PerformancePage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [tab, setTab] = useState<Tab>("allowance");

  // Caller role — the Allowance tab mirrors the API, which is
  // OWNER/ADMIN/MANAGER only. Staff with hr:performance still get the scorecard.
  const [me, setMe] = useState<{ role: string } | null>(null);
  useEffect(() => {
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setMe({ role: d.role }); });
  }, []);
  const canSeeAllowance = !!me && ["OWNER", "ADMIN", "MANAGER"].includes(me.role);
  // Default to the scorecard for anyone who can't see allowances at all.
  const activeTab: Tab = canSeeAllowance ? tab : "scorecard";

  const qs = new URLSearchParams({ year: String(year), month: String(month) });
  const { data, isLoading, mutate: mutateStaff } = useFetch<{ staff: StaffSummary[] }>(
    canSeeAllowance ? `/api/hr/allowances?${qs}` : null,
  );
  const { data: ovData, mutate: mutateOv } = useFetch<{
    overrides: Override[];
    locked: { status: string } | null;
  }>(canSeeAllowance ? `/api/hr/performance-overrides?${qs}` : null);

  // Hold the id, not the row: the modal stays open across saves, and deriving
  // it from `staff` means an edit re-renders the open panel with fresh figures
  // instead of leaving a stale copy on screen.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Per-line draft state, keyed by line key. `amount` is only used by levers;
  // a deduction is waived to 0.
  const [draftReason, setDraftReason] = useState<Record<string, string>>({});
  const [draftAmount, setDraftAmount] = useState<Record<string, string>>({});

  const staff = data?.staff || [];
  // A confirmed or paid run has gone to KWSP/LHDN and the bank. Say so once, at
  // the top, instead of letting someone fill in a form that will 409.
  const locked = ovData?.locked ?? null;
  const editing = editingId ? staff.find((s) => s.userId === editingId) ?? null : null;

  const refresh = async () => { await Promise.all([mutateStaff(), mutateOv()]); };

  const open = (s: StaffSummary) => {
    setEditingId(s.userId);
    setDraftReason({});
    setDraftAmount(Object.fromEntries(s.levers.map((l) => [l.lineKey, l.earned.toFixed(2)])));
  };

  const post = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      const res = await fetch("/api/hr/performance-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month, ...body }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed");
      toast.success(payload.message || "Saved.");
      await refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
      return false;
    } finally { setBusy(null); }
  };

  const del = async (params: Record<string, string>, key: string) => {
    setBusy(key);
    try {
      const res = await fetch(`/api/hr/performance-overrides?${new URLSearchParams(params)}`, { method: "DELETE" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed");
      toast.success(payload.message || "Done.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(null); }
  };

  // Save one line. The button is deliberately NOT disabled when the reason is
  // blank — a dead button reads as "the system won't let me", which is exactly
  // how it was misread. Click it and it says what's missing.
  const saveLine = async (
    s: StaffSummary,
    o: { lineKey: string; label: string; amount: number; computed: number },
  ) => {
    const why = (draftReason[o.lineKey] || "").trim();
    if (!why) { toast.error(`Say why "${o.label}" is being changed.`); return; }
    if (!Number.isFinite(o.amount) || o.amount < 0) { toast.error("Enter an amount of RM0 or more."); return; }
    const ok = await post(
      { user_id: s.userId, line_key: o.lineKey, amount: o.amount, computed_amount: o.computed, label: o.label, reason: why },
      o.lineKey,
    );
    if (ok) setDraftReason((prev) => ({ ...prev, [o.lineKey]: "" }));
  };

  const resetLine = (s: StaffSummary, lineKey: string) =>
    del({ user_id: s.userId, year: String(year), month: String(month), line_key: lineKey }, lineKey);

  const editedCount = (ovData?.overrides || []).length;

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "allowance", label: "Allowance", icon: <Trophy className="h-4 w-4" /> },
    { id: "scorecard", label: "Scorecard", icon: <TrendingUp className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <HrPageHeader
        title="Performance"
        icon={<TrendingUp className="h-6 w-6 text-terracotta" />}
        description={
          activeTab === "allowance"
            ? "What the levers scored, what was deducted, and what we actually pay. Waive a single deduction, or replace the month outright."
            : "Attendance, hours, leave, ops compliance & customer feedback — composite monthly score per staff."
        }
        action={
          <div className="flex gap-2">
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="rounded-lg border bg-background px-3 py-2 text-sm">
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-lg border bg-background px-3 py-2 text-sm">
              {[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        }
      />

      {canSeeAllowance && (
        <div className="flex gap-1 border-b">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === t.id
                  ? "border-terracotta text-terracotta"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      )}

      {activeTab === "scorecard" && <PerformanceScorecard year={year} month={month} />}

      {activeTab === "allowance" && (
      <div className="space-y-6">
      {locked && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50/60 px-4 py-3.5 text-sm text-red-900">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="leading-relaxed">
            The {MONTHS[month - 1]} {year} payroll run is <strong>{locked.status}</strong> — it has gone to
            KWSP/LHDN and the bank. Nothing on this page can change it.
          </span>
        </div>
      )}

      {editedCount > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3.5 text-sm text-amber-900">
          <PencilLine className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="leading-relaxed">
            <strong>{editedCount}</strong> line{editedCount === 1 ? "" : "s"} set by hand for
            {" "}{MONTHS[month - 1]} {year}.
            {" "}<strong>Recompute the payroll run</strong> for these to reach the payslips.
          </span>
        </div>
      )}

      <section className="rounded-xl border bg-card">
        <h2 className="flex items-center gap-2 border-b px-5 py-4 font-semibold">
          <Trophy className="h-4 w-4" />
          {MONTHS[month - 1]} {year}
          <span className="text-sm font-normal text-muted-foreground">· {staff.length} staff</span>
        </h2>

        {isLoading ? (
          <div className="flex justify-center py-14"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : staff.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">No eligible staff for this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Levers</th>
                  <th className="px-4 py-3 text-right font-medium">Earned</th>
                  <th className="px-4 py-3 text-right font-medium">Deductions</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => {
                  const deductions = (s.attendanceDeducted || 0) + (s.reviewPenaltyTotal || 0);
                  const edits = s.levers.filter((l) => l.edited).length + s.deductions.filter((d) => d.edited).length;
                  return (
                    <tr key={s.userId} className={`border-b align-top last:border-0 ${edits > 0 ? "bg-amber-50/40" : ""}`}>
                      <td className="px-5 py-3.5">
                        <div className="font-medium">{s.name}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{s.outletName || "—"}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex max-w-[240px] flex-wrap gap-1.5">
                          {s.levers.filter((l) => l.applicable || l.edited).map((l) => (
                            <span key={l.key} title={l.detail}
                              className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${l.edited ? "bg-amber-100 text-amber-800" : TIER_STYLE[l.tier]}`}>
                              {l.label.split(" ")[0]} {l.edited ? rm(l.earned) : `${l.score}%`}
                            </span>
                          ))}
                          {s.levers.every((l) => !l.applicable && !l.edited) && (
                            <span className="text-xs text-muted-foreground">not scored</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums">{rm(s.performanceEarned)}</td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                        {deductions > 0 ? (
                          <span className="text-red-600" title={`${s.lateCount} late, ${s.absentCount} absent`}>
                            −{rm(deductions)}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                        {rm(s.totalEarned)}
                        {edits > 0 && (
                          <div className="mt-0.5 text-[11px] font-normal text-amber-700">
                            {edits} line{edits === 1 ? "" : "s"} by hand
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <button onClick={() => open(s)}
                          className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                          Review
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </div>
      )}

      {editing && activeTab === "allowance" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl border bg-card shadow-xl">
            {/* header */}
            <div className="flex items-start justify-between gap-4 border-b px-6 py-5">
              <div>
                <h3 className="font-semibold">{editing.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {MONTHS[month - 1]} {year} · paying <strong>{rm(editing.totalEarned)}</strong>
                  {" "}({rm(editing.performanceEarned)} earned
                  {(editing.attendanceDeducted + editing.reviewPenaltyTotal) > 0 &&
                    <> less {rm(editing.attendanceDeducted + editing.reviewPenaltyTotal)} deductions</>})
                </p>
              </div>
              <button onClick={() => setEditingId(null)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* body */}
            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <section className="space-y-2.5">
                <h4 className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Levers
                  <span className="font-normal normal-case tracking-normal">— set any lever by hand when the score isn&apos;t fair</span>
                </h4>
                <ul className="divide-y rounded-lg border">
                  {editing.levers.map((l) => (
                    <li key={l.key} className={`px-3.5 py-3 ${l.edited ? "bg-amber-50/50" : ""}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className={l.applicable || l.edited ? "text-sm font-medium" : "text-sm text-muted-foreground"}>
                            {l.label}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">{l.detail}</div>
                          {l.edited && (
                            <div className="mt-1 text-xs text-amber-700">
                              Engine scored {rm(l.originalEarned)}
                              {l.applicable && l.slice > 0 && <> of {rm(l.slice)}</>}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-muted-foreground">RM</span>
                            <input
                              type="number" step="0.01" min={0}
                              value={draftAmount[l.lineKey] ?? l.earned.toFixed(2)}
                              onChange={(e) => setDraftAmount((p) => ({ ...p, [l.lineKey]: e.target.value }))}
                              disabled={!!locked}
                              className="input w-24 text-right font-mono text-sm tabular-nums disabled:opacity-50"
                            />
                          </div>
                          {l.edited ? (
                            <button onClick={() => resetLine(editing, l.lineKey)} disabled={busy !== null || !!locked}
                              title="Hand this lever back to the engine"
                              className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50">
                              {busy === l.lineKey ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
                              Reset
                            </button>
                          ) : (
                            <button
                              onClick={() => saveLine(editing, {
                                lineKey: l.lineKey, label: l.label,
                                amount: Number(draftAmount[l.lineKey] ?? l.earned), computed: l.originalEarned,
                              })}
                              disabled={busy !== null || !!locked}
                              className="rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">
                              {busy === l.lineKey ? <Loader2 className="h-3 w-3 animate-spin" /> : "Set"}
                            </button>
                          )}
                        </div>
                      </div>
                      <input
                        type="text"
                        value={draftReason[l.lineKey] || (l.edited ? l.editReason ?? "" : "")}
                        onChange={(e) => setDraftReason((p) => ({ ...p, [l.lineKey]: e.target.value }))}
                        disabled={!!locked}
                        className="input mt-2.5 w-full text-xs disabled:opacity-50"
                        placeholder="Why? e.g. no checklists were assigned to this outlet in July"
                      />
                    </li>
                  ))}
                </ul>
              </section>

              <section className="space-y-2.5">
                <h4 className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Deductions
                  {editing.deductions.length > 0 && (
                    <span className="font-normal normal-case tracking-normal">— waive any line that shouldn&apos;t count</span>
                  )}
                </h4>
                {editing.deductions.length === 0 ? (
                  <p className="rounded-lg border bg-muted/20 px-3.5 py-3 text-sm text-muted-foreground">
                    Nothing deducted this month.
                  </p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {editing.deductions.map((d) => (
                      <li key={d.key} className={`px-3.5 py-3 ${d.edited ? "bg-amber-50/50" : ""}`}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                {KIND_LABEL[d.kind]}
                              </span>
                              {d.date && <span className="text-xs text-muted-foreground">{d.date}</span>}
                            </div>
                            <div className="mt-1 truncate text-sm">{d.label}</div>
                            {d.edited && d.editReason && (
                              <div className="mt-1 text-xs text-amber-700">Waived — {d.editReason}</div>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <span className={`font-mono text-sm tabular-nums ${d.edited ? "text-muted-foreground line-through" : "text-red-600"}`}>
                              −{rm(d.originalAmount)}
                            </span>
                            {d.edited ? (
                              <button onClick={() => resetLine(editing, d.key)} disabled={busy !== null || !!locked}
                                className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50">
                                {busy === d.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
                                Restore
                              </button>
                            ) : (
                              <button
                                onClick={() => saveLine(editing, { lineKey: d.key, label: d.label, amount: 0, computed: d.originalAmount })}
                                disabled={busy !== null || !!locked}
                                className="rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">
                                {busy === d.key ? <Loader2 className="h-3 w-3 animate-spin" /> : "Waive"}
                              </button>
                            )}
                          </div>
                        </div>
                        {!d.edited && (
                          <input
                            type="text"
                            value={draftReason[d.key] || ""}
                            onChange={(e) => setDraftReason((p) => ({ ...p, [d.key]: e.target.value }))}
                            disabled={!!locked}
                            className="input mt-2.5 w-full text-xs disabled:opacity-50"
                            placeholder="Why waive this? e.g. approved leave, roster changed verbally"
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                Every edit needs a reason and applies to this month only — next month goes back to the levers.
                A lever can be set up to the {rm(editing.totalMax)} pool; a deduction can only be reduced.
              </p>
            </div>

            {/* footer */}
            <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Changes reach a payslip only when the run is recomputed. A confirmed or paid run can&apos;t be changed.
              </p>
              <button onClick={() => setEditingId(null)}
                className="shrink-0 rounded-lg border px-3.5 py-2 text-xs font-medium hover:bg-muted">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
