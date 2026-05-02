"use client";

/* eslint-disable @next/next/no-img-element */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { hasAccess } from "@/lib/access";
import {
  ClipboardCheck,
  ClipboardList,
  Package,
  ArrowRight,
  Trash2,
  ArrowLeftRight,
  Receipt,
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
  label: string; color: string; borderColor: string; iconColor: string; Icon: typeof AlertCircle;
}> = {
  overdue: { label: "Overdue", color: "text-red-500", borderColor: "border-l-red-400", iconColor: "text-red-500", Icon: AlertCircle },
  due_soon: { label: "Due Soon", color: "text-amber-600", borderColor: "border-l-amber-400", iconColor: "text-amber-500", Icon: Clock },
  on_track: { label: "To Do", color: "text-gray-500", borderColor: "border-l-green-300", iconColor: "text-green-500", Icon: Clock },
  done: { label: "Done", color: "text-gray-400", borderColor: "border-l-gray-200", iconColor: "text-green-400", Icon: CheckCircle2 },
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
  showQuickActions = true,
  managerData = null,
}: {
  user: UserProfile;
  initialChecklists: ChecklistSummary[];
  initialDashboard: DashboardData | null;
  showQuickActions?: boolean;
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
  }, []);

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
        ? "Full Stock Count (End of Month)"
        : isCountDay
          ? "Stock Count"
          : null;

      if (countLabel) {
        if (!dashboard.stockCheckDone) {
          const isAfternoon = hour >= 12;
          list.push({
            id: "inv-stock-count", title: countLabel,
            subtitle: dashboard.lastCheckTime ? `Last: ${formatTimeAgo(dashboard.lastCheckTime)}` : "Never done",
            href: "/stock-count",
            priority: isAfternoon ? "overdue" : hour >= 10 ? "due_soon" : "on_track",
            timeLabel: isAfternoon ? "Should be done by noon" : "Morning task",
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
          title: `Receive ${dashboard.deliveriesExpected} ${dashboard.deliveriesExpected === 1 ? "Delivery" : "Deliveries"}`,
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
          title: "Resume Audit",
          subtitle: "You have an audit in progress",
          href: `/audit/${managerData.auditInProgress}`,
          priority: "due_soon",
          timeLabel: "In progress",
          icon: ClipboardList,
        });
      } else if (managerData.auditDoneToday) {
        list.push({
          id: "mgr-audit-today",
          title: "Today's Audit",
          subtitle: "Spot-check completed",
          href: "/audit",
          priority: "done",
          timeLabel: "Done",
          icon: ClipboardList,
        });
      } else {
        const isAfternoon = hour >= 14;
        list.push({
          id: "mgr-new-audit",
          title: "Create New Audit",
          subtitle: "Daily spot-check for your team",
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
        <RefreshCw className={`h-5 w-5 text-terracotta transition-transform ${refreshing ? "animate-spin" : ""} ${pullDistance >= PULL_THRESHOLD ? "text-terracotta scale-110" : "text-gray-400"}`} />
      </div>

      <div className="px-4 py-4">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            <img src="/images/celsius-logo-sm.jpg" alt="Celsius Coffee" width={40} height={40} className="rounded-lg" />
            <div className="flex-1">
              <h1 className="font-heading text-lg font-bold text-brand-dark">
                {greeting}, {user.name || "there"}
              </h1>
              <p className="text-sm text-gray-500">
                {user.outletName && <>{user.outletName} &middot; </>}{dateStr}
              </p>
            </div>
            <Link
              href="/profile"
              aria-label="Profile"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600 active:scale-95 active:bg-gray-200"
            >
              <User className="h-4 w-4" />
            </Link>
          </div>

          {/* Profile completeness reminder — shown until either the staff
              completes their profile or dismisses for the day. Lives at the
              very top of home so onboarding hires see it the moment they
              clock in for their first shift. */}
          {profileReminder?.show && (
            <Link
              href="/profile/personal"
              className="block rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"
            >
              <div className="flex items-start gap-2.5">
                <UserCircle2 className="h-5 w-5 shrink-0 text-amber-600" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-amber-900">
                    Complete your profile
                  </p>
                  <p className="text-[11px] text-amber-700">
                    HR needs your address, IC, and emergency contact for payslips and tax. Takes 2 minutes.
                  </p>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-amber-100">
                    <div
                      className="h-full bg-amber-500 transition-all"
                      style={{ width: `${profileReminder.percent}%` }}
                    />
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dismissProfileReminder();
                  }}
                  className="rounded-full p-1 text-amber-600 hover:bg-amber-100"
                  aria-label="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </Link>
          )}

          {/* Progress bar */}
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-sm font-semibold text-gray-900">Today&apos;s Tasks</p>
              <p className="text-xs font-bold text-gray-500">{doneCount}/{totalTasks} done</p>
            </div>
            <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${progressPct === 100 ? "bg-green-500" : progressPct >= 50 ? "bg-amber-400" : "bg-terracotta"}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* All done banner */}
          {pendingTasks.length === 0 && totalTasks > 0 && (
            <Card className="border-green-200 bg-green-50 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-100">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-green-700">All tasks done!</p>
                  <p className="text-xs text-green-500">{totalTasks} tasks completed today</p>
                </div>
              </div>
            </Card>
          )}

          {/* Task list grouped by priority */}
          {pendingTasks.length > 0 && (
            <div className="space-y-3">
              {(["overdue", "due_soon", "on_track"] as TaskPriority[]).map((priority) => {
                const group = grouped[priority];
                if (!group || group.length === 0) return null;
                const config = PRIORITY_CONFIG[priority];
                return (
                  <div key={priority}>
                    <h2 className={`mb-1.5 text-xs font-semibold uppercase tracking-wider ${config.color}`}>{config.label}</h2>
                    <div className="space-y-2">
                      {group.map((task) => {
                        const Icon = task.icon;
                        return (
                          <Link key={task.id} href={task.href}>
                            <Card className={`px-3 py-2.5 border-l-3 ${config.borderColor} transition-all hover:shadow-sm ${priority === "overdue" ? "bg-red-50/50" : ""}`}>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${priority === "overdue" ? "bg-red-100" : priority === "due_soon" ? "bg-amber-100" : "bg-gray-100"}`}>
                                    <Icon className={`h-4 w-4 ${config.iconColor}`} />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-gray-900 truncate">{task.title}</p>
                                    <div className="flex items-center gap-1.5">
                                      <span className={`text-[10px] ${priority === "overdue" ? "text-red-400" : priority === "due_soon" ? "text-amber-500" : "text-gray-400"}`}>{task.timeLabel}</span>
                                      {task.photoCount && (
                                        <>
                                          <span className="text-gray-300">·</span>
                                          <span className="text-[10px] text-gray-400">{task.photoCount} photos</span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                {task.progress !== undefined ? (
                                  <span className={`text-xs font-bold shrink-0 ${priority === "overdue" ? "text-red-500" : priority === "due_soon" ? "text-amber-600" : "text-gray-500"}`}>{task.progress}%</span>
                                ) : (
                                  <ArrowRight className="h-3.5 w-3.5 text-gray-300 shrink-0" />
                                )}
                              </div>
                            </Card>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Done section */}
          {doneTasks.length > 0 && (
            <div>
              <button onClick={() => setShowDone((v) => !v)} className="flex w-full items-center justify-between mb-1.5">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Done ({doneTasks.length})</h2>
                <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${showDone ? "rotate-180" : ""}`} />
              </button>
              {showDone && (
                <div className="space-y-1.5">
                  {doneTasks.map((task) => (
                    <Link key={task.id} href={task.href}>
                      <Card className="px-3 py-2 border-l-3 border-l-gray-200 opacity-60">
                        <div className="flex items-center gap-2.5">
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-400" />
                          <p className="text-sm text-gray-500 truncate line-through">{task.title}</p>
                          {task.photoCount && <span className="text-[10px] text-gray-400 shrink-0 ml-auto">{task.photoCount}</span>}
                        </div>
                      </Card>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Manager: Team compliance summary */}
          {managerData && managerData.teamChecklistsTotal > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-gray-900">Team Today</h2>
              <Link href="/audit">
                <Card className="px-4 py-3 transition-all active:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">Staff Checklists</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {managerData.teamChecklistsDone} of {managerData.teamChecklistsTotal} completed
                      </p>
                    </div>
                    <div className="text-right flex items-center gap-2">
                      <span className="text-lg font-bold text-gray-700">
                        {Math.round((managerData.teamChecklistsDone / managerData.teamChecklistsTotal) * 100)}%
                      </span>
                      <ArrowRight className="h-4 w-4 text-gray-300" />
                    </div>
                  </div>
                  <div className="mt-2 rounded-full bg-gray-100 h-1.5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-terracotta transition-all"
                      style={{ width: `${(managerData.teamChecklistsDone / managerData.teamChecklistsTotal) * 100}%` }}
                    />
                  </div>
                </Card>
              </Link>
            </div>
          )}

          {/* Manager: Recent audits */}
          {managerData && managerData.recentAudits.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-gray-900">Recent Audits</h2>
                <Link href="/audit/history" className="text-[11px] text-terracotta">View all →</Link>
              </div>
              <div className="space-y-1.5">
                {managerData.recentAudits.map((audit) => (
                  <Link key={audit.id} href={`/audit/${audit.id}`}>
                    <Card className="px-3 py-2 transition-all active:bg-gray-50">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-100">
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{audit.template}</p>
                          <p className="text-[10px] text-gray-400">
                            {audit.auditor} · {formatTimeAgo(audit.completedAt)}
                          </p>
                        </div>
                        {audit.score !== null && (
                          <span className={`text-xs font-bold shrink-0 ${
                            audit.score >= 80 ? "text-green-600" : audit.score >= 60 ? "text-yellow-600" : "text-red-600"
                          }`}>
                            {Math.round(audit.score)}%
                          </span>
                        )}
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Quick actions — filtered by user's moduleAccess */}
          {showQuickActions && (() => {
            const allActions = [
              { href: "/stock-count", icon: ClipboardCheck, label: "Count", moduleKey: "inventory:stock-count" },
              { href: "/receiving", icon: Package, label: "Receive", moduleKey: "inventory:receivings" },
              { href: "/wastage", icon: Trash2, label: "Wastage", moduleKey: "inventory:wastage" },
              { href: "/transfers", icon: ArrowLeftRight, label: "Transfer", moduleKey: "inventory:transfers" },
              { href: "/claims", icon: Receipt, label: "Claim", moduleKey: "inventory:pay-and-claim" },
            ];
            const visibleActions = allActions.filter((a) => hasAccess(user.role, user.moduleAccess, a.moduleKey));
            if (visibleActions.length === 0) return null;
            const gridCls = visibleActions.length >= 5 ? "grid-cols-5"
              : visibleActions.length === 4 ? "grid-cols-4"
              : visibleActions.length === 3 ? "grid-cols-3"
              : visibleActions.length === 2 ? "grid-cols-2"
              : "grid-cols-1";
            return (
              <div>
                <h2 className="mb-2 text-sm font-semibold text-gray-900">Quick Actions</h2>
                <div className={`grid gap-2 ${gridCls}`}>
                  {visibleActions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <Link
                        key={action.label}
                        href={action.href}
                        className="flex flex-col items-center gap-1 rounded-xl border border-gray-200 bg-white py-3 text-gray-600 transition-colors hover:bg-terracotta/5 hover:text-terracotta"
                      >
                        <Icon className="h-5 w-5" />
                        <span className="text-[10px] font-medium">{action.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Who's away today (and tomorrow) — quick visibility for the
              shift, especially handy for kitchen/floor leads planning
              coverage on the fly. Only renders when there's actually
              someone on leave. */}
          {whosAway && (whosAway.today.length > 0 || whosAway.tomorrow.length > 0) && (
            <div className="rounded-xl border bg-white px-4 py-3">
              <div className="mb-2 flex items-center gap-2">
                <CalendarOff className="h-4 w-4 text-amber-600" />
                <p className="text-sm font-semibold text-gray-900">Who&apos;s away</p>
              </div>
              {whosAway.today.length > 0 && (
                <div className="mb-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Today</p>
                  <div className="flex flex-wrap gap-1.5">
                    {whosAway.today.map((p) => (
                      <span
                        key={`today-${p.user_id}`}
                        title={`${p.leave_type.replace(/_/g, " ")} · ${p.start_date} → ${p.end_date}${p.outlet ? ` · ${p.outlet}` : ""}`}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800"
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-200 text-[9px] font-semibold text-amber-900">
                          {p.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                        </span>
                        {p.name.split(" ")[0]}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {whosAway.tomorrow.length > 0 && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Tomorrow</p>
                  <div className="flex flex-wrap gap-1.5">
                    {whosAway.tomorrow.map((p) => (
                      <span
                        key={`tomorrow-${p.user_id}`}
                        title={`${p.leave_type.replace(/_/g, " ")} · ${p.start_date} → ${p.end_date}${p.outlet ? ` · ${p.outlet}` : ""}`}
                        className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700"
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gray-300 text-[9px] font-semibold text-gray-700">
                          {p.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                        </span>
                        {p.name.split(" ")[0]}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
