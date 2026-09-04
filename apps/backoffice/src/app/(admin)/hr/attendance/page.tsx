"use client";

import { useFetch } from "@/lib/use-fetch";
import { useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, MapPin, MapPinOff, Timer, Loader2, ImageOff, PencilLine,
  Smartphone, Hand, WifiOff, ChevronDown, ChevronRight, X, Filter,
} from "lucide-react";
import { usePrompt, useConfirm, toast } from "@celsius/ui";
import { HrPageHeader } from "@/components/hr/page-header";
import type { AttendanceLog } from "@/lib/hr/types";

// ─────────────────────────────────────────────────────────────────────────────
// One review queue for attendance AND overtime.
//
// Owner 2026-09-03: "currently when review, the ux is so bad and cannot filter
// etc. also there is a lot of overlapping." The old page showed the 50 newest
// flagged rows with an outlet + single-day filter and one-at-a-time buttons;
// the OT page ran its own queue off the same logs. Here the manager picks a
// period / outlet / person / flag, sees every log that still needs a decision,
// ticks a batch and approves it — and approving the day IS the OT approval
// (the API files the hr_overtime_requests row). The Overtime page is now just
// the ledger of what was approved plus staff pre-approval requests.
// ─────────────────────────────────────────────────────────────────────────────

type EnrichedLog = AttendanceLog & {
  user_name: string | null;
  user_nickname: string | null;
  outlet_name: string | null;
  /** Clocked OT (30-min brackets) that approving this log sends to payroll. Null = not applicable (PT / auto-close / already requested). */
  ot_tail_hours: number | null;
  /** The tail is longer than any real shift — a missed tap-out. Fix the times before approving. */
  ot_tail_suspicious: boolean;
  ot_approval_id?: string | null;
  excused?: boolean | null;
  excused_reason?: string | null;
  late_minutes: number;
  clock_in_distance_m: number | null;
  clock_out_distance_m: number | null;
  geofence_radius_m: number | null;
};

type Summary = { pending: number; pendingOtHours: number; suspicious: number };
type QueueResponse = { logs: EnrichedLog[]; count: number; summary: Summary };

type ReviewState = "pending" | "reviewed" | "all";
type Period = "7d" | "30d" | "this_month" | "last_month" | "custom";

const MYT_OFFSET_MS = 8 * 3600 * 1000;
const mytToday = () => new Date(Date.now() + MYT_OFFSET_MS);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

// Period presets resolve to MYT calendar days (the API filters on MYT days).
function periodRange(p: Period, custom: { from: string; to: string }): { from: string; to: string } {
  const t = mytToday();
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  switch (p) {
    case "7d": return { from: ymd(addDays(t, -6)), to: ymd(t) };
    case "30d": return { from: ymd(addDays(t, -29)), to: ymd(t) };
    case "this_month": return { from: ymd(new Date(Date.UTC(y, m, 1))), to: ymd(t) };
    case "last_month": return { from: ymd(new Date(Date.UTC(y, m - 1, 1))), to: ymd(new Date(Date.UTC(y, m, 0))) };
    case "custom": return custom;
  }
}

const timeMyt = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" });
const dateMyt = (iso: string) => new Date(new Date(iso).getTime() + MYT_OFFSET_MS).toISOString().slice(0, 10);
const dayLabel = (isoDay: string) =>
  new Date(`${isoDay}T00:00:00Z`).toLocaleDateString("en-MY", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

// scheduled_start / scheduled_end are stored as "HH:MM:SS" wall-clock strings
// (not ISO timestamps), so they must be formatted from the string directly —
// new Date("12:00:00") is Invalid Date.
const fmtSched = (t: string | null): string => {
  if (!t) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : t;
};

// Minutes → "1h 05m" / "45m" for readable lateness.
const fmtMins = (m: number) => {
  const a = Math.abs(m);
  return a >= 60 ? `${Math.floor(a / 60)}h ${String(a % 60).padStart(2, "0")}m` : `${a}m`;
};

const CLOCK_METHOD: Record<string, { label: string; icon: typeof Smartphone; color: string }> = {
  app: { label: "GPS", icon: Smartphone, color: "text-gray-500" },
  app_nogps: { label: "No GPS", icon: WifiOff, color: "text-amber-600" },
  app_offsite: { label: "Off-site", icon: MapPinOff, color: "text-red-600" },
  manual: { label: "Manual", icon: Hand, color: "text-blue-600" },
  pos: { label: "POS", icon: Smartphone, color: "text-gray-500" },
  system: { label: "Auto", icon: Timer, color: "text-gray-500" },
};

// Every AI flag the processor writes, in the order a manager cares about.
const FLAGS: { key: string; label: string; color: string }[] = [
  { key: "late_arrival", label: "Late", color: "text-amber-700 bg-amber-50" },
  { key: "late_clock_in", label: "Late clock-in", color: "text-amber-700 bg-amber-50" },
  { key: "overtime_detected", label: "OT", color: "text-blue-700 bg-blue-50" },
  { key: "early_clock_out", label: "Left early", color: "text-orange-700 bg-orange-50" },
  { key: "no_clock_out", label: "No clock-out", color: "text-red-700 bg-red-50" },
  { key: "auto_closed_forgot_clockout", label: "Auto-closed", color: "text-gray-700 bg-gray-100" },
  { key: "outside_geofence", label: "Outside zone", color: "text-red-700 bg-red-50" },
  { key: "no_gps_data", label: "No GPS", color: "text-gray-600 bg-gray-100" },
  { key: "public_holiday", label: "Public holiday", color: "text-purple-700 bg-purple-50" },
];
const FLAG_BY_KEY = new Map(FLAGS.map((f) => [f.key, f]));

// A single clock punch's location chip: distance vs the geofence radius, with a
// maps link. Green if inside the allowed radius, red if outside, grey if no GPS.
function GeoChip({ label, lat, lng, distance, radius }: {
  label: string; lat: number | null; lng: number | null; distance: number | null; radius: number | null;
}) {
  if (lat == null || lng == null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-[11px] text-gray-500">
        <MapPinOff className="h-3 w-3" /> {label}: no GPS
      </span>
    );
  }
  const outside = distance != null && radius != null && distance > radius;
  const cls = outside ? "text-red-600 bg-red-50" : distance != null ? "text-green-700 bg-green-50" : "text-gray-600 bg-gray-50";
  return (
    <a
      href={`https://maps.google.com/?q=${lat},${lng}`}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium hover:underline ${cls}`}
      title="Open in Google Maps"
    >
      <MapPin className="h-3 w-3" />
      {label}: {distance != null ? `${distance}m` : "located"}
      {outside && radius != null ? ` · outside ${radius}m zone` : distance != null && radius != null ? " · in zone" : ""}
    </a>
  );
}

function StatusPill({ log }: { log: EnrichedLog }) {
  if (log.final_status == null) {
    return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Needs review</span>;
  }
  if (log.final_status === "rejected") {
    return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">Rejected</span>;
  }
  if (log.final_status === "adjusted") {
    return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">Times fixed</span>;
  }
  return (
    <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">
      {log.excused ? "Excused" : "Approved"}
    </span>
  );
}

const inputCls = "rounded-lg border bg-card px-2.5 py-1.5 text-sm text-foreground";

export default function AttendanceReviewPage() {
  // ── Filters ──────────────────────────────────────────────────────────────
  const [review, setReview] = useState<ReviewState>("pending");
  const [period, setPeriod] = useState<Period>("30d");
  const [custom, setCustom] = useState({ from: ymd(addDays(mytToday(), -6)), to: ymd(mytToday()) });
  const [outletId, setOutletId] = useState("");
  const [userId, setUserId] = useState("");
  const [flag, setFlag] = useState("");
  const [otOnly, setOtOnly] = useState(false);

  const { data: scheduleList } = useFetch<{ outlets: { id: string; name: string }[] }>("/api/hr/schedules");
  const outlets = scheduleList?.outlets ?? [];
  const { data: empData } = useFetch<{ employees: { id: string; name: string; fullName: string | null }[] }>("/api/hr/employees");
  const employees = useMemo(
    () => [...(empData?.employees ?? [])].sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [empData],
  );

  const range = periodRange(period, custom);
  const qs = new URLSearchParams({ review, from: range.from, to: range.to, limit: "500" });
  if (outletId) qs.set("outlet_id", outletId);
  if (userId) qs.set("user_id", userId);
  if (flag) qs.set("flag", flag);
  if (otOnly) qs.set("has_ot", "1");
  const { data, mutate, isLoading } = useFetch<QueueResponse>(`/api/hr/attendance?${qs.toString()}`);
  const logs = useMemo(() => data?.logs ?? [], [data]);
  const summary = data?.summary;

  const hasFilter = outletId || userId || flag || otOnly || period !== "30d" || review !== "pending";
  const clearFilters = () => {
    setReview("pending"); setPeriod("30d"); setOutletId(""); setUserId(""); setFlag(""); setOtOnly(false);
  };

  // ── Selection + actions ──────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; ci: string; co: string } | null>(null);
  const { prompt, PromptDialog } = usePrompt();
  const { confirm, ConfirmDialog } = useConfirm();

  const selectable = useMemo(() => logs.filter((l) => l.final_status == null), [logs]);
  const selectedLogs = useMemo(() => logs.filter((l) => selected.has(l.id)), [logs, selected]);
  const selectedOt = selectedLogs.reduce((s, l) => s + (l.ot_tail_hours ?? 0), 0);
  const selectedSuspicious = selectedLogs.filter((l) => l.ot_tail_suspicious).length;

  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () =>
    setSelected((prev) => (prev.size === selectable.length ? new Set() : new Set(selectable.map((l) => l.id))));
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const setBusy = (ids: string[], on: boolean) =>
    setBusyIds((prev) => { const n = new Set(prev); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; });

  // Every review action must SAY whether it worked. A failed request (flaky
  // connection, permission refusal) used to look identical to success, so
  // managers pressed Reject repeatedly convinced the button was broken
  // (Putrajaya, 2026-08-17).
  const patch = async (body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    try {
      const res = await fetch("/api/hr/attendance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        toast.error((j?.error as string) ?? `Failed (${res.status}) — nothing was changed. Try again.`);
        return null;
      }
      return j ?? {};
    } catch {
      toast.error("Network error — nothing was changed. Check your connection and try again.");
      return null;
    }
  };

  const reviewOne = async (log: EnrichedLog, action: "acknowledge" | "excuse" | "reject", excuseReason?: string) => {
    setBusy([log.id], true);
    const j = await patch({ id: log.id, action, excuseReason });
    setBusy([log.id], false);
    if (!j) return;
    const ot = Number(j.otApprovedHours || 0);
    const msg = action === "reject" ? "Rejected — this day will not be paid" : action === "excuse" ? "Excused" : "Approved";
    toast.success(ot > 0 ? `${msg} · ${ot}h OT sent to payroll` : msg);
    setSelected((prev) => { const n = new Set(prev); n.delete(log.id); return n; });
    mutate();
  };

  const reviewMany = async (action: "acknowledge" | "excuse" | "reject", excuseReason?: string) => {
    const ids = selectedLogs.map((l) => l.id);
    if (ids.length === 0) return;
    setBusy(ids, true);
    const j = await patch({ ids, action, excuseReason });
    setBusy(ids, false);
    if (!j) return;
    const done = Number(j.done || 0);
    const failed = Number(j.failed || 0);
    const ot = Number(j.otApprovedHours || 0);
    const verb = action === "reject" ? "Rejected" : action === "excuse" ? "Excused" : "Approved";
    if (failed > 0) {
      const errs = (j.results as { ok: boolean; error?: string }[] | undefined)?.filter((r) => !r.ok).map((r) => r.error) ?? [];
      toast.error(`${verb} ${done}, ${failed} failed: ${Array.from(new Set(errs)).join("; ")}`);
    } else {
      toast.success(ot > 0 ? `${verb} ${done} log${done === 1 ? "" : "s"} · ${ot}h OT sent to payroll` : `${verb} ${done} log${done === 1 ? "" : "s"}`);
    }
    setSelected(new Set());
    mutate();
  };

  const askExcuse = () =>
    prompt({ title: "Reason for excusing", placeholder: "e.g. medical, traffic accident, pre-agreed", multiline: true, required: true });

  const bulkApprove = async () => {
    const ok = await confirm({
      title: `Approve ${selectedLogs.length} log${selectedLogs.length === 1 ? "" : "s"}?`,
      description: selectedOt > 0
        ? `${selectedOt}h of overtime beyond the roster goes to payroll with this approval. Lateness penalties still apply as calculated.`
        : "Lateness penalties still apply as calculated.",
      confirmLabel: selectedOt > 0 ? `Approve + ${selectedOt}h OT` : "Approve",
    });
    if (ok) await reviewMany("acknowledge");
  };
  const bulkExcuse = async () => {
    const reason = await askExcuse();
    if (reason === null) return;
    await reviewMany("excuse", reason || undefined);
  };
  const bulkReject = async () => {
    const ok = await confirm({
      title: `Reject ${selectedLogs.length} log${selectedLogs.length === 1 ? "" : "s"}?`,
      description: "Rejected days are not paid. Use this for bogus or duplicate clock-ins only.",
      confirmLabel: "Reject",
      destructive: true,
    });
    if (ok) await reviewMany("reject");
  };

  // datetime-local <-> UTC ISO, treating the input as Malaysia wall time (UTC+8).
  const toMytInput = (iso: string | null): string =>
    !iso ? "" : new Date(new Date(iso).getTime() + MYT_OFFSET_MS).toISOString().slice(0, 16);
  const fromMytInput = (v: string): string | null => {
    if (!v) return null;
    const ms = Date.parse(`${v}:00+08:00`);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  };
  const openEditor = (log: EnrichedLog) => {
    setEditing({ id: log.id, ci: toMytInput(log.clock_in), co: toMytInput(log.clock_out) });
    setExpanded((prev) => new Set(prev).add(log.id));
  };
  const saveTimes = async () => {
    if (!editing) return;
    const clockOut = fromMytInput(editing.co);
    if (!clockOut) { toast.error("A clock-out time is required — set it before saving."); return; }
    setBusy([editing.id], true);
    const j = await patch({ id: editing.id, action: "set_times", clockIn: fromMytInput(editing.ci), clockOut });
    setBusy([editing.id], false);
    if (!j) return;
    const ot = Number(j.otApprovedHours || 0);
    toast.success(ot > 0 ? `Times updated · ${ot}h OT sent to payroll` : "Times updated");
    setEditing(null);
    mutate();
  };

  // ── Grouping by MYT day (newest first, as the API returns them) ──────────
  const groups = useMemo(() => {
    const m = new Map<string, EnrichedLog[]>();
    for (const l of logs) {
      const d = dateMyt(l.clock_in);
      const arr = m.get(d) ?? [];
      arr.push(l);
      m.set(d, arr);
    }
    return Array.from(m.entries());
  }, [logs]);

  const description = summary
    ? review === "pending"
      ? `${summary.pending} log${summary.pending === 1 ? "" : "s"} waiting for a decision` +
        (summary.pendingOtHours > 0 ? ` · ${summary.pendingOtHours}h OT to approve` : "") +
        (summary.suspicious > 0 ? ` · ${summary.suspicious} missed clock-out${summary.suspicious === 1 ? "" : "s"} to fix` : "")
      : `${logs.length} log${logs.length === 1 ? "" : "s"}` + (summary.pending > 0 ? ` · ${summary.pending} still need review in this period` : "")
    : "Loading…";

  return (
    <div className="space-y-4 p-4 sm:p-6 lg:p-8">
      <PromptDialog />
      <ConfirmDialog />
      <HrPageHeader
        title="Attendance Review"
        description={description}
        action={
          <div className="flex gap-1 rounded-lg border bg-card p-1 text-sm">
            {([["pending", "Needs review"], ["reviewed", "Reviewed"], ["all", "All"]] as [ReviewState, string][]).map(([k, l]) => (
              <button
                key={k}
                onClick={() => { setReview(k); setSelected(new Set()); }}
                className={`rounded-md px-3 py-1.5 font-medium ${review === k ? "bg-terracotta text-white" : "text-gray-600 hover:bg-muted"}`}
              >
                {l}
              </button>
            ))}
          </div>
        }
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className={inputCls} title="Period">
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="this_month">This month</option>
          <option value="last_month">Last month</option>
          <option value="custom">Custom range</option>
        </select>
        {period === "custom" && (
          <>
            <input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className={inputCls} />
            <span className="text-xs text-muted-foreground">to</span>
            <input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className={inputCls} />
          </>
        )}
        <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className={inputCls} title="Outlet">
          <option value="">All outlets</option>
          {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select value={userId} onChange={(e) => setUserId(e.target.value)} className={inputCls} title="Staff">
          <option value="">All staff</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}{e.fullName && e.fullName !== e.name ? ` — ${e.fullName}` : ""}</option>)}
        </select>
        <select value={flag} onChange={(e) => setFlag(e.target.value)} className={inputCls} title="Flag">
          <option value="">Any flag</option>
          {FLAGS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-sm">
          <input type="checkbox" checked={otOnly} onChange={(e) => setOtOnly(e.target.checked)} className="accent-terracotta" />
          With OT
        </label>
        {hasFilter && (
          <button onClick={clearFilters} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-gray-600 hover:bg-muted">
            <X className="h-3.5 w-3.5" /> Reset
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {range.from} → {range.to}{logs.length >= 500 ? " · showing the newest 500, narrow the period to see the rest" : ""}
        </span>
      </div>

      {/* Bulk action bar */}
      {review === "pending" && selectable.length > 0 && (
        <div className={`sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border p-2.5 shadow-sm ${selected.size > 0 ? "border-terracotta/40 bg-orange-50" : "bg-card"}`}>
          <label className="inline-flex cursor-pointer items-center gap-2 px-1 text-sm">
            <input
              type="checkbox"
              checked={selected.size > 0 && selected.size === selectable.length}
              ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < selectable.length; }}
              onChange={toggleAll}
              className="h-4 w-4 accent-terracotta"
            />
            {selected.size > 0
              ? <span className="font-medium">{selected.size} selected{selectedOt > 0 ? ` · ${selectedOt}h OT` : ""}</span>
              : <span className="text-muted-foreground">Select all {selectable.length} on this page</span>}
          </label>
          {selectedSuspicious > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-red-700">
              <AlertTriangle className="h-3.5 w-3.5" /> {selectedSuspicious} with a missed clock-out — approving pays no OT for those until the times are fixed
            </span>
          )}
          {selected.size > 0 && (
            <div className="ml-auto flex flex-wrap gap-2">
              <button onClick={bulkApprove} className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> {selectedOt > 0 ? `Approve + ${selectedOt}h OT` : "Approve"}
              </button>
              <button onClick={bulkExcuse} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">Excuse</button>
              <button onClick={bulkReject} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">Reject</button>
              <button onClick={() => setSelected(new Set())} className="rounded-lg border px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-muted">Clear</button>
            </div>
          )}
        </div>
      )}

      {/* Queue */}
      {isLoading && !data ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-16 text-center">
          <CheckCircle2 className="mb-3 h-12 w-12 text-green-500" />
          <p className="text-lg font-semibold">{review === "pending" ? "All reviewed" : "Nothing here"}</p>
          <p className="text-sm text-muted-foreground">
            {review === "pending" ? "No attendance logs are waiting for a decision" : "No attendance logs"} in this period{hasFilter ? " with these filters" : ""}.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(([day, dayLogs]) => {
            const dayPending = dayLogs.filter((l) => l.final_status == null);
            const dayOt = dayPending.reduce((s, l) => s + (l.ot_tail_hours ?? 0), 0);
            return (
              <section key={day}>
                <div className="mb-1.5 flex items-baseline gap-2 px-1">
                  <h2 className="text-sm font-semibold">{dayLabel(day)}</h2>
                  <span className="text-xs text-muted-foreground">
                    {dayLogs.length} log{dayLogs.length === 1 ? "" : "s"}
                    {dayPending.length > 0 && review !== "pending" ? ` · ${dayPending.length} to review` : ""}
                    {dayOt > 0 ? ` · ${dayOt}h OT` : ""}
                  </span>
                </div>
                <div className="divide-y rounded-xl border bg-card">
                  {dayLogs.map((log) => {
                    const busy = busyIds.has(log.id);
                    const pending = log.final_status == null;
                    const open = expanded.has(log.id);
                    const ot = log.ot_tail_hours ?? 0;
                    return (
                      <div key={log.id} className={`px-3 py-2.5 ${selected.has(log.id) ? "bg-orange-50/60" : ""}`}>
                        <div className="flex items-start gap-3">
                          {pending ? (
                            <input
                              type="checkbox"
                              checked={selected.has(log.id)}
                              onChange={() => toggle(log.id)}
                              disabled={busy}
                              className="mt-1.5 h-4 w-4 flex-shrink-0 accent-terracotta"
                              aria-label="Select log"
                            />
                          ) : <span className="mt-1.5 h-4 w-4 flex-shrink-0" />}

                          {/* Clock-in selfie */}
                          {log.clock_in_photo_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={log.clock_in_photo_url}
                              alt="Clock-in"
                              className="h-10 w-10 flex-shrink-0 cursor-zoom-in rounded-lg object-cover"
                              onClick={() => setPreviewUrl(log.clock_in_photo_url)}
                            />
                          ) : (
                            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                              <ImageOff className="h-4 w-4" />
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="font-semibold">{log.user_nickname || log.user_name || log.user_id.slice(0, 8)}</span>
                              {log.outlet_name && <span className="text-xs text-muted-foreground">{log.outlet_name}</span>}
                              <StatusPill log={log} />
                              {log.ai_flags.map((f) => {
                                const info = FLAG_BY_KEY.get(f);
                                return (
                                  <span key={f} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${info?.color ?? "text-gray-600 bg-gray-50"}`}>
                                    {info?.label ?? f}
                                  </span>
                                );
                              })}
                            </div>
                            <p className="mt-0.5 text-sm text-muted-foreground">
                              {log.scheduled_start && (
                                <span>Rostered {fmtSched(log.scheduled_start)}{log.scheduled_end ? `–${fmtSched(log.scheduled_end)}` : ""} · </span>
                              )}
                              <span className="text-foreground">{timeMyt(log.clock_in)}{log.clock_out ? ` → ${timeMyt(log.clock_out)}` : " → (open)"}</span>
                              {log.clock_out && dateMyt(log.clock_out) !== dateMyt(log.clock_in) && <span className="text-red-600"> next day</span>}
                              {log.total_hours != null && <span> · {log.total_hours}h</span>}
                              {log.scheduled_start && (
                                log.late_minutes > 2
                                  ? <span className="font-medium text-amber-600"> · {fmtMins(log.late_minutes)} late</span>
                                  : log.late_minutes < -2
                                    ? <span className="text-green-700"> · {fmtMins(log.late_minutes)} early</span>
                                    : <span className="text-green-700"> · on time</span>
                              )}
                            </p>
                            {/* OT line — the thing approval decides */}
                            {log.ot_tail_suspicious ? (
                              <p className="mt-0.5 inline-flex items-center gap-1 text-sm font-medium text-red-700">
                                <AlertTriangle className="h-3.5 w-3.5" /> Clock-out looks wrong (a whole day past the roster) — fix the times before approving, or no OT is paid
                              </p>
                            ) : ot >= 0.5 && pending ? (
                              <p className="mt-0.5 text-sm font-medium text-blue-700">+{ot}h OT beyond roster — approving pays it</p>
                            ) : (log.overtime_hours ?? 0) > 0 && log.ot_approval_id ? (
                              <p className="mt-0.5 text-xs text-green-700">{log.overtime_hours}h OT approved · in payroll</p>
                            ) : null}
                            {log.excused && log.excused_reason && (
                              <p className="mt-0.5 text-xs text-muted-foreground">Excused: {log.excused_reason}</p>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1.5">
                            {pending && (
                              <>
                                <button
                                  onClick={() => reviewOne(log, "acknowledge")}
                                  disabled={busy}
                                  title={ot >= 0.5 ? `Approve the day AND its ${ot}h OT for payroll. Lateness penalty still applies as calculated.` : "Approve the day — lateness penalty applies as calculated"}
                                  className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                                >
                                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                                  {ot >= 0.5 && !log.ot_tail_suspicious ? `Approve + ${ot}h OT` : "Approve"}
                                </button>
                                <button
                                  onClick={async () => { const r = await askExcuse(); if (r !== null) reviewOne(log, "excuse", r || undefined); }}
                                  disabled={busy}
                                  title="Waive the lateness penalty — legitimate reason"
                                  className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                >
                                  Excuse
                                </button>
                                <button
                                  onClick={() => reviewOne(log, "reject")}
                                  disabled={busy}
                                  title="Discard this log (bogus entry) — the day is not paid"
                                  className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => (editing?.id === log.id ? setEditing(null) : openEditor(log))}
                              disabled={busy}
                              title={log.clock_out ? "Correct the clock in / out times" : "Manually clock this staffer out"}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50 ${log.ot_tail_suspicious || !log.clock_out ? "border-red-300 text-red-700" : "border-gray-300 text-gray-700"}`}
                            >
                              <PencilLine className="h-3 w-3" /> {log.clock_out ? "Fix times" : "Clock out"}
                            </button>
                            <button
                              onClick={() => toggleExpanded(log.id)}
                              className="rounded-lg p-1.5 text-gray-500 hover:bg-muted"
                              title={open ? "Hide details" : "Show location, method and photos"}
                              aria-label="Toggle details"
                            >
                              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>

                        {open && (
                          <div className="ml-7 mt-2 space-y-2 pl-10">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <GeoChip label="In" lat={log.clock_in_lat} lng={log.clock_in_lng} distance={log.clock_in_distance_m} radius={log.geofence_radius_m} />
                              {log.clock_out && (
                                <GeoChip label="Out" lat={log.clock_out_lat} lng={log.clock_out_lng} distance={log.clock_out_distance_m} radius={log.geofence_radius_m} />
                              )}
                              {[log.clock_in_method, log.clock_out_method].filter((m, i, a) => m && a.indexOf(m) === i).map((m) => {
                                const info = CLOCK_METHOD[m as string];
                                if (!info) return null;
                                const Icon = info.icon;
                                return (
                                  <span key={m} className={`inline-flex items-center gap-1 text-[11px] ${info.color}`}>
                                    <Icon className="h-3 w-3" /> {info.label}
                                  </span>
                                );
                              })}
                              {log.clock_out_photo_url && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={log.clock_out_photo_url}
                                  alt="Clock-out"
                                  className="h-10 w-10 cursor-zoom-in rounded-lg object-cover"
                                  onClick={() => setPreviewUrl(log.clock_out_photo_url)}
                                  title="Clock-out selfie"
                                />
                              )}
                              {log.review_notes && <span className="text-[11px] text-muted-foreground">Note: {log.review_notes}</span>}
                            </div>

                            {/* Fix-times editor: manual clock-out for an open log, or a time
                                correction. Hours recompute server-side via the shared engine. */}
                            {editing?.id === log.id && (
                              <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
                                <div className="flex flex-col gap-2 sm:flex-row">
                                  <label className="flex-1 text-xs font-medium text-muted-foreground">
                                    Clock in (MYT)
                                    <input type="datetime-local" value={editing.ci} onChange={(e) => setEditing({ ...editing, ci: e.target.value })} className="mt-1 w-full rounded-md border bg-card px-2 py-1 text-sm text-foreground" />
                                  </label>
                                  <label className="flex-1 text-xs font-medium text-muted-foreground">
                                    Clock out (MYT)
                                    <input type="datetime-local" value={editing.co} onChange={(e) => setEditing({ ...editing, co: e.target.value })} className="mt-1 w-full rounded-md border bg-card px-2 py-1 text-sm text-foreground" />
                                  </label>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={saveTimes}
                                    disabled={busy || !editing.co}
                                    className="inline-flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-xs font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
                                  >
                                    {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                                    Save times
                                  </button>
                                  <button onClick={() => setEditing(null)} disabled={busy} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-muted disabled:opacity-50">
                                    Cancel
                                  </button>
                                  <span className="text-[11px] text-muted-foreground">Hours recompute automatically. Any OT in the new times is approved. Times are Malaysia time.</span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setPreviewUrl(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Attendance photo" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}
