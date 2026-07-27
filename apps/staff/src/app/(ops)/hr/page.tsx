"use client";

import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";
import { Clock, CalendarDays, CalendarOff, CalendarClock, ChevronRight, CheckCircle2, History, Wallet, Sparkles, AlertTriangle, MapPin, FileText, Star, Target } from "lucide-react";
import { useLocationPing } from "@/lib/hr/use-location-ping";

type HRStatus = {
  activeLog: {
    id: string;
    clock_in: string;
  } | null;
  geofence: unknown;
  outletId: string | null;
};

type AllowanceLever = {
  key: string;
  label: string;
  applicable: boolean;
  score: number;
  tier: "under" | "ok" | "perform";
  slice: number;
  earned: number;
  detail: string;
};
type AllowanceBreakdown = {
  eligible: boolean;
  period: { year: number; month: number; daysElapsed: number; daysRemaining: number };
  pool: number;
  levers: AllowanceLever[];
  performanceEarned: number;
  attendance: { deductions: { kind: string; label: string; amount: number; date?: string }[]; lateCount: number; absentCount: number; total: number };
  reviewPenalty: { total: number; entries: { id: string; reviewDate: string; rating: number; amount: number; reviewText?: string | null }[] };
  totalEarned: number;
  totalMax: number;
  tip: string;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type LeaveBalanceSummary = {
  annual: { entitled: number; remaining: number };
  sick: { entitled: number; remaining: number };
};

export default function HRHomePage() {
  const { data: clockStatus } = useFetch<HRStatus>("/api/hr/clock");
  const { data: allowanceData } = useFetch<{ breakdown: AllowanceBreakdown }>("/api/hr/allowances");
  const { data: memosData } = useFetch<{ unacknowledgedCount: number }>("/api/hr/memos");
  const { data: reviewsData } = useFetch<{ count: number }>("/api/hr/my-reviews");
  const allowance = allowanceData?.breakdown;
  const unackMemos = memosData?.unacknowledgedCount ?? 0;
  const reviewsCount = reviewsData?.count ?? 0;
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
    // Open Slots hidden for now (owner 2026-07-22: slots logic removed). The
    // booking route/page still exist — restore this entry to bring it back.
    {
      href: "/hr/availability",
      icon: CalendarClock,
      label: "My Availability",
      subtitle: "Weekly pattern & blockout dates",
      color: "text-indigo-600",
      bgColor: "bg-indigo-50",
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
      href: "/hr/memos",
      icon: FileText,
      label: "Memos",
      subtitle: unackMemos > 0 ? `${unackMemos} new · pending acknowledgement` : "Warnings & commendations",
      color: unackMemos > 0 ? "text-red-600" : "text-gray-600",
      bgColor: unackMemos > 0 ? "bg-red-50" : "bg-gray-50",
    },
    {
      href: "/hr/reviews",
      icon: Star,
      label: "Feedback",
      subtitle: reviewsCount > 0 ? `${reviewsCount} review${reviewsCount === 1 ? "" : "s"} during your shifts` : "Reviews during your shifts",
      color: "text-amber-600",
      bgColor: "bg-amber-50",
    },
    {
      href: "/hr/my-skills",
      icon: Target,
      label: "My Skills",
      subtitle: "Skill audit scores & progress over time",
      color: "text-terracotta",
      bgColor: "bg-terracotta/10",
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
                  <>You&apos;re <strong>{ping.distance}m</strong> from {ping.zoneName} · out of zone for <strong>{ping.outOfZoneMinutes} min</strong></>
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

          {!allowance.eligible ? (
            <div className="rounded-xl bg-white/70 p-3 text-sm text-gray-500">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4" />
                <span>{allowance.tip || "Performance allowance is for full-time staff only."}</span>
              </div>
            </div>
          ) : (
            <>
              {/* Earn levers — each scored on its own KPI */}
              <div className="mb-3 space-y-2">
                {(allowance.levers ?? []).filter((l) => l.applicable).map((l) => {
                  const barColor = l.tier === "perform" ? "bg-green-500" : l.tier === "ok" ? "bg-amber-500" : "bg-red-500";
                  const pct = l.slice > 0 ? Math.round((l.earned / l.slice) * 100) : 0;
                  return (
                    <div key={l.key} className="rounded-xl bg-white/70 p-3">
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="font-medium">{l.label}</span>
                        <span className="font-semibold">RM {l.earned} / {l.slice}</span>
                      </div>
                      <div className="mb-1.5 h-2 overflow-hidden rounded-full bg-gray-200">
                        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-[11px] text-gray-600">{l.detail}</p>
                    </div>
                  );
                })}
                {(allowance.levers ?? []).some((l) => !l.applicable) && (
                  <p className="px-1 text-[11px] text-gray-400">
                    Not counted for you: {(allowance.levers ?? []).filter((l) => !l.applicable).map((l) => l.label).join(", ")} (shared across your other areas).
                  </p>
                )}
              </div>

              {/* Deductions — itemized with reason, mirrors backoffice */}
              {((allowance.attendance?.total ?? 0) > 0 || (allowance.reviewPenalty?.total ?? 0) > 0) && (
                <div className="rounded-xl bg-red-50 p-3">
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                      <span className="font-medium text-red-700">Deductions</span>
                    </div>
                    <span className="font-semibold text-red-700">−RM {(allowance.attendance?.total ?? 0) + (allowance.reviewPenalty?.total ?? 0)}</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-[11px] text-red-600">
                    <span>Late {allowance.attendance?.lateCount ?? 0}</span>
                    <span>No-show {allowance.attendance?.absentCount ?? 0}</span>
                    {(allowance.reviewPenalty?.entries ?? []).length > 0 && (
                      <span>Review {(allowance.reviewPenalty?.entries ?? []).length}</span>
                    )}
                  </div>

                  {/* Itemized attendance deductions — date · reason · amount */}
                  {(allowance.attendance?.deductions ?? []).length > 0 && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer select-none text-red-700 hover:text-red-800">
                        {(allowance.attendance?.deductions ?? []).length} deduction{(allowance.attendance?.deductions ?? []).length === 1 ? "" : "s"} — tap to view
                      </summary>
                      <ul className="mt-1.5 space-y-1 text-red-700">
                        {(allowance.attendance?.deductions ?? []).map((d, i) => (
                          <li key={i} className="flex items-start justify-between gap-2">
                            <span>
                              {d.date ? <span className="mr-1 font-mono text-[10px] text-red-500">{d.date}</span> : null}
                              {d.label}
                            </span>
                            <span className="shrink-0 font-semibold">−RM {d.amount}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {/* Review penalties — stars · date · reason text */}
                  {(allowance.reviewPenalty?.entries ?? []).length > 0 && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer select-none text-red-700 hover:text-red-800">
                        {(allowance.reviewPenalty?.entries ?? []).length} review penalt{(allowance.reviewPenalty?.entries ?? []).length === 1 ? "y" : "ies"} — tap to view
                      </summary>
                      <ul className="mt-1.5 space-y-1 text-red-700">
                        {(allowance.reviewPenalty?.entries ?? []).map((e) => (
                          <li key={e.id} className="flex flex-wrap items-center gap-1.5">
                            <span className="flex shrink-0 items-center">
                              {Array.from({ length: 5 }).map((_, i) => (
                                <Star key={i} className={`h-3 w-3 ${i < e.rating ? "fill-red-500 text-red-500" : "text-red-200"}`} />
                              ))}
                            </span>
                            <span className="font-mono text-[10px] text-red-500">{e.reviewDate}</span>
                            <span className="font-semibold">−RM {e.amount}</span>
                            {e.reviewText && <span className="w-full truncate italic text-red-600">&ldquo;{e.reviewText}&rdquo;</span>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}

              <p className="mt-2 px-1 text-xs text-gray-600">{allowance.tip}</p>
            </>
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
