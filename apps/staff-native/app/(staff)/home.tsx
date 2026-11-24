import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  AlertCircle,
  ArrowRight,
  Camera,
  CheckCircle2,
  ChevronDown,
  Clock,
  Inbox,
} from "lucide-react-native";
import { Screen } from "../../components/Screen";
import { List, ListRow } from "../../components/ui";
import { approvalsCount, approvalsSummary } from "../../lib/hr/approvals";
import { useApprovals } from "../../lib/hr/use-approvals";
import { listChecklists, type ChecklistSummary } from "../../lib/ops/checklists";
import { getClockStatus, type ClockStatus } from "../../lib/hr/clock";
import { fetchShifts, type Shift } from "../../lib/hr/api";
import { pickTodayShift, shiftLine } from "../../lib/hr/shift-card";
import { useStaff } from "../../lib/store";
import SalesScreen from "./sales";
import { clock12, hm12, useCelsius } from "../../lib/celsius-ui";

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
};

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  overdue: 0,
  due_soon: 1,
  on_track: 2,
  done: 3,
};

const PRIORITY_COPY: Record<TaskPriority, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  on_track: "To do",
  done: "Done",
};

export default function Home() {
  const role = useStaff((s) => s.session?.role);
  // Owners/admins don't run floor ops, their Home IS the Sales dashboard.
  if (role === "OWNER" || role === "ADMIN") return <SalesScreen />;
  return <StaffHome />;
}

function StaffHome() {
  const C = useCelsius().color;
  const router = useRouter();
  const session = useStaff((s) => s.session);
  const [checklists, setChecklists] = useState<ChecklistSummary[]>([]);
  const [clock, setClock] = useState<ClockStatus | null>(null);
  // Today's rostered shift for the clock card (null = none rostered today).
  const [todayShift, setTodayShift] = useState<Shift | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showDone, setShowDone] = useState(false);
  // Off (no request) for anyone who is not a manager.
  const approvals = useApprovals();
  const approvalsTotal = approvals.data ? approvalsCount(approvals.data) : 0;

  const today = todayString();

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [cls, cs, sh] = await Promise.all([
          session?.outletId
            ? listChecklists({ date: today, outletId: session.outletId }).catch(
                () => [],
              )
            : Promise.resolve<ChecklistSummary[]>([]),
          getClockStatus().catch(() => null),
          fetchShifts().catch(() => null),
        ]);
        setChecklists(cls);
        setClock(cs);
        setTodayShift(pickTodayShift(sh?.shifts, today));
        setNowMs(Date.now());
      } finally {
        setLoading(false);
      }
    },
    [session?.outletId, today],
  );

  const { enabled: approvalsOn, refetch: refetchApprovals } = approvals;
  useFocusEffect(
    useCallback(() => {
      load(true);
      if (approvalsOn) refetchApprovals();
    }, [load, approvalsOn, refetchApprovals]),
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!clock?.activeLog) {
      setElapsed("");
      return;
    }
    const startMs = new Date(clock.activeLog.clock_in).getTime();
    const tick = () => {
      const diff = Date.now() - startMs;
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1000);
      setElapsed(`${h}h ${pad(m)}m ${pad(s)}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [clock?.activeLog]);

  // Keep "Starts in 12 min" current while the screen is open.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const tasks = useMemo<UnifiedTask[]>(() => {
    const now = Date.now();
    const list: UnifiedTask[] = checklists.map((cl) => {
      let priority: TaskPriority = "on_track";
      let timeLabel = "";

      if (cl.status === "COMPLETED") {
        priority = "done";
        timeLabel = "Completed";
      } else if (cl.dueAt) {
        const due = new Date(cl.dueAt).getTime();
        const diffMin = Math.floor((due - now) / 60_000);
        if (diffMin < 0) {
          priority = "overdue";
          const ago = Math.abs(diffMin);
          timeLabel =
            ago < 60 ? `${ago} min overdue` : `${Math.floor(ago / 60)} h overdue`;
        } else if (diffMin <= 30) {
          priority = "due_soon";
          timeLabel = `${diffMin} min left`;
        } else {
          timeLabel = cl.timeSlot
            ? `Due ${hm12(cl.timeSlot)}`
            : diffMin < 120
              ? `${diffMin} min left`
              : `${Math.floor(diffMin / 60)} h left`;
        }
      }

      return {
        id: `sop-${cl.id}`,
        title: cl.sop.title,
        subtitle: cl.sop.category.name,
        href: `/checklists/${cl.id}`,
        priority,
        progress: cl.progress,
        photoCount: `${cl.completedItems}/${cl.totalItems}`,
        timeLabel,
      };
    });
    list.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    return list;
  }, [checklists]);

  const pending = tasks.filter((t) => t.priority !== "done");
  const done = tasks.filter((t) => t.priority === "done");
  const doneCount = done.length;
  const totalCount = tasks.length;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  const grouped = useMemo(() => {
    const g: Partial<Record<TaskPriority, UnifiedTask[]>> = {};
    for (const t of pending) {
      if (!g[t.priority]) g[t.priority] = [];
      g[t.priority]!.push(t);
    }
    return g;
  }, [pending]);

  const isClockedIn = !!clock?.activeLog;
  const shiftInfo = todayShift ? shiftLine(todayShift, nowMs, isClockedIn) : null;
  const clockedSince = clock?.activeLog ? clock12(clock.activeLog.clock_in) : null;

  return (
    // edges without "bottom": the tab bar is opaque + in-flow, so a bottom
    // safe-area inset would clip the scroll ~34px above the tab bar.
    <Screen edges={["top", "left", "right"]}>
      {/* Frozen header: who and where. Tapping it opens Profile; everything
          else personal (shifts, pay, scoreboard) is on the Me tab. */}
      <Pressable
        onPress={() => router.push("/(staff)/profile")}
        accessibilityRole="button"
        accessibilityLabel="Open profile and settings"
        className="flex-row items-center gap-3 pt-2 pb-3 active:opacity-80"
      >
        <View className="h-11 w-11 items-center justify-center rounded-full bg-sunken">
          <Text className="text-base font-display text-text">
            {session?.name?.charAt(0)?.toUpperCase() ?? "?"}
          </Text>
        </View>
        <View className="flex-1">
          <Text accessibilityRole="header" className="text-2xl font-display text-text" numberOfLines={1}>
            {greeting()}, {firstName(session?.name)}
          </Text>
          <Text className="text-sm font-body text-text-2" numberOfLines={1}>
            {session?.outletName ? `${session.outletName} · ` : ""}
            {dateLabel()}
          </Text>
        </View>
      </Pressable>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="pb-6"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C["text-3"]}
            colors={[C["text-2"]]}
          />
        }
      >
        {/* Clock card: the screen's main action. */}
        {session?.outletId ? (
          <Pressable
            onPress={() => router.push("/(staff)/clock")}
            accessibilityRole="button"
            accessibilityLabel={isClockedIn ? "Clock out" : "Clock in"}
            className={`mt-2 rounded-2xl px-4 py-4 active:opacity-90 ${
              isClockedIn ? "border border-ok bg-ok-soft" : "bg-ink"
            }`}
          >
            <View className="flex-row items-center gap-3">
              <View
                className={`h-12 w-12 items-center justify-center rounded-xl ${
                  isClockedIn ? "bg-surface" : "bg-ink-hover"
                }`}
              >
                <Clock color={isClockedIn ? C["ok-text"] : C["on-ink"]} size={24} />
              </View>
              <View className="flex-1">
                {isClockedIn ? (
                  <>
                    <Text className="text-sm font-body-semi text-ok-text">
                      Clocked in at {clockedSince}
                    </Text>
                    <Text className="mt-0.5 text-xl font-display text-ok-text" style={{ fontVariant: ["tabular-nums"] }}>
                      {elapsed || "-"}
                    </Text>
                    <Text className="text-sm font-body text-ok-text">
                      {shiftInfo ? `${shiftInfo.hint} · tap to clock out` : "Tap to clock out"}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text className="text-sm font-body-semi text-on-ink" numberOfLines={2}>
                      {shiftInfo
                        ? `Your shift · ${shiftInfo.times}${todayShift?.outlet_name ? ` · ${todayShift.outlet_name}` : ""}`
                        : "No shift rostered today"}
                    </Text>
                    <Text className="mt-0.5 text-xl font-display text-on-ink">Clock in</Text>
                    <Text className="text-sm font-body text-on-ink">
                      {shiftInfo ? `${shiftInfo.hint} · selfie and location` : "Selfie and location, about 5 seconds"}
                    </Text>
                  </>
                )}
              </View>
              <ArrowRight color={isClockedIn ? C["ok-text"] : C["on-ink"]} size={20} />
            </View>
          </Pressable>
        ) : null}

        {/* Managers: approvals waiting on them, only when there are some, so
            part-timer hours get signed off during the shift (owner, 20 Nov 2026). */}
        {approvalsTotal > 0 && approvals.data ? (
          <View className="mt-4">
            <List>
              <ListRow
                icon={Inbox}
                tone="warn"
                title={`${approvalsTotal} to approve`}
                meta={approvalsSummary(approvals.data)}
                onPress={() => router.push("/(staff)/hr/approvals")}
              />
            </List>
          </View>
        ) : null}

        {/* Today's tasks: progress, then what is late, due soon, to do. */}
        {totalCount > 0 ? (
          <View className="mt-4 rounded-2xl border border-line bg-surface px-4 py-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-body-semi text-text">Today's tasks</Text>
              <Text className="text-sm font-body-semi text-text-2" style={{ fontVariant: ["tabular-nums"] }}>
                {doneCount} of {totalCount} done
              </Text>
            </View>
            <View className="mt-2 h-2 overflow-hidden rounded-full bg-sunken">
              <View
                className={`h-full rounded-full ${pct === 100 ? "bg-ok" : "bg-ink"}`}
                style={{ width: `${pct}%` }}
              />
            </View>
          </View>
        ) : null}

        {totalCount > 0 && pending.length === 0 ? (
          <View className="mt-4 flex-row items-center gap-3 rounded-2xl border border-ok bg-ok-soft p-4">
            <CheckCircle2 color={C["ok-text"]} size={22} />
            <View className="flex-1">
              <Text className="text-base font-body-semi text-ok-text">All tasks done</Text>
              <Text className="text-sm font-body text-ok-text">
                {totalCount} {totalCount === 1 ? "task" : "tasks"} completed today
              </Text>
            </View>
          </View>
        ) : null}

        {loading && totalCount === 0 ? (
          <View className="mt-4 items-center justify-center py-8">
            <ActivityIndicator color={C["text-3"]} />
          </View>
        ) : null}

        {!loading && totalCount === 0 && session?.outletId ? (
          <View className="mt-4 rounded-2xl border border-line bg-surface p-4">
            <Text className="text-base font-body-semi text-text">No tasks today</Text>
            <Text className="mt-0.5 text-sm font-body text-text-2">
              Checklists scheduled for {session?.outletName ?? "your outlet"} show here.
            </Text>
          </View>
        ) : null}

        {(["overdue", "due_soon", "on_track"] as TaskPriority[]).map((priority) => {
          const group = grouped[priority];
          if (!group || group.length === 0) return null;
          return (
            <View key={priority} className="mt-5">
              <Text accessibilityRole="header" className={`mb-2 text-sm font-body-semi ${groupColor(priority)}`}>
                {PRIORITY_COPY[priority]} · {group.length}
              </Text>
              <View className="gap-2">
                {group.map((task) => (
                  <TaskCard key={task.id} task={task} onPress={() => router.push(task.href)} />
                ))}
              </View>
            </View>
          );
        })}

        {done.length > 0 ? (
          <View className="mt-5">
            <Pressable
              onPress={() => setShowDone((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showDone }}
              className="min-h-11 flex-row items-center justify-between"
            >
              <Text className="text-sm font-body-semi text-text-2">Done · {done.length}</Text>
              <ChevronDown
                color={C["text-2"]}
                size={18}
                style={{ transform: [{ rotate: showDone ? "180deg" : "0deg" }] }}
              />
            </Pressable>
            {showDone ? (
              <View className="gap-1.5">
                {done.map((task) => (
                  <Pressable
                    key={task.id}
                    onPress={() => router.push(task.href)}
                    accessibilityRole="button"
                    className="min-h-11 flex-row items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 active:bg-sunken"
                  >
                    <CheckCircle2 color={C["ok-text"]} size={16} />
                    <Text className="flex-1 text-sm font-body text-text-2" numberOfLines={1}>
                      {task.title}
                    </Text>
                    {task.photoCount ? (
                      <Text className="text-xs font-body text-text-3">{task.photoCount}</Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function TaskCard({ task, onPress }: { task: UnifiedTask; onPress: () => void }) {
  const C = useCelsius().color;
  const isOverdue = task.priority === "overdue";
  const isDueSoon = task.priority === "due_soon";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${task.title}, ${task.timeLabel ?? ""}`}
      className={`min-h-[60px] flex-row items-center gap-3 rounded-2xl border px-3 py-2.5 active:bg-sunken ${
        isOverdue ? "border-danger bg-surface" : isDueSoon ? "border-warn bg-surface" : "border-line bg-surface"
      }`}
    >
      <View
        className={`h-10 w-10 items-center justify-center rounded-xl ${
          isOverdue ? "bg-danger-soft" : isDueSoon ? "bg-warn-soft" : "bg-sunken"
        }`}
      >
        {isOverdue ? (
          <AlertCircle color={C["danger-text"]} size={18} />
        ) : (
          <Camera color={isDueSoon ? C["warn-text"] : C["text-2"]} size={18} />
        )}
      </View>
      <View className="flex-1">
        <Text className="text-base font-body-medium text-text" numberOfLines={1}>
          {task.title}
        </Text>
        <Text
          className={`text-sm font-body ${
            isOverdue ? "text-danger-text" : isDueSoon ? "text-warn-text" : "text-text-3"
          }`}
          numberOfLines={1}
        >
          {task.timeLabel}
          {task.photoCount ? ` · ${task.photoCount} photos` : ""}
        </Text>
      </View>
      {task.progress !== undefined ? (
        <Text
          className={`text-sm font-body-semi ${
            isOverdue ? "text-danger-text" : isDueSoon ? "text-warn-text" : "text-text-2"
          }`}
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {task.progress}%
        </Text>
      ) : (
        <ArrowRight color={C["text-3"]} size={16} />
      )}
    </Pressable>
  );
}

function groupColor(p: TaskPriority): string {
  if (p === "overdue") return "text-danger-text";
  if (p === "due_soon") return "text-warn-text";
  return "text-text-2";
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function firstName(name?: string | null): string {
  if (!name) return "there";
  return name.split(" ")[0];
}

function dateLabel(): string {
  return new Date().toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function todayString(): string {
  // Malaysia time
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return d.toISOString().split("T")[0];
}
