"use client";

import { useFetch } from "@/lib/use-fetch";
import { useMemo, useState } from "react";
import { Clock, CheckCircle2, XCircle, Loader2, Plus, AlertTriangle, Calendar, X, LogIn, LogOut, ClipboardCheck, UserRound, Hand } from "lucide-react";
import { toast } from "@celsius/ui";
import { HrPageHeader } from "@/components/hr/page-header";
import Link from "next/link";

// ─────────────────────────────────────────────────────────────────────────────
// Overtime = the LEDGER of OT decisions, not a second review queue.
//
// Owner 2026-09-03: "only the OT Ariff approves in attendance will be counted
// as OT on payroll" and "there is a lot of overlapping". Clocked overtime is
// approved on the Attendance Review page — confirming the day files the
// approved request. This page shows what landed (per person, per month, with
// the day's clock-ins behind each line), and holds the two things that do NOT
// come from a clock-in: staff pre-approval requests, and a manager's post-hoc
// entry for OT that was never clocked. Nothing here syncs from attendance any
// more; that generator now only runs from the attendance approval.
// ─────────────────────────────────────────────────────────────────────────────

type AttendanceLog = {
  id: string;
  user_id: string;
  clock_in: string;
  clock_out: string | null;
  overtime_hours: number | null;
  overtime_type: string | null;
  outlet_id: string | null;
};

type OTRequest = {
  id: string;
  user_id: string;
  outlet_id: string | null;
  date: string;
  request_type: "pre_approval" | "post_hoc";
  hours_requested: number;
  hours_approved: number | null;
  ot_type: string;
  reason: string;
  shift_start_time: string | null;
  shift_end_time: string | null;
  status: "pending" | "approved" | "rejected" | "partial" | "cancelled";
  requested_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  manager_notes: string | null;
  created_at: string;
  staff: { id: string; name: string; fullName: string | null } | null;
  attendance_logs?: AttendanceLog[];
};

type Tab = "pending" | "approved" | "rejected" | "all";
type Employee = { id: string; name: string; fullName: string | null };

// Requests the attendance approval files carry this prefix (lib/hr/ot-request-generator).
const AUTO_PREFIX = "Auto-created from attendance log";

// OT pays in 30-minute brackets (owner 2026-09-03: "pay the 0.5h"). The old
// page floored to whole hours, so a half-hour request showed as 0h and the
// approve button sent 0 — which the API refused, silently.
const toHalf = (h: number | null | undefined) => Math.floor((Number(h) || 0) * 2) / 2;
const fmtH = (h: number | null | undefined) => `${toHalf(h)}h`;

// UTC ISO → "HH:MM" in Asia/Kuala_Lumpur (MYT, UTC+8).
const fmtMyt = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const monthLabel = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-MY", { month: "long", year: "numeric", timeZone: "UTC" });
const monthRange = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, "0")}` };
};

function sourceOf(r: OTRequest): { label: string; icon: typeof Hand; cls: string } {
  if (r.reason?.startsWith(AUTO_PREFIX)) return { label: "Attendance approval", icon: ClipboardCheck, cls: "text-green-700" };
  if (r.request_type === "pre_approval") return { label: "Staff request", icon: UserRound, cls: "text-blue-700" };
  return { label: "Manager post-hoc", icon: Hand, cls: "text-purple-700" };
}

export default function OvertimeLedgerPage() {
  const months = useMemo(() => {
    const now = new Date(Date.now() + 8 * 3600 * 1000); // MYT
    const out: string[] = [];
    for (let i = 0; i < 12; i++) out.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
    return out;
  }, []);

  const [month, setMonth] = useState(months[0]);
  const [tab, setTab] = useState<Tab>("pending");
  const [userId, setUserId] = useState("");
  const { from, to } = monthRange(month);
  const qs = new URLSearchParams({ from, to });
  if (userId) qs.set("user_id", userId);
  // One fetch for the month, every status — the tabs and their counts are
  // sliced client-side so a count is never computed from an already-filtered
  // list (the old page showed "Approved (0)" while on the Pending tab).
  const { data, mutate, isLoading } = useFetch<{ requests: OTRequest[] }>(`/api/hr/overtime-requests?${qs.toString()}`);
  const { data: empData } = useFetch<{ employees: Employee[] }>("/api/hr/employees");
  const employees = useMemo(
    () => [...(empData?.employees ?? [])].sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [empData],
  );

  const all = useMemo(() => data?.requests ?? [], [data]);
  const counts = {
    pending: all.filter((r) => r.status === "pending").length,
    approved: all.filter((r) => r.status === "approved" || r.status === "partial").length,
    rejected: all.filter((r) => r.status === "rejected" || r.status === "cancelled").length,
  };
  const rows = all.filter((r) =>
    tab === "all" ? true
    : tab === "approved" ? r.status === "approved" || r.status === "partial"
    : tab === "rejected" ? r.status === "rejected" || r.status === "cancelled"
    : r.status === "pending",
  );
  const approvedHours = all.reduce((s, r) => s + ((r.status === "approved" || r.status === "partial") ? toHalf(r.hours_approved) : 0), 0);

  // Per-person totals for the month — what payroll will pay at premium rates.
  const byPerson = useMemo(() => {
    const m = new Map<string, { name: string; hours: number; days: number }>();
    for (const r of all) {
      if (r.status !== "approved" && r.status !== "partial") continue;
      const cur = m.get(r.user_id) ?? { name: r.staff?.name || r.user_id.slice(0, 8), hours: 0, days: 0 };
      cur.hours += toHalf(r.hours_approved);
      cur.days += 1;
      m.set(r.user_id, cur);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].hours - a[1].hours);
  }, [all]);

  const [reviewing, setReviewing] = useState<OTRequest | null>(null);
  const [newOT, setNewOT] = useState<{ user_id: string; date: string; hours: string; reason: string; ot_type: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const review = async (status: "approved" | "rejected" | "partial", hours?: number, reason?: string, notes?: string) => {
    if (!reviewing) return;
    setSaving(true);
    try {
      const res = await fetch("/api/hr/overtime-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: reviewing.id, status, hours_approved: hours, rejection_reason: reason, manager_notes: notes }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) { toast.error(j?.error ?? `Failed (${res.status}) — nothing was changed.`); return; }
      if (status === "rejected") toast.success("Rejected");
      else if (j?.payrollSynced === false) toast.error(`Approved ${hours}h, but payroll did not pick it up — the day's attendance log is rejected. Clear that first.`);
      else toast.success(`Approved ${hours}h · sent to payroll`);
      mutate();
      setReviewing(null);
    } catch {
      toast.error("Network error — nothing was changed.");
    } finally {
      setSaving(false);
    }
  };

  const createOT = async () => {
    if (!newOT?.user_id || !newOT?.date || !newOT?.hours || !newOT?.reason) return;
    setSaving(true);
    try {
      const res = await fetch("/api/hr/overtime-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: newOT.user_id,
          date: newOT.date,
          hours_requested: toHalf(Number(newOT.hours)),
          reason: newOT.reason,
          ot_type: newOT.ot_type,
          request_type: "post_hoc",
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) { toast.error(j?.error ?? `Failed (${res.status})`); return; }
      toast.success("OT entry created — approve it from the Pending tab");
      if (newOT.date.slice(0, 7) !== month) setMonth(newOT.date.slice(0, 7));
      setTab("pending");
      mutate();
      setNewOT(null);
    } catch {
      toast.error("Network error — nothing was changed.");
    } finally {
      setSaving(false);
    }
  };

  const statusPill = (s: string) => {
    const map: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800",
      approved: "bg-green-100 text-green-800",
      rejected: "bg-red-100 text-red-800",
      partial: "bg-blue-100 text-blue-800",
      cancelled: "bg-gray-100 text-gray-600",
    };
    return <span className={`rounded px-2 py-0.5 text-xs font-medium ${map[s] || "bg-gray-100"}`}>{s}</span>;
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <HrPageHeader
        title="Overtime"
        description={
          <>
            {monthLabel(month)}: <strong>{approvedHours}h</strong> approved across {byPerson.length} staff
            {counts.pending > 0 ? <> · <strong className="text-yellow-800">{counts.pending} pending</strong></> : null}
            . Clocked OT is approved on{" "}
            <Link href="/hr/attendance" className="text-terracotta underline">Attendance Review</Link>; this is the ledger.
          </>
        }
        action={
          <>
            <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border bg-card px-2.5 py-1.5 text-sm text-foreground" title="Month">
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            <select value={userId} onChange={(e) => setUserId(e.target.value)} className="rounded-lg border bg-card px-2.5 py-1.5 text-sm text-foreground" title="Staff">
              <option value="">All staff</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <button
              onClick={() => setNewOT({ user_id: "", date: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10), hours: "", reason: "", ot_type: "1.5x" })}
              className="flex items-center gap-1 rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white hover:bg-terracotta-dark"
              title="OT that was never clocked (e.g. worked from home, event) — enter it by hand"
            >
              <Plus className="h-4 w-4" /> Unclocked OT
            </button>
          </>
        }
      />

      {/* Month totals per person */}
      {byPerson.length > 0 && !userId && (
        <div className="flex flex-wrap gap-2">
          {byPerson.map(([id, p]) => (
            <button
              key={id}
              onClick={() => setUserId(id)}
              className="rounded-full border bg-card px-3 py-1 text-xs hover:border-terracotta"
              title={`${p.days} day${p.days === 1 ? "" : "s"} — click to filter`}
            >
              <span className="font-medium">{p.name}</span> <span className="text-muted-foreground">{p.hours}h</span>
            </button>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {([
          { k: "pending", l: `Pending (${counts.pending})`, icon: AlertTriangle },
          { k: "approved", l: `Approved (${counts.approved})`, icon: CheckCircle2 },
          { k: "rejected", l: `Rejected (${counts.rejected})`, icon: XCircle },
          { k: "all", l: `All (${all.length})`, icon: Calendar },
        ] as const).map((t) => {
          const Ic = t.icon;
          return (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium ${
                tab === t.k ? "border-terracotta text-terracotta" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <Ic className="h-4 w-4" /> {t.l}
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="rounded-xl border bg-card p-4">
        {isLoading && !data ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Clock className="mx-auto mb-2 h-8 w-8 opacity-30" />
            {tab === "pending" ? "Nothing pending — clocked OT is approved on Attendance Review" : `No ${tab === "all" ? "" : tab} OT in ${monthLabel(month)}`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Staff</th>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Hours</th>
                  <th className="py-2 pr-3">Rate</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3">Reason</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const src = sourceOf(r);
                  const Ic = src.icon;
                  return (
                    <tr key={r.id} className="border-b last:border-b-0 hover:bg-gray-50/50">
                      <td className="py-2.5 pr-3 font-medium">{r.staff?.name || "—"}</td>
                      <td className="py-2.5 pr-3">{r.date}</td>
                      <td className="py-2.5 pr-3">
                        {r.status === "pending" ? fmtH(r.hours_requested) : fmtH(r.hours_approved)}
                        {r.status === "partial" && <span className="ml-1 text-xs text-gray-500">of {fmtH(r.hours_requested)}</span>}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-xs">{r.ot_type}</td>
                      <td className="py-2.5 pr-3 text-xs">
                        <span className={`inline-flex items-center gap-1 ${src.cls}`}><Ic className="h-3.5 w-3.5" /> {src.label}</span>
                      </td>
                      <td className="max-w-[260px] truncate py-2.5 pr-3 text-xs text-gray-600" title={r.reason}>
                        {r.reason?.startsWith(AUTO_PREFIX) ? r.reason.replace(/^.*?—\s*/, "") : r.reason}
                      </td>
                      <td className="py-2.5 pr-3">{statusPill(r.status)}</td>
                      <td className="py-2.5 pr-3 text-right">
                        {r.status === "pending" ? (
                          <button onClick={() => setReviewing(r)} className="rounded bg-terracotta px-3 py-1 text-xs font-medium text-white hover:bg-terracotta-dark">
                            Review
                          </button>
                        ) : (
                          <button onClick={() => setReviewing(r)} className="rounded border px-3 py-1 text-xs font-medium text-gray-700 hover:bg-muted">
                            Details
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {reviewing && (
        <ReviewModal req={reviewing} onClose={() => setReviewing(null)} onDecide={review} saving={saving} />
      )}

      {/* Unclocked OT entry */}
      {newOT && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setNewOT(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Unclocked OT</h3>
              <button onClick={() => setNewOT(null)} className="rounded p-1 hover:bg-gray-100"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              For overtime with no clock-in behind it. If the person clocked in, approve the day on Attendance Review instead — that pays the clocked tail.
            </p>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Staff</span>
                <select value={newOT.user_id} onChange={(e) => setNewOT({ ...newOT, user_id: e.target.value })} className="w-full rounded border px-3 py-2 text-sm">
                  <option value="">— Select —</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Date of OT</span>
                <input type="date" value={newOT.date} onChange={(e) => setNewOT({ ...newOT, date: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Hours (½-hour steps)</span>
                  <input type="number" step="0.5" min="0.5" max="24" value={newOT.hours} onChange={(e) => setNewOT({ ...newOT, hours: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Rate</span>
                  <select value={newOT.ot_type} onChange={(e) => setNewOT({ ...newOT, ot_type: e.target.value })} className="w-full rounded border px-3 py-2 text-sm">
                    <option value="1.5x">1.5× — weekday</option>
                    <option value="2x">2× — rest day</option>
                    <option value="3x">3× — public holiday</option>
                    <option value="1x">1× — plain rate</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Reason</span>
                <textarea value={newOT.reason} onChange={(e) => setNewOT({ ...newOT, reason: e.target.value })} rows={3} className="w-full rounded border px-3 py-2 text-sm" placeholder="Why was OT needed, and why is there no clock-in?" />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setNewOT(null)} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
              <button
                onClick={createOT}
                disabled={saving || !newOT.user_id || !newOT.date || toHalf(Number(newOT.hours)) < 0.5 || !newOT.reason}
                className="flex items-center gap-1 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewModal({ req, onClose, onDecide, saving }: {
  req: OTRequest;
  onClose: () => void;
  onDecide: (status: "approved" | "rejected" | "partial", hours?: number, reason?: string, notes?: string) => void;
  saving: boolean;
}) {
  const decided = req.status !== "pending";
  const [hours, setHours] = useState(String(toHalf(decided ? req.hours_approved : req.hours_requested)));
  const [notes, setNotes] = useState(req.manager_notes ?? "");
  const [rejectionReason, setRejectionReason] = useState(req.rejection_reason ?? "");
  const src = sourceOf(req);

  const logs = req.attendance_logs || [];
  const h = toHalf(Number(hours));
  const requested = toHalf(req.hours_requested);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{decided ? "OT details" : "Review OT request"}</h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="mb-4 rounded-lg bg-gray-50 p-3 text-sm">
          <div className="font-semibold">{req.staff?.name}</div>
          <div className="mt-1 text-xs text-gray-600">
            {req.date} · <strong>{fmtH(decided ? req.hours_approved : req.hours_requested)}</strong> at <strong>{req.ot_type}</strong>
            {decided && req.status === "partial" ? ` (of ${fmtH(req.hours_requested)} requested)` : ""} · <span className={src.cls}>{src.label}</span>
          </div>
          <p className="mt-2 text-sm">{req.reason}</p>
          {decided && (
            <p className="mt-2 text-xs text-gray-500">
              {req.status} {req.reviewed_at ? `on ${req.reviewed_at.slice(0, 10)}` : ""}
              {req.rejection_reason ? ` — ${req.rejection_reason}` : ""}{req.manager_notes ? ` · ${req.manager_notes}` : ""}
            </p>
          )}
        </div>

        {logs.length > 0 ? (
          <div className="mb-4 rounded-lg border border-gray-200 bg-white p-3 text-sm">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Clock-ins that day</div>
            <div className="divide-y">
              {logs.map((l) => {
                const mins = l.clock_out ? Math.round((new Date(l.clock_out).getTime() - new Date(l.clock_in).getTime()) / 60000) : null;
                const duration = mins != null ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m` : "ongoing";
                return (
                  <div key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-xs">
                    <span className="flex items-center gap-1 text-gray-700"><LogIn className="h-3.5 w-3.5 text-green-600" /><span className="font-mono">{fmtMyt(l.clock_in)}</span></span>
                    <span className="flex items-center gap-1 text-gray-700"><LogOut className="h-3.5 w-3.5 text-red-600" /><span className="font-mono">{l.clock_out ? fmtMyt(l.clock_out) : "—"}</span></span>
                    <span className="text-gray-500">{duration}</span>
                    {l.overtime_hours != null && Number(l.overtime_hours) > 0 && (
                      <span className="ml-auto rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[11px] text-amber-800">
                        OT {toHalf(l.overtime_hours)}h{l.overtime_type ? ` · ${l.overtime_type}` : ""}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="mb-4 flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> No clock-in on this date — this OT is unclocked.</p>
        )}

        {!decided && (
          <>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Hours to approve (½-hour steps)</span>
                <input
                  type="number" step="0.5" min="0.5" max={requested}
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  className="w-full rounded border px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Manager notes (optional)</span>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded border px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Rejection reason (only if rejecting)</span>
                <input value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" placeholder="e.g. No prior approval sought" />
              </label>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
              <button
                onClick={() => onDecide("rejected", 0, rejectionReason || "Rejected", notes)}
                disabled={saving}
                className="flex items-center gap-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Reject
              </button>
              <button
                onClick={() => onDecide(h < requested ? "partial" : "approved", h, undefined, notes)}
                disabled={saving || h < 0.5 || h > requested}
                className="flex items-center gap-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {h < requested ? `Approve ${h}h of ${requested}h` : `Approve ${h}h`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
