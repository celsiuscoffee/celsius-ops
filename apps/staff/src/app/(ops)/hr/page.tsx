"use client";

import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";
import { Clock, CalendarDays, CalendarOff, ChevronRight, CheckCircle2, History, Zap, Wallet, Sparkles, AlertTriangle, MapPin } from "lucide-react";
import { useLocationPing } from "@/lib/hr/use-location-ping";

type HRStatus = {
  activeLog: {
    id: string;
    clock_in: string;
  } | null;
  geofence: unknown;
  outletId: string | null;
};

type AllowanceBreakdown = {
  isFullTime: boolean;
  period: { year: number; month: number; daysElapsed: number; daysRemaining: number };
  attendance: { base: number; earned: number; tip: string; metrics: { lateCount: number; absentCount: number } };
  performance: { base: number; earned: number; score: number; mode: string; eligible: boolean; breakdown: { checklists: number; reviews: number; audit: number }; tip: string };
  reviewPenalty: { total: number; entries: { id: string; reviewDate: string; rating: number; amount: number }[] };
  totalEarned: number;
  totalMax: number;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type LeaveBalanceSummary = {
  annual: { entitled: number; remaining: number };
  sick: { entitled: number; remaining: number };
};

export default function HRHomePage() {
  const { data: clockStatus } = useFetch<HRStatus>("/api/hr/clock");
  const { data: allowanceData } = useFetch<{ breakdown: AllowanceBreakdown }>("/api/hr/allowances");
  const allowance = allowanceData?.breakdown;
  const isClockedInForPing = !!clockStatus?.activeLog;
  const ping = useLocationPing({ enabled: isClockedInForPing });

  const isClockedIn = !!clockStatus?.activeLog;
  const clockedInSince = clockStatus?.activeLog
    ? new Date(clockStatus.activeLog.clock_in).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })
    : null;

  const actions = [
    {
      href: "/hr/clock",
      icon: Clock,
      label: "Time Clock",
      subtitle: isClockedIn ? `Clocked in since ${clockedInSince}` : "Not clocked in",
      color: isClockedIn ? "text-green-600" : "text-gray-400",
      bgColor: isClockedIn ? "bg-green-50" : "bg-gray-50",
    },
    {
      href: "/hr/shifts",
      icon: CalendarDays,
      label: "My Shifts",
      subtitle: "View upcoming schedule",
      color: "text-blue-600",
      bgColor: "bg-blue-50",
    },
    {
      href: "/hr/attendance",
      icon: History,
      label: "Attendance",
      subtitle: "My clock-in history",
      color: "text-green-600",
      bgColor: "bg-green-50",
    },
    {
      href: "/hr/leave",
      icon: CalendarOff,
      label: "Leave",
      subtitle: "Request & view balances",
      color: "text-purple-600",
      bgColor: "bg-purple-50",
    },
    {
      href: "/hr/overtime",
      icon: Zap,
      label: "Overtime",
      subtitle: "Request OT approval",
      color: "text-amber-600",
      bgColor: "bg-amber-50",
    },
  ];

  return (
    <div className="px-4 pt-6">
      <h1 className="mb-6 text-2xl font-bold">HR</h1>

      {/* Clock-in status card */}
      <div className={`mb-4 rounded-2xl p-4 ${isClockedIn ? "bg-green-50 border border-green-200" : "bg-gray-50 border border-gray-200"}`}>
        <div className="flex items-center gap-3">
          <div className={`rounded-full p-2 ${isClockedIn ? "bg-green-100" : "bg-gray-200"}`}>
            <Clock className={`h-6 w-6 ${isClockedIn ? "text-green-600" : "text-gray-400"}`} />
          </div>
          <div className="flex-1">
            <p className="font-semibold">{isClockedIn ? "On Shift" : "Off Shift"}</p>
            <p className="text-sm text-gray-500">
              {isClockedIn ? `Since ${clockedInSince}` : "Tap Time Clock to start"}
            </p>
          </div>
          {isClockedIn && <CheckCircle2 className="h-6 w-6 text-green-500" />}
        </div>
      </div>

      {/* Geofence exit warning */}
      {isClockedInForPing && (ping.status === "warning" || ping.status === "auto_close_pending" || ping.status === "out_of_zone") && (
        <div className={
          "mb-4 rounded-2xl border p-4 " +
          (ping.status === "auto_close_pending"
            ? "border-red-200 bg-red-50"
            : ping.status === "warning"
              ? "border-amber-200 bg-amber-50"
              : "border-gray-200 bg-gray-50")
        }>
          <div className="flex items-start gap-3">
            <div className={
              "rounded-full p-2 " +
              (ping.status === "auto_close_pending" ? "bg-red-100" :
               ping.status === "warning" ? "bg-amber-100" : "bg-gray-200")
            }>
              {ping.status === "auto_close_pending"
                ? <AlertTriangle className="h-5 w-5 text-red-600" />
                : <MapPin className="h-5 w-5 text-amber-600" />}
            </div>
            <div className="flex-1">
              <p className="font-semibold">
                {ping.status === "auto_close_pending"
                  ? "Auto clock-out imminent"
                  : ping.status === "warning"
                    ? "You're away from the outlet"
                    : "Out of zone"}
              </p>
              <p className="mt-0.5 text-sm text-gray-600">
                {ping.distance !== null && ping.zoneName ? (
                  <>You're <strong>{ping.distance}m</strong> from {ping.zoneName} · out of zone for <strong>{ping.outOfZoneMinutes} min</strong></>
                ) : (
                  "Please confirm your location"
                )}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {ping.status === "auto_close_pending"
                  ? `System will auto clock-out to your last in-zone time. Return to the outlet now or contact your manager.`
                  : `Return to the outlet within ${Math.max(0, ping.grace - ping.outOfZoneMinutes)} min to avoid auto clock-out.`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Allowances card — only for staff assigned to an outlet (not HQ / non-scheduled owners) */}
      {allowance && clockStatus?.outletId && (
        <div className="mb-6 rounded-2xl border border-terracotta/30 bg-gradient-to-br from-orange-50 to-amber-50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-full bg-terracotta/15 p-2">
                <Wallet className="h-5 w-5 text-terracotta" />
              </div>
              <div>
                <p className="font-semibold">{MONTHS[allowance.period.month - 1]} Allowances</p>
                <p className="text-xs text-gray-500">{allowance.period.daysRemaining} day{allowance.period.daysRemaining !== 1 ? "s" : ""} left · paid with salary</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-terracotta">RM {allowance.totalEarned}</p>
              <p className="text-xs text-gray-500">of RM {allowance.totalMax}</p>
            </div>
          </div>

          {/* Attendance bar */}
          <div className="mb-3 rounded-xl bg-white/70 p-3">
            <div className="mb-1 flex items-center justify-between text-sm">
              <div className="flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-blue-600" />
                <span className="font-medium">Attendance</span>
              </div>
              <span className="font-semibold">RM {allowance.attendance.earned} / RM {allowance.attendance.base}</span>
            </div>
            <div className="mb-1.5 h-2 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${(allowance.attendance.earned / allowance.attendance.base) * 100}%` }}
              />
            </div>
            <p className="text-xs text-gray-600">{allowance.attendance.tip}</p>
          </div>

          {/* Performance bar — FT only */}
          {allowance.performance.eligible ? (
            <div className="mb-3 rounded-xl bg-white/70 p-3">
              <div className="mb-1 flex items-center justify-between text-sm">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-amber-600" />
                  <span className="font-medium">Performance</span>
                  <span className="text-xs text-gray-400">· score {allowance.performance.score}/100</span>
                </div>
                <span className="font-semibold">RM {allowance.performance.earned} / RM {allowance.performance.base}</span>
              </div>
              <div className="mb-1.5 h-2 overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all"
                  style={{ width: allowance.performance.base > 0 ? `${(allowance.performance.earned / allowance.performance.base) * 100}%` : "0%" }}
                />
              </div>
              <div className="mb-1 flex items-center gap-3 text-[11px] text-gray-500">
                <span>Checklists {allowance.performance.breakdown.checklists}</span>
                <span>Reviews {allowance.performance.breakdown.reviews}</span>
                <span>Audit {allowance.performance.breakdown.audit}</span>
              </div>
              <p className="text-xs text-gray-600">{allowance.performance.tip}</p>
            </div>
          ) : (
            <div className="mb-3 rounded-xl bg-white/70 p-3">
              <div className="flex items-center gap-1.5 text-sm text-gray-500">
                <Sparkles className="h-4 w-4" />
                <span>Performance allowance — full-time staff only</span>
              </div>
            </div>
          )}

          {/* Review penalty line */}
          {allowance.reviewPenalty.total > 0 && (
            <div className="rounded-xl bg-red-50 p-3">
              <div className="mb-1 flex items-center justify-between text-sm">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                  <span className="font-medium text-red-700">Review penalty</span>
                </div>
                <span className="font-semibold text-red-700">−RM {allowance.reviewPenalty.total}</span>
              </div>
              <p className="text-xs text-red-600">{allowance.reviewPenalty.entries.length} bad review{allowance.reviewPenalty.entries.length !== 1 ? "s" : ""} attributed this month.</p>
            </div>
          )}
        </div>
      )}

      {/* Quick Actions */}
      <div className="space-y-3">
        {actions.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition-all active:scale-[0.98]"
            >
              <div className={`rounded-xl p-3 ${item.bgColor}`}>
                <Icon className={`h-6 w-6 ${item.color}`} />
              </div>
              <div className="flex-1">
                <p className="font-semibold">{item.label}</p>
                <p className="text-sm text-gray-500">{item.subtitle}</p>
              </div>
              <ChevronRight className="h-5 w-5 text-gray-300" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
