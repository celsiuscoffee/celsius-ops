"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { formatTime } from "@/lib/format-time";
import {
  ClipboardCheck,
  ClipboardList,
  Package,
  ArrowRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  Camera,
  ChevronDown,
  RefreshCw,
  User,
  UserCircle2,
  X,
  CalendarOff,
} from "lucide-react";

type UserProfile = {
  id: string;
  name: string;
  role: string;
  outletId: string | null;
  outletName?: string | null;
  moduleAccess?: Record<string, unknown>;
};

type ChecklistSummary = {
  id: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  sop: { title: string; category: { name: string } };
  timeSlot: string | null;
  dueAt: string | null;
  totalItems: number;
  completedItems: number;
  progress: number;
};

type DashboardData = {
  stockCheckDone: boolean;
  lastCheckTime: string | null;
  deliveriesExpected: number;
  deliverySuppliers: string[];
};

type ManagerData = {
  auditDoneToday: boolean;
  auditInProgress: string | null;
  teamChecklistsTotal: number;
  teamChecklistsDone: number;
  recentAudits: {
    id: string;
    template: string;
    auditor: string;
    score: number | null;
    completedAt: string | null;
  }[];
};

// ─── Unified task type ──────────────────────────────
type TaskPriority = "overdue" | "due_soon" | "on_track" | "done";

type UnifiedTask = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  priority: TaskPriority;
  progress?: number;
  photoCount?: string;
  timeLabel?: string;
  icon: typeof ClipboardCheck;
};

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  overdue: 0, due_soon: 1, on_track: 2, done: 3,
};

const PRIORITY_CONFIG: Record<TaskPriority, {
  label: string; color: string; iconColor: string; Icon: typeof AlertCircle;
}> = {
  overdue: { label: "Overdue", color: "text-danger-text", iconColor: "text-danger-text", Icon: AlertCircle },
  due_soon: { label: "Due soon", color: "text-warn-text", iconColor: "text-warn-text", Icon: Clock },
  on_track: { label: "To do", color: "text-text-2", iconColor: "text-text-3", Icon: Clock },
  done: { label: "Done", color: "text-text-3", iconColor: "text-ok-text", Icon: CheckCircle2 },
};

function formatTimeAgo(iso: string | null) {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Yesterday" : `${days}d ago`;
}

export function HomeClient({
  user,
  initialChecklists,
  initialDashboard,
  managerData = null,
}: {
  user: UserProfile;
  initialChecklists: ChecklistSummary[];
  initialDashboard: DashboardData | null;
  managerData?: ManagerData | null;
}) {
  const [checklists, setChecklists] = useState(initialChecklists);
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [showDone, setShowDone] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stockSchedule, setStockSchedule] = useState<{ weeklyDays: number[]; endOfMonthDays: number[] }>({ weeklyDays: [0, 2, 4], endOfMonthDays: [28, 29, 30, 31] });

  // Profile-completeness reminder. Hidden once profile is marked complete
  // OR the user dismisses the banner today. Dismissal is stored in
  // localStorage with today's date so it re-appears tomorrow.
  const [profileReminder, setProfileReminder] = useState<{
    show: boolean;
    percent: number;
  } | null>(null);

  // Who's away today (and tomorrow). Scoped to user's outlet for non-managers.
  type AwayItem = { user_id: string; name: string; leave_type: string; start_date: string; end_date: string; outlet: string | null };
  const [whosAway, setWhosAway] = useState<{ today: AwayItem[]; tomorrow: AwayItem[] } | null>(null);

  // Clock-in status + live elapsed time. The whole point of putting this at the
  // top of home is so staff can clock in with one tap from the moment they
  // open the app — that's how Brio behaves and that's why their adoption is
  // 100% while ours was 2.4% pre-launch.
  const [clockStatus, setClockStatus] = useState<{ activeLog: { id: string; clock_in: string } | null } | null>(null);
  const [clockElapsed, setClockElapsed] = useState("");

  const refreshClockStatus = useCallback(() => {
    fetch("/api/hr/clock").then((r) => r.ok ? r.json() : null).then((d) => { if (d) setClockStatus(d); }).catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/settings/stock-count").then((r) => r.ok ? r.json() : null).then((s) => { if (s) setStockSchedule(s); }).catch(() => {});

    // Profile reminder: show only if not complete and not dismissed today.
    fetch("/api/hr/profile")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d?.completeness) return;
        if (d.completeness.complete) return;
        const today = new Date().toISOString().slice(0, 10);
        const dismissed = typeof window !== "undefined"
          ? localStorage.getItem("profile_reminder_dismissed")
          : null;
        if (dismissed === today) return;
        setProfileReminder({ show: true, percent: d.completeness.percent });
      })
      .catch(() => {});

    // Who's away today/tomorrow — small widget at the bottom.
    fetch("/api/hr/whos-away")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setWhosAway(d); })
      .catch(() => {});

    refreshClockStatus();
  }, [refreshClockStatus]);

  // Tick the elapsed counter every second while clocked in. The clock face
  // doesn't need pixel-precise updates, but a moving counter makes the card
  // feel alive and answers "how long have I been working?" without math.
  useEffect(() => {
    if (!clockStatus?.activeLog) { setClockElapsed(""); return; }
    const startMs = new Date(clockStatus.activeLog.clock_in).getTime();
    const tick = () => {
      const diffMs = Date.now() - startMs;
      const h = Math.floor(diffMs / 3_600_000);
      const m = Math.floor((diffMs % 3_600_000) / 60_000);
      const s = Math.floor((diffMs % 60_000) / 1000);
      setClockElapsed(`${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [clockStatus?.activeLog]);

  const dismissProfileReminder = useCallback(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("profile_reminder_dismissed", new Date().toISOString().slice(0, 10));
    }
    setProfileReminder(null);
  }, []);

  // Pull-to-refresh state
  const scrollRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);
  const PULL_THRESHOLD = 60;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const outletParam = user.outletId ? `&outletId=${user.outletId}` : "&mine=true";

    const [clsRes, dashRes] = await Promise.all([
      fetch(`/api/checklists?date=${dateStr}${outletParam}`).catch(() => null),
      user.outletId ? fetch(`/api/dashboard?outletId=${user.outletId}`).catch(() => null) : null,
    ]);

    if (clsRes) {
      try {
        const cls = await clsRes.json();
        if (Array.isArray(cls)) setChecklists(cls);
      } catch {}
    }
    if (dashRes?.ok) {
      try {
        const dash = await dashRes.json();
        if (dash) setDashboard(dash);
      } catch {}
    }
    setRefreshing(false);
  }, [user]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (scrollRef.current && scrollRef.current.scrollTop <= 0) {
      touchStartY.current = e.touches[0].clientY;
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (refreshing) return;
    if (scrollRef.current && scrollRef.current.scrollTop <= 0) {
      const delta = e.touches[0].clientY - touchStartY.current;
      if (delta > 0) setPullDistance(Math.min(delta * 0.5, 100));
    }
  }, [refreshing]);

  const onTouchEnd = useCallback(() => {
    if (pullDistance >= PULL_THRESHOLD && !refreshing) handleRefresh();
    setPullDistance(0);
  }, [pullDistance, refreshing, handleRefresh]);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateStr = now.toLocaleDateString("en-MY", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });

  // ─── Build unified task list ──────────────────────────
  const tasks = useMemo(() => {
    const list: UnifiedTask[] = [];

    for (const cl of checklists) {
      let priority: TaskPriority = "on_track";
      let timeLabel = "";

      if (cl.status === "COMPLETED") {
        priority = "done";
        timeLabel = "Completed";
      } else if (cl.dueAt) {
        const due = new Date(cl.dueAt);
        const diffMs = due.getTime() - now.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMs < 0) {
          priority = "overdue";
          const agoMin = Math.abs(diffMin);
          timeLabel = agoMin < 60 ? `${agoMin}m overdue` : `${Math.floor(agoMin / 60)}h overdue`;
        } else if (diffMin <= 30) {
          priority = "due_soon";
          timeLabel = `${diffMin}m left`;
        } else {
          priority = "on_track";
          timeLabel = cl.timeSlot ? `Due ${cl.timeSlot}` : diffMin < 120 ? `${diffMin}m left` : `${Math.floor(diffMin / 60)}h left`;
        }
      }

      list.push({
        id: `sop-${cl.id}`, title: cl.sop.title, subtitle: cl.sop.category.name,
        href: `/checklists/${cl.id}`, priority, progress: cl.progress,
        photoCount: `${cl.completedItems}/${cl.totalItems}`, timeLabel, icon: Camera,
      });
    }

    if (dashboard) {
      // Stock count schedule from settings
      const dayOfWeek = now.getDay();
      const isCountDay = stockSchedule.weeklyDays.includes(dayOfWeek);
      const dayOfMonth = now.getDate();
      const isEndOfMonth = stockSchedule.endOfMonthDays.includes(dayOfMonth);

      const countLabel = isEndOfMonth
        ? "Full stock count (end of month)"
        : isCountDay
          ? "Stock count"
          : null;

      if (countLabel) {
        if (!dashboard.stockCheckDone) {
          const isAfternoon = hour >= 12;
          list.push({
            id: "inv-stock-count", title: countLabel,
            subtitle: dashboard.lastCheckTime ? `Last: ${formatTimeAgo(dashboard.lastCheckTime)}` : "Never done",
            href: "/stock-count",
            priority: isAfternoon ? "overdue" : hour >= 10 ? "due_soon" : "on_track",
            timeLabel: isAfternoon ? "Due by 12:00 PM" : "Morning task",
            icon: ClipboardCheck,
          });
        } else {
          list.push({
            id: "inv-stock-count", title: countLabel, subtitle: "Completed today",
            href: "/stock-count", priority: "done", timeLabel: "Done", icon: ClipboardCheck,
          });
        }
      }
      if (dashboard.deliveriesExpected > 0) {
        list.push({
          id: "inv-deliveries",
          title: `Receive ${dashboard.deliveriesExpected} ${dashboard.deliveriesExpected === 1 ? "delivery" : "deliveries"}`,
          subtitle: dashboard.deliverySuppliers.slice(0, 3).join(", "),
          href: "/receiving", priority: "due_soon", timeLabel: "Awaiting arrival", icon: Package,
        });
      }
    }

    // Manager: "Create New Audit" task
    if (managerData) {
      if (managerData.auditInProgress) {
        list.push({
          id: "mgr-audit-in-progress",
          title: "Carry on with your audit",
          subtitle: "You have an audit in progress",
          href: `/audit/${managerData.auditInProgress}`,
          priority: "due_soon",
          timeLabel: "In progress",
          icon: ClipboardList,
        });
      } else if (managerData.auditDoneToday) {
        list.push({
          id: "mgr-audit-today",
          title: "Today's audit",
          subtitle: "Spot check done",
          href: "/audit",
          priority: "done",
          timeLabel: "Done",
          icon: ClipboardList,
        });
      } else {
        const isAfternoon = hour >= 14;
        list.push({
          id: "mgr-new-audit",
          title: "Start today's audit",
          subtitle: "Daily spot check of your team",
          href: "/audit",
          priority: isAfternoon ? "due_soon" : "on_track",
          timeLabel: isAfternoon ? "Do before end of day" : "Today's task",
          icon: ClipboardList,
        });
      }
    }

    list.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    return list;
  }, [checklists, dashboard, now, hour, stockSchedule, managerData]);

  const pendingTasks = tasks.filter((t) => t.priority !== "done");
  const doneTasks = tasks.filter((t) => t.priority === "done");
  const totalTasks = tasks.length;
  const doneCount = doneTasks.length;
  const progressPct = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;

  const grouped = useMemo(() => {
    const groups: Partial<Record<TaskPriority, UnifiedTask[]>> = {};
    for (const t of pendingTasks) {
      if (!groups[t.priority]) groups[t.priority] = [];
      groups[t.priority]!.push(t);
    }
    return groups;
  }, [pendingTasks]);

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      <div
        className="flex items-center justify-center overflow-hidden transition-all duration-200"
        style={{ height: pullDistance > 0 || refreshing ? Math.max(pullDistance, refreshing ? 48 : 0) : 0 }}
      >
        <RefreshCw className={`h-5 w-5 transition-transform ${refreshing ? "animate-spin" : ""} ${pullDistance >= PULL_THRESHOLD ? "scale-110 text-text" : "text-text-3"}`} />
      </div>

      <div className="px-4 pb-6 pt-5">
        <div className="space-y-4">
          {/* Header: who, where, when; Me opens from the button on the right */}
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-text-3">
                {user.outletName && <>{user.outletName} &middot; </>}{dateStr}
              </p>
              <h1 className="truncate font-heading text-[26px] font-semibold leading-8 text-text">
                {greeting}, {user.name?.split(" ")[0] || "there"}
              </h1>
            </div>
            <Link
              href="/profile"
              aria-label="Me: your profile"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-[13px] font-semibold text-text-2 active:bg-sunken"
            >
              {initials(user.name) || <User className="h-5 w-5" />}
            </Link>
          </div>

          {/* Clock in: the first thing on every shift. Ink while not clocked
              in (the one main action), a quiet ok card with the running time
              once in. No outlet (HQ-only staff): no clock. */}
          {user.outletId && (
            <Link
              href="/hr/clock"
              className={
                "block rounded-card border px-4 py-4 transition active:opacity-90 " +
                (clockStatus?.activeLog ? "border-ok/30 bg-ok-soft" : "border-ink bg-ink text-on-ink")
              }
            >
              <div className="flex items-center gap-3">
                <Clock className={"h-7 w-7 shrink-0 " + (clockStatus?.activeLog ? "text-ok-text" : "text-on-ink")} />
                <div className="min-w-0 flex-1">
                  {clockStatus?.activeLog ? (
                    <>
                      <p className="text-[13px] font-medium text-ok-text">
                        Clocked in at {formatTime(clockStatus.activeLog.clock_in)}
                      </p>
                      <p className="text-[22px] font-semibold leading-7 text-text">{clockElapsed || "—"}</p>
                      <p className="text-[12px] text-text-2">Tap to clock out</p>
                    </>
                  ) : (
                    <>
                      <p className="text-[13px] text-on-ink/75">Not clocked in</p>
                      <p className="text-[22px] font-semibold leading-7">Clock in</p>
                      <p className="text-[12px] text-on-ink/75">Selfie and location, about 5 seconds</p>
                    </>
                  )}
                </div>
                <ArrowRight className={"h-5 w-5 shrink-0 " + (clockStatus?.activeLog ? "text-ok-text" : "text-on-ink")} />
              </div>
            </Link>
          )}

          {/* Profile reminder: until the profile is complete or dismissed for the day. */}
          {profileReminder?.show && (
            <Link href="/profile/personal" className="block rounded-card border border-warn/30 bg-warn-soft px-4 py-3">
              <div className="flex items-start gap-3">
                <UserCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-warn-text" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text">Finish your profile</p>
                  <p className="text-[12px] text-text-2">
                    HR needs your address, IC and emergency contact for payslips and tax. It takes 2 minutes.
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
                    <div className="h-full bg-warn transition-all" style={{ width: `${profileReminder.percent}%` }} />
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dismissProfileReminder();
                  }}
                  className="-mr-2 -mt-2 flex h-11 w-11 items-center justify-center rounded-full text-warn-text active:bg-surface"
                  aria-label="Hide until tomorrow"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </Link>
          )}

          {/* Today's tasks: one list across checklists, stock and audits, the most urgent first */}
          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-[15px] font-semibold text-text">Today&apos;s tasks</h2>
              <p className="text-[13px] text-text-3">{doneCount} of {totalTasks} done</p>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
              <div
                className={`h-full rounded-full transition-all duration-500 ${progressPct === 100 ? "bg-ok" : "bg-ink"}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </section>

          {pendingTasks.length === 0 && totalTasks > 0 && (
            <div className="flex items-center gap-3 rounded-card border border-ok/30 bg-ok-soft px-4 py-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-ok-text" />
              <div>
                <p className="text-sm font-semibold text-text">All done for today</p>
                <p className="text-[12px] text-text-2">{totalTasks} {totalTasks === 1 ? "task" : "tasks"} finished</p>
              </div>
            </div>
          )}

          {totalTasks === 0 && (
            <p className="rounded-card border border-line bg-surface px-4 py-3 text-sm text-text-3">
              Nothing on your list yet. Checklists appear once the shift&apos;s lists are made.
            </p>
          )}

          {pendingTasks.length > 0 && (
            <div className="space-y-4">
              {(["overdue", "due_soon", "on_track"] as TaskPriority[]).map((priority) => {
                const group = grouped[priority];
                if (!group || group.length === 0) return null;
                const config = PRIORITY_CONFIG[priority];
                return (
                  <div key={priority}>
                    <h3 className={`mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold ${config.color}`}>
                      <config.Icon className="h-3.5 w-3.5" /> {config.label}
                    </h3>
                    <div className="overflow-hidden rounded-card border border-line bg-surface">
                      {group.map((task, i) => {
                        const Icon = task.icon;
                        return (
                          <Link
                            key={task.id}
                            href={task.href}
                            className={`flex min-h-[56px] items-center gap-3 px-4 py-2.5 active:bg-sunken ${i > 0 ? "border-t border-line" : ""}`}
                          >
                            <Icon className={`h-5 w-5 shrink-0 ${config.iconColor}`} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-text">{task.title}</p>
                              <p className="truncate text-[12px] text-text-3">
                                <span className={config.color}>{task.timeLabel}</span>
                                {task.photoCount && <> · {task.photoCount} photos</>}
                              </p>
                            </div>
                            {task.progress !== undefined ? (
                              <span className="shrink-0 text-[13px] font-semibold text-text-2">{task.progress}%</span>
                            ) : (
                              <ArrowRight className="h-4 w-4 shrink-0 text-text-3" />
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {doneTasks.length > 0 && (
            <div>
              <button
                onClick={() => setShowDone((v) => !v)}
                className="flex min-h-11 w-full items-center justify-between text-[13px] font-semibold text-text-3"
                aria-expanded={showDone}
              >
                <span>Done ({doneTasks.length})</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${showDone ? "rotate-180" : ""}`} />
              </button>
              {showDone && (
                <div className="overflow-hidden rounded-card border border-line bg-surface">
                  {doneTasks.map((task, i) => (
                    <Link
                      key={task.id}
                      href={task.href}
                      className={`flex min-h-11 items-center gap-3 px-4 py-2 active:bg-sunken ${i > 0 ? "border-t border-line" : ""}`}
                    >
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-ok-text" />
                      <p className="truncate text-sm text-text-3">{task.title}</p>
                      {task.photoCount && <span className="ml-auto shrink-0 text-[12px] text-text-3">{task.photoCount}</span>}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Managers: how the team is doing on today's checklists */}
          {managerData && managerData.teamChecklistsTotal > 0 && (
            <Link href="/audit" className="block rounded-card border border-line bg-surface px-4 py-3 active:bg-sunken">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-text">Team checklists today</p>
                  <p className="text-[12px] text-text-3">
                    {managerData.teamChecklistsDone} of {managerData.teamChecklistsTotal} done
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold text-text">
                    {Math.round((managerData.teamChecklistsDone / managerData.teamChecklistsTotal) * 100)}%
                  </span>
                  <ArrowRight className="h-4 w-4 text-text-3" />
                </div>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
                <div
                  className="h-full rounded-full bg-ink transition-all"
                  style={{ width: `${(managerData.teamChecklistsDone / managerData.teamChecklistsTotal) * 100}%` }}
                />
              </div>
            </Link>
          )}

          {/* Managers: the last audits at this outlet */}
          {managerData && managerData.recentAudits.length > 0 && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold text-text">Recent audits</h2>
                <Link href="/audit/history" className="flex min-h-11 items-center text-[13px] font-medium text-text-2">See all</Link>
              </div>
              <div className="overflow-hidden rounded-card border border-line bg-surface">
                {managerData.recentAudits.map((audit, i) => (
                  <Link
                    key={audit.id}
                    href={`/audit/${audit.id}`}
                    className={`flex min-h-[52px] items-center gap-3 px-4 py-2 active:bg-sunken ${i > 0 ? "border-t border-line" : ""}`}
                  >
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-ok-text" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text">{audit.template}</p>
                      <p className="text-[12px] text-text-3">{audit.auditor} · {formatTimeAgo(audit.completedAt)}</p>
                    </div>
                    {audit.score !== null && (
                      <span className={`shrink-0 text-[13px] font-semibold ${
                        audit.score >= 80 ? "text-ok-text" : audit.score >= 60 ? "text-warn-text" : "text-danger-text"
                      }`}>
                        {Math.round(audit.score)}%
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Who's away today and tomorrow, for covering the shift. Only when someone is. */}
          {whosAway && (whosAway.today.length > 0 || whosAway.tomorrow.length > 0) && (
            <section className="rounded-card border border-line bg-surface px-4 py-3">
              <div className="mb-2 flex items-center gap-2">
                <CalendarOff className="h-4 w-4 text-text-3" />
                <p className="text-sm font-semibold text-text">Who&apos;s away</p>
              </div>
              {(["today", "tomorrow"] as const).map((day) => whosAway[day].length > 0 && (
                <div key={day} className="mb-2 last:mb-0">
                  <p className="mb-1 text-[12px] font-medium text-text-3">{day === "today" ? "Today" : "Tomorrow"}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {whosAway[day].map((p) => (
                      <span
                        key={`${day}-${p.user_id}`}
                        title={`${p.leave_type.replace(/_/g, " ")} · ${p.start_date} → ${p.end_date}${p.outlet ? ` · ${p.outlet}` : ""}`}
                        className="inline-flex items-center gap-1.5 rounded-full bg-sunken py-0.5 pl-0.5 pr-2.5 text-[12px] text-text-2"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface text-[10px] font-semibold text-text-2">
                          {initials(p.name)}
                        </span>
                        {p.name.split(" ")[0]}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function initials(name: string | null | undefined): string {
  return (name ?? "").split(" ").filter(Boolean).map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}
