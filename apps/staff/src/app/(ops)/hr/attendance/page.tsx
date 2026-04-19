"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import Link from "next/link";
import { Clock, MapPinOff, AlertTriangle, CheckCircle2, Timer, Calendar, ArrowLeft } from "lucide-react";

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

type Stats = { totalHours: number; totalOT: number; daysWorked: number; period: number };

const FLAG_LABELS: Record<string, { label: string; color: string }> = {
  outside_geofence: { label: "Outside zone", color: "text-red-600" },
  late_arrival: { label: "Late", color: "text-amber-600" },
  no_clock_out: { label: "No clock-out", color: "text-red-600" },
  overtime_detected: { label: "OT", color: "text-blue-600" },
  no_gps_data: { label: "No GPS", color: "text-gray-500" },
  public_holiday: { label: "PH", color: "text-purple-600" },
  rest_day_work: { label: "Rest day", color: "text-purple-600" },
};

export default function MyAttendancePage() {
  const [days, setDays] = useState(30);
  const { data } = useFetch<{ logs: AttendanceLog[]; stats: Stats }>(`/api/hr/attendance?days=${days}`);
  const logs = data?.logs || [];
  const stats = data?.stats || { totalHours: 0, totalOT: 0, daysWorked: 0, period: days };

  // Group logs by date
  const byDate = new Map<string, AttendanceLog[]>();
  logs.forEach((l) => {
    const date = l.clock_in.slice(0, 10);
    const list = byDate.get(date) || [];
    list.push(l);
    byDate.set(date, list);
  });

  const statusIcon = (log: AttendanceLog) => {
    if (log.ai_status === "flagged") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    if (log.ai_status === "approved" || log.final_status === "approved") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (!log.clock_out) return <Timer className="h-4 w-4 text-blue-500" />;
    return <Clock className="h-4 w-4 text-gray-400" />;
  };

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
        <h1 className="text-2xl font-bold">My Attendance</h1>
      </div>

      {/* Period selector */}
      <div className="mb-4 flex gap-2">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              days === d ? "bg-terracotta text-white" : "bg-gray-100 text-gray-600"
            }`}
          >
            Last {d}d
          </button>
        ))}
      </div>

      {/* Stats cards */}
      <div className="mb-6 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-gray-100 bg-white p-3 text-center">
          <p className="text-2xl font-bold text-terracotta">{stats.daysWorked}</p>
          <p className="text-[10px] text-gray-500">Days worked</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-3 text-center">
          <p className="text-2xl font-bold">{stats.totalHours}</p>
          <p className="text-[10px] text-gray-500">Total hours</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-3 text-center">
          <p className="text-2xl font-bold text-blue-600">{stats.totalOT}</p>
          <p className="text-[10px] text-gray-500">OT hours</p>
        </div>
      </div>

      {/* Daily logs */}
      {logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 py-12 text-center">
          <Calendar className="mb-2 h-10 w-10 text-gray-300" />
          <p className="text-sm font-semibold text-gray-500">No attendance records</p>
          <p className="text-xs text-gray-400">Clock in from the Time Clock to start</p>
        </div>
      ) : (
        <div className="space-y-2">
          {Array.from(byDate.entries()).map(([date, dayLogs]) => {
            const d = new Date(date + "T00:00:00");
            const dayName = d.toLocaleDateString("en-MY", { weekday: "short" });
            const dateStr = d.toLocaleDateString("en-MY", { day: "numeric", month: "short" });
            const dayTotal = dayLogs.reduce((s, l) => s + (Number(l.total_hours) || 0), 0);

            return (
              <div key={date} className="rounded-2xl border border-gray-100 bg-white p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-10 w-10 flex-col items-center justify-center rounded-lg bg-gray-100">
                      <span className="text-[10px] font-bold uppercase text-gray-500">{dayName}</span>
                      <span className="text-sm font-bold">{d.getDate()}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium">{dateStr}</p>
                      <p className="text-xs text-gray-400">{dayTotal.toFixed(1)}h total</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5 pl-12">
                  {dayLogs.map((log) => {
                    const clockIn = new Date(log.clock_in).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" });
                    const clockOut = log.clock_out
                      ? new Date(log.clock_out).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })
                      : "—";
                    return (
                      <div key={log.id} className="flex items-center gap-2 text-xs">
                        {statusIcon(log)}
                        <span className="font-mono">{clockIn} → {clockOut}</span>
                        {Number(log.total_hours) > 0 && (
                          <span className="text-gray-500">{log.total_hours}h</span>
                        )}
                        {Number(log.overtime_hours) > 0 && (
                          <span className="font-medium text-blue-600">+{log.overtime_hours}h OT</span>
                        )}
                        <div className="ml-auto flex gap-1">
                          {log.ai_flags.filter((f) => f !== "migrated_from_briohr").map((f) => {
                            const info = FLAG_LABELS[f] || { label: f, color: "text-gray-500" };
                            return (
                              <span key={f} className={`rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium ${info.color}`}>
                                {info.label}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
