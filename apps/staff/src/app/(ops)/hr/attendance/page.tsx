"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { HRPageHeader } from "@/components/hr-page-header";
import { KeyNumber } from "@/components/key-number";
import { Clock, AlertTriangle, CheckCircle2, Timer, Calendar } from "lucide-react";
import { FetchError } from "@/components/fetch-error";
import { formatTime } from "@/lib/format-time";

type AttendanceLog = {
  id: string;
  clock_in: string;
  clock_out: string | null;
  total_hours: number | null;
  regular_hours: number | null;
  overtime_hours: number | null;
  overtime_type: string | null;
  ai_status: "pending" | "approved" | "flagged" | "reviewed";
  ai_flags: string[];
  final_status: "approved" | "rejected" | "adjusted" | null;
};

type Stats = { totalHours: number; totalOT: number; pendingOT: number; daysWorked: number; period: number };

const FLAG_LABELS: Record<string, { label: string; color: string }> = {
  outside_geofence: { label: "Outside zone", color: "text-danger-text" },
  late_arrival: { label: "Late", color: "text-warn-text" },
  no_clock_out: { label: "No clock-out", color: "text-danger-text" },
  overtime_detected: { label: "OT", color: "text-info-text" },
  no_gps_data: { label: "No GPS", color: "text-text-3" },
  public_holiday: { label: "PH", color: "text-info-text" },
  rest_day_work: { label: "Rest day", color: "text-info-text" },
};

export default function MyAttendancePage() {
  const [days, setDays] = useState(30);
  const { data, error, mutate } = useFetch<{ logs: AttendanceLog[]; stats: Stats; pendingOtByDate?: Record<string, number> }>(`/api/hr/attendance?days=${days}`);
  const logs = data?.logs || [];
  const stats = data?.stats || { totalHours: 0, totalOT: 0, pendingOT: 0, daysWorked: 0, period: days };

  // Group logs by Malaysian local date (clock_in is UTC timestamptz).
  // A 7:30am MYT shift is 23:30 UTC prev day — slice would give wrong date.
  const toMytDate = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const byDate = new Map<string, AttendanceLog[]>();
  logs.forEach((l) => {
    const date = toMytDate(l.clock_in);
    const list = byDate.get(date) || [];
    list.push(l);
    byDate.set(date, list);
  });

  const statusIcon = (log: AttendanceLog) => {
    if (log.ai_status === "flagged") return <AlertTriangle className="h-4 w-4 text-warn" />;
    if (log.ai_status === "approved" || log.final_status === "approved") return <CheckCircle2 className="h-4 w-4 text-ok" />;
    if (!log.clock_out) return <Timer className="h-4 w-4 text-info" />;
    return <Clock className="h-4 w-4 text-text-3" />;
  };

  return (
    <div className="px-4 pb-6">
      <HRPageHeader title="Clock-in history" subtitle="Your clock-ins and the hours they count." />

      {/* Period: one segmented control */}
      <div className="mb-4 grid grid-cols-3 gap-1 rounded-ctl bg-sunken p-1">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            aria-pressed={days === d}
            className={`min-h-10 rounded-[6px] text-[13px] font-medium ${
              days === d ? "bg-surface text-text shadow-sm" : "text-text-2"
            }`}
          >
            Last {d} days
          </button>
        ))}
      </div>

      {/* Key numbers */}
      <div className="mb-6 grid grid-cols-3 gap-2">
        <KeyNumber label="Days worked" value={String(stats.daysWorked)} />
        <KeyNumber label="Hours" value={String(stats.totalHours)} />
        <KeyNumber
          label="Overtime"
          value={`${stats.totalOT}h`}
          note={<span className="text-text-3">approved{stats.pendingOT > 0 ? <span className="text-info-text"> · +{stats.pendingOT}h with your manager</span> : null}</span>}
        />
      </div>

      {/* Daily logs */}
      {!data && error ? (
        <FetchError error={error} onRetry={() => mutate()} what="your attendance" />
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-sunken/60 py-12 text-center">
          <Calendar className="mb-2 h-10 w-10 text-line-ctl" />
          <p className="text-sm font-semibold text-text-3">No attendance records</p>
          <p className="text-xs text-text-3">Clock in from the Time Clock to start</p>
        </div>
      ) : (
        <div className="space-y-2">
          {Array.from(byDate.entries()).map(([date, dayLogs]) => {
            const d = new Date(date + "T00:00:00");
            const dayName = d.toLocaleDateString("en-MY", { weekday: "short" });
            const dateStr = d.toLocaleDateString("en-MY", { day: "numeric", month: "short" });
            const dayTotal = dayLogs.reduce((s, l) => s + (Number(l.total_hours) || 0), 0);
            const dayPendingOt = data?.pendingOtByDate?.[date] ?? 0;

            return (
              <div key={date} className="rounded-2xl border border-line bg-surface p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-10 w-10 flex-col items-center justify-center rounded-lg bg-sunken">
                      <span className="text-[10px] font-bold uppercase text-text-3">{dayName}</span>
                      <span className="text-sm font-bold">{d.getDate()}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium">{dateStr}</p>
                      <p className="text-xs text-text-3">{dayTotal.toFixed(1)}h total</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5 pl-12">
                  {dayLogs.map((log) => {
                    const clockIn = formatTime(log.clock_in);
                    const clockOut = log.clock_out
                      ? formatTime(log.clock_out)
                      : "—";
                    return (
                      <div key={log.id} className="flex items-center gap-2 text-xs">
                        {statusIcon(log)}
                        <span className="font-mono">{clockIn} → {clockOut}</span>
                        {Number(log.total_hours) > 0 && (
                          <span className="text-text-3">{log.total_hours}h</span>
                        )}
                        {/* OT accrues in half-hour brackets (min 0.5h), same
                            floor as payroll and the stats above; the old >= 1
                            hid a 0.5h tail that the API was already counting. */}
                        {Number(log.overtime_hours) >= 0.5 && (
                          <span className="font-medium text-info-text">+{log.overtime_hours}h overtime</span>
                        )}
                        <div className="ml-auto flex gap-1">
                          {log.ai_flags.filter((f) => f !== "migrated_from_briohr").map((f) => {
                            const info = FLAG_LABELS[f] || { label: f, color: "text-text-3" };
                            return (
                              <span key={f} className={`rounded-full bg-sunken px-1.5 py-0.5 text-[9px] font-medium ${info.color}`}>
                                {info.label}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {dayPendingOt > 0 && (
                    <p className="flex items-center gap-2 text-xs font-medium text-info-text" title="Paid once a manager approves it on the Overtime page">
                      +{dayPendingOt}h overtime · with your manager
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
