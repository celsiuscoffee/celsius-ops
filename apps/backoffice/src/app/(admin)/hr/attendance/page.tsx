"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, MapPinOff, Clock, Timer, Loader2, ImageOff, CalendarDays, UserX, CalendarOff, HelpCircle } from "lucide-react";
import { usePrompt } from "@celsius/ui";
import { HrPageHeader } from "@/components/hr/page-header";
import type { AttendanceLog } from "@/lib/hr/types";

type EnrichedLog = AttendanceLog & {
  user_name: string | null;
  user_nickname: string | null;
  outlet_name: string | null;
};

const FLAG_LABELS: Record<string, { label: string; icon: typeof AlertTriangle; color: string }> = {
  outside_geofence: { label: "Outside zone", icon: MapPinOff, color: "text-red-600 bg-red-50" },
  late_arrival: { label: "Late", icon: Clock, color: "text-amber-600 bg-amber-50" },
  no_clock_out: { label: "No clock-out", icon: Timer, color: "text-red-600 bg-red-50" },
  overtime_detected: { label: "OT detected", icon: Clock, color: "text-blue-600 bg-blue-50" },
  no_gps_data: { label: "No GPS", icon: MapPinOff, color: "text-gray-600 bg-gray-50" },
};

type RosterStatus = "present" | "late" | "absent" | "on_leave" | "unscheduled";

type RosterRow = {
  user_id: string;
  user_name: string | null;
  user_nickname: string | null;
  status: RosterStatus;
  scheduled_start: string | null;
  scheduled_end: string | null;
  role_type: string | null;
  clock_in: string | null;
  clock_out: string | null;
  total_hours: number | null;
  leave_type: string | null;
  log_id: string | null;
  no_clock_out: boolean;
};

type RosterResponse = {
  date: string;
  outlet_id: string | null;
  outlets: { id: string; name: string }[];
  rows: RosterRow[];
  summary?: {
    scheduled: number;
    present: number;
    late: number;
    absent: number;
    on_leave: number;
    unscheduled: number;
    has_schedule: boolean;
  };
};

const ROSTER_STATUS: Record<RosterStatus, { label: string; icon: typeof AlertTriangle; color: string }> = {
  present: { label: "Present", icon: CheckCircle2, color: "text-green-700 bg-green-50" },
  late: { label: "Late", icon: Clock, color: "text-amber-700 bg-amber-50" },
  absent: { label: "Absent", icon: UserX, color: "text-red-700 bg-red-50" },
  on_leave: { label: "On leave", icon: CalendarOff, color: "text-blue-700 bg-blue-50" },
  unscheduled: { label: "Unscheduled", icon: HelpCircle, color: "text-gray-700 bg-gray-100" },
};

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" }) : null;

// Today in Malaysia time as YYYY-MM-DD (en-CA gives ISO date format).
const todayMY = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });

export default function AttendanceReviewPage() {
  const [filter, setFilter] = useState<"flagged" | "all" | "schedule">("flagged");
  const [rosterDate, setRosterDate] = useState(todayMY);
  const [rosterOutlet, setRosterOutlet] = useState("");
  const { data, mutate } = useFetch<{ logs: EnrichedLog[]; count: number }>(
    filter === "schedule" ? null : `/api/hr/attendance?status=${filter}`,
  );
  const { data: roster } = useFetch<RosterResponse>(
    filter === "schedule"
      ? `/api/hr/attendance/roster?date=${rosterDate}${rosterOutlet ? `&outlet_id=${rosterOutlet}` : ""}`
      : null,
  );
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { prompt, PromptDialog } = usePrompt();

  const handleReview = async (id: string, action: "acknowledge" | "excuse" | "reject", excuseReason?: string) => {
    setReviewingId(id);
    try {
      await fetch("/api/hr/attendance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, excuseReason }),
      });
      mutate();
    } finally {
      setReviewingId(null);
    }
  };

  const handleExcuse = async (id: string) => {
    const reason = await prompt({
      title: "Reason for excusing",
      placeholder: "e.g. medical, traffic accident, pre-agreed",
      multiline: true,
      required: true,
    });
    if (reason === null) return;
    await handleReview(id, "excuse", reason || undefined);
  };

  const logs = data?.logs || [];

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <PromptDialog />
      <HrPageHeader
        title="Attendance Review"
        description={
          filter === "schedule"
            ? "Scheduled staff vs actual clock-ins for the day"
            : filter === "flagged"
              ? `${logs.length} flagged item${logs.length !== 1 ? "s" : ""} need review`
              : `${logs.length} attendance log${logs.length !== 1 ? "s" : ""}`
        }
        action={
          <div className="flex gap-1 rounded-lg border bg-card p-1 text-sm">
            <button
              onClick={() => setFilter("flagged")}
              className={`rounded-md px-3 py-1.5 font-medium ${filter === "flagged" ? "bg-terracotta text-white" : "text-gray-600 hover:bg-muted"}`}
            >
              Flagged
            </button>
            <button
              onClick={() => setFilter("all")}
              className={`rounded-md px-3 py-1.5 font-medium ${filter === "all" ? "bg-terracotta text-white" : "text-gray-600 hover:bg-muted"}`}
            >
              All
            </button>
            <button
              onClick={() => setFilter("schedule")}
              className={`rounded-md px-3 py-1.5 font-medium ${filter === "schedule" ? "bg-terracotta text-white" : "text-gray-600 hover:bg-muted"}`}
            >
              By Schedule
            </button>
          </div>
        }
      />

      {filter === "schedule" ? (
        <ScheduleRoster
          roster={roster}
          date={rosterDate}
          onDateChange={setRosterDate}
          outletId={rosterOutlet}
          onOutletChange={setRosterOutlet}
        />
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-16 text-center">
          <CheckCircle2 className="mb-3 h-12 w-12 text-green-500" />
          <p className="text-lg font-semibold">All clear</p>
          <p className="text-sm text-muted-foreground">No flagged attendance items</p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => (
            <div key={log.id} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  {/* Clock-in photo */}
                  {log.clock_in_photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={log.clock_in_photo_url}
                      alt="Clock-in"
                      className="h-14 w-14 flex-shrink-0 cursor-zoom-in rounded-lg object-cover"
                      onClick={() => setPreviewUrl(log.clock_in_photo_url)}
                    />
                  ) : (
                    <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <ImageOff className="h-5 w-5" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold truncate">
                      {log.user_name || log.user_id.slice(0, 8) + "..."}
                    </p>
                    {log.user_nickname && log.user_name && log.user_nickname !== log.user_name && (
                      <p className="text-xs text-muted-foreground">({log.user_nickname})</p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {log.outlet_name && <span>{log.outlet_name} &middot; </span>}
                      {new Date(log.clock_in).toLocaleDateString("en-MY")} &middot;{" "}
                      {new Date(log.clock_in).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })}
                      {log.clock_out && (
                        <> &rarr; {new Date(log.clock_out).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })}</>
                      )}
                    </p>
                    {log.total_hours != null && (
                      <p className="text-sm text-muted-foreground">{log.total_hours}h total</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-shrink-0 flex-wrap justify-end gap-2">
                  {log.ai_flags.map((flag) => {
                    const info = FLAG_LABELS[flag] || { label: flag, color: "text-gray-600 bg-gray-50" };
                    return (
                      <span key={flag} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${info.color}`}>
                        {info.label}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => handleReview(log.id, "acknowledge")}
                  disabled={reviewingId === log.id}
                  title="Penalty applies as calculated"
                  className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {reviewingId === log.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  Acknowledge
                </button>
                <button
                  onClick={() => handleExcuse(log.id)}
                  disabled={reviewingId === log.id}
                  title="Waive penalty — legitimate reason"
                  className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Excuse
                </button>
                <button
                  onClick={() => handleReview(log.id, "reject")}
                  disabled={reviewingId === log.id}
                  title="Discard log (bogus entry)"
                  className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewUrl(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Clock-in preview" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}

function ScheduleRoster({
  roster,
  date,
  onDateChange,
  outletId,
  onOutletChange,
}: {
  roster: RosterResponse | undefined;
  date: string;
  onDateChange: (d: string) => void;
  outletId: string;
  onOutletChange: (id: string) => void;
}) {
  const outlets = roster?.outlets || [];
  const rows = roster?.rows || [];
  const summary = roster?.summary;
  // The API resolves the active outlet when none is requested; reflect that
  // back into the picker so it shows the outlet actually being displayed.
  const activeOutlet = outletId || roster?.outlet_id || "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <input
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            className="rounded-lg border bg-card px-3 py-1.5 text-sm"
          />
        </div>
        <select
          value={activeOutlet}
          onChange={(e) => onOutletChange(e.target.value)}
          className="rounded-lg border bg-card px-3 py-1.5 text-sm"
        >
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {summary && (
          <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
            {summary.absent > 0 && (
              <span className="rounded-full bg-red-50 px-2 py-1 font-medium text-red-700">
                {summary.absent} absent
              </span>
            )}
            {summary.late > 0 && (
              <span className="rounded-full bg-amber-50 px-2 py-1 font-medium text-amber-700">
                {summary.late} late
              </span>
            )}
            <span className="rounded-full bg-green-50 px-2 py-1 font-medium text-green-700">
              {summary.present} present
            </span>
            <span className="text-muted-foreground">of {summary.scheduled} scheduled</span>
          </div>
        )}
      </div>

      {summary && !summary.has_schedule ? (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-16 text-center">
          <CalendarOff className="mb-3 h-12 w-12 text-muted-foreground" />
          <p className="text-lg font-semibold">No published schedule</p>
          <p className="text-sm text-muted-foreground">
            No shifts are scheduled for this outlet on this date.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-16 text-center">
          <CheckCircle2 className="mb-3 h-12 w-12 text-green-500" />
          <p className="text-lg font-semibold">Nothing to show</p>
          <p className="text-sm text-muted-foreground">No scheduled shifts or clock-ins for this day.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Employee</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Scheduled</th>
                <th className="px-4 py-2 font-medium">Actual</th>
                <th className="px-4 py-2 font-medium">Hours</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const info = ROSTER_STATUS[r.status];
                const Icon = info.icon;
                return (
                  <tr key={`${r.user_id}-${r.log_id ?? "noshow"}`} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium">{r.user_name || r.user_id.slice(0, 8) + "..."}</p>
                      {r.role_type && <p className="text-xs text-muted-foreground">{r.role_type}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${info.color}`}>
                        <Icon className="h-3 w-3" />
                        {r.status === "on_leave" && r.leave_type ? r.leave_type : info.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.scheduled_start ? `${r.scheduled_start} – ${r.scheduled_end ?? ""}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.clock_in ? (
                        <>
                          {fmtTime(r.clock_in)}
                          {r.clock_out ? ` – ${fmtTime(r.clock_out)}` : r.no_clock_out ? " – (no clock-out)" : ""}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.total_hours != null ? `${r.total_hours}h` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
