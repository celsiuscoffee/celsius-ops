"use client";

import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";
import { Clock, CalendarDays, CalendarOff, CalendarClock, ChevronRight, History, Wallet, Sparkles, AlertTriangle, MapPin, FileText, Star, Target, Users, Receipt } from "lucide-react";
import { useLocationPing } from "@/lib/hr/use-location-ping";
import { PageHeader } from "@/components/page-header";
import { formatTime } from "@/lib/format-time";

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
  const { data: profileData } = useFetch<{ profile: { employment_type?: string | null } }>("/api/hr/profile");
  // Availability is a part-timer tool (interns too) — full-timers have
  // manager-set schedules, so hide it for them. The page + API enforce it too.
  const isPartTimer = ["part_time", "intern"].includes(profileData?.profile?.employment_type ?? "");
  const allowance = allowanceData?.breakdown;
  const unackMemos = memosData?.unacknowledgedCount ?? 0;
  const reviewsCount = reviewsData?.count ?? 0;
  const isClockedInForPing = !!clockStatus?.activeLog;
  const ping = useLocationPing({ enabled: isClockedInForPing });

  const isClockedIn = !!clockStatus?.activeLog;
  const clockedInSince = clockStatus?.activeLog ? formatTime(clockStatus.activeLog.clock_in) : null;

  // One question per section (docs/design/staff-app-structure.md). The clock
  // row carries the on-shift status, so there is no separate status card.
  type Row = { href: string; icon: typeof Clock; label: string; subtitle: string; tone?: "ok" | "danger" };
  const sections: { title: string; rows: Row[] }[] = [
    {
      title: "When I work",
      rows: [
        {
          href: "/hr/clock",
          icon: Clock,
          label: isClockedIn ? "Clock out" : "Clock in",
          subtitle: isClockedIn ? `On shift since ${clockedInSince}` : "Not clocked in",
          tone: isClockedIn ? "ok" : undefined,
        },
        { href: "/hr/shifts", icon: CalendarDays, label: "My shifts", subtitle: "Your coming shifts, and swaps" },
        { href: "/hr/whos-working", icon: Users, label: "Who's working", subtitle: "Who is on shift with you" },
        // Open Slots hidden for now (owner 2026-07-22: slots logic removed). The
        // booking route/page still exist — restore this entry to bring it back.
        // Availability shows for part-timers/interns only.
        ...(isPartTimer
          ? [{ href: "/hr/availability", icon: CalendarClock, label: "My availability", subtitle: "Your weekly pattern and days you can't work" }]
          : []),
        { href: "/hr/attendance", icon: History, label: "Clock-in history", subtitle: "Your clock-ins and hours" },
      ],
    },
    {
      title: "Time off and pay",
      rows: [
        { href: "/hr/leave", icon: CalendarOff, label: "Leave", subtitle: "Days left, and asking for leave" },
        // Pay (owner 20 Nov 2026): the month or week so far, payday, overtime
        // still waiting and the latest payslip. A row here, not a sixth tab.
        { href: "/hr/pay", icon: Wallet, label: "Pay", subtitle: "Pay so far, payday and overtime waiting" },
        // The page existed and was reachable only by typing the URL — nothing in
        // this app linked to it. The manager app has had the equivalent tile all
        // along ((staff)/hr/index.tsx).
        { href: "/hr/payslips", icon: Receipt, label: "Payslips", subtitle: "Your pay, month by month" },
      ],
    },
    {
      title: "How I'm doing",
      rows: [
        {
          href: "/hr/memos",
          icon: FileText,
          label: "Memos",
          subtitle: unackMemos > 0 ? `${unackMemos} new, waiting for you to read` : "Notes, warnings and thanks",
          tone: unackMemos > 0 ? "danger" : undefined,
        },
        {
          href: "/hr/reviews",
          icon: Star,
          label: "Customer feedback",
          subtitle: reviewsCount > 0 ? `${reviewsCount} review${reviewsCount === 1 ? "" : "s"} during your shifts` : "Reviews during your shifts",
        },
        { href: "/hr/my-skills", icon: Target, label: "My skills", subtitle: "Your audit scores over time" },
      ],
    },
  ];

  return (
    <div className="px-4 pb-6">
      <PageHeader title="Shifts" description="When you work, your time off and your pay." />

      {/* Geofence exit warning */}
      {isClockedInForPing && (ping.status === "warning" || ping.status === "auto_close_pending" || ping.status === "out_of_zone") && (
        <div className={
          "mb-4 rounded-card border p-4 " +
          (ping.status === "auto_close_pending"
            ? "border-danger/30 bg-danger-soft"
            : ping.status === "warning"
              ? "border-warn/30 bg-warn-soft"
              : "border-line bg-surface")
        }>
          <div className="flex items-start gap-3">
            {ping.status === "auto_close_pending"
              ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger-text" />
              : <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-warn-text" />}
            <div className="flex-1">
              <p className="font-semibold text-text">
                {ping.status === "auto_close_pending"
                  ? "You will be clocked out soon"
                  : ping.status === "warning"
                    ? "You're away from the outlet"
                    : "Out of zone"}
              </p>
              <p className="mt-0.5 text-sm text-text-2">
                {ping.distance !== null && ping.zoneName ? (
                  <>You&apos;re <strong>{ping.distance} m</strong> from {ping.zoneName}, out of zone for <strong>{ping.outOfZoneMinutes} min</strong></>
                ) : (
                  "Please confirm your location"
                )}
              </p>
              <p className="mt-1 text-xs text-text-3">
                {ping.status === "auto_close_pending"
                  ? `You will be clocked out at the last time you were in the zone. Go back to the outlet now or call your manager.`
                  : `Go back to the outlet within ${Math.max(0, ping.grace - ping.outOfZoneMinutes)} min, or you will be clocked out.`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Allowances card — only for staff assigned to an outlet (not HQ / non-scheduled owners) */}
      {allowance && clockStatus?.outletId && (
        <div className="mb-5 rounded-card border border-line bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5 shrink-0 text-text-3" />
              <div>
                <p className="font-semibold">{MONTHS[allowance.period.month - 1]} allowance</p>
                <p className="text-xs text-text-3">{allowance.period.daysRemaining} day{allowance.period.daysRemaining !== 1 ? "s" : ""} left, paid with your salary</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-semibold text-text">RM {allowance.totalEarned}</p>
              <p className="text-xs text-text-3">of RM {allowance.totalMax}</p>
            </div>
          </div>

          {!allowance.eligible ? (
            <div className="rounded-xl bg-sunken p-3 text-sm text-text-3">
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
                  const barColor = l.tier === "perform" ? "bg-ok" : l.tier === "ok" ? "bg-warn" : "bg-danger";
                  const pct = l.slice > 0 ? Math.round((l.earned / l.slice) * 100) : 0;
                  return (
                    <div key={l.key} className="rounded-xl bg-sunken p-3">
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="font-medium">{l.label}</span>
                        <span className="font-semibold">RM {l.earned} / {l.slice}</span>
                      </div>
                      <div className="mb-1.5 h-2 overflow-hidden rounded-full bg-line">
                        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-[11px] text-text-2">{l.detail}</p>
                    </div>
                  );
                })}
                {(allowance.levers ?? []).some((l) => !l.applicable) && (
                  <p className="px-1 text-[11px] text-text-3">
                    Not counted for you: {(allowance.levers ?? []).filter((l) => !l.applicable).map((l) => l.label).join(", ")} (shared across your other areas).
                  </p>
                )}
              </div>

              {/* Deductions — itemized with reason, mirrors backoffice */}
              {((allowance.attendance?.total ?? 0) > 0 || (allowance.reviewPenalty?.total ?? 0) > 0) && (
                <div className="rounded-xl bg-danger-soft p-3">
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4 text-danger-text" />
                      <span className="font-medium text-danger-text">Deductions</span>
                    </div>
                    <span className="font-semibold text-danger-text">−RM {(allowance.attendance?.total ?? 0) + (allowance.reviewPenalty?.total ?? 0)}</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-[11px] text-danger-text">
                    <span>Late {allowance.attendance?.lateCount ?? 0}</span>
                    <span>No-show {allowance.attendance?.absentCount ?? 0}</span>
                    {(allowance.reviewPenalty?.entries ?? []).length > 0 && (
                      <span>Review {(allowance.reviewPenalty?.entries ?? []).length}</span>
                    )}
                  </div>

                  {/* Itemized attendance deductions — date · reason · amount */}
                  {(allowance.attendance?.deductions ?? []).length > 0 && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer select-none text-danger-text hover:text-danger-text">
                        {(allowance.attendance?.deductions ?? []).length} deduction{(allowance.attendance?.deductions ?? []).length === 1 ? "" : "s"} (tap to see)
                      </summary>
                      <ul className="mt-1.5 space-y-1 text-danger-text">
                        {(allowance.attendance?.deductions ?? []).map((d, i) => (
                          <li key={i} className="flex items-start justify-between gap-2">
                            <span>
                              {d.date ? <span className="mr-1 font-mono text-[10px] text-danger">{d.date}</span> : null}
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
                      <summary className="cursor-pointer select-none text-danger-text hover:text-danger-text">
                        {(allowance.reviewPenalty?.entries ?? []).length} review penalt{(allowance.reviewPenalty?.entries ?? []).length === 1 ? "y" : "ies"} (tap to see)
                      </summary>
                      <ul className="mt-1.5 space-y-1 text-danger-text">
                        {(allowance.reviewPenalty?.entries ?? []).map((e) => (
                          <li key={e.id} className="flex flex-wrap items-center gap-1.5">
                            <span className="flex shrink-0 items-center">
                              {Array.from({ length: 5 }).map((_, i) => (
                                <Star key={i} className={`h-3 w-3 ${i < e.rating ? "fill-danger text-danger" : "text-danger"}`} />
                              ))}
                            </span>
                            <span className="font-mono text-[10px] text-danger">{e.reviewDate}</span>
                            <span className="font-semibold">−RM {e.amount}</span>
                            {e.reviewText && <span className="w-full truncate italic text-danger-text">&ldquo;{e.reviewText}&rdquo;</span>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}

              <p className="mt-2 px-1 text-xs text-text-2">{allowance.tip}</p>
            </>
          )}
        </div>
      )}

      <div className="space-y-5">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="mb-2 text-[13px] font-semibold text-text-2">{section.title}</h2>
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              {section.rows.map((item, i) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex min-h-[60px] items-center gap-3 px-4 py-2.5 active:bg-sunken ${i > 0 ? "border-t border-line" : ""}`}
                  >
                    <Icon className={`h-5 w-5 shrink-0 ${item.tone === "ok" ? "text-ok-text" : item.tone === "danger" ? "text-danger-text" : "text-text-3"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-text">{item.label}</p>
                      <p className={`truncate text-[13px] ${item.tone === "ok" ? "text-ok-text" : item.tone === "danger" ? "text-danger-text" : "text-text-3"}`}>{item.subtitle}</p>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-text-3" />
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
