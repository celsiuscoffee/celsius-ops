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
  ArrowLeftRight,
  ArrowRight,
  Camera,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Package,
  Receipt,
  Settings,
  Trash2,
} from "lucide-react-native";
import * as Updates from "expo-updates";
import { Screen } from "../../components/Screen";
import { listChecklists, type ChecklistSummary } from "../../lib/ops/checklists";
import { getClockStatus, type ClockStatus } from "../../lib/hr/clock";
import { useStaff } from "../../lib/store";
import { ApiError } from "../../lib/api";

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
  const router = useRouter();
  const session = useStaff((s) => s.session);
  const [checklists, setChecklists] = useState<ChecklistSummary[]>([]);
  const [clock, setClock] = useState<ClockStatus | null>(null);
  const [elapsed, setElapsed] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const today = todayString();

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [cls, cs] = await Promise.all([
          session?.outletId
            ? listChecklists({ date: today, outletId: session.outletId }).catch(
                () => [],
              )
            : Promise.resolve<ChecklistSummary[]>([]),
          getClockStatus().catch(() => null),
        ]);
        setChecklists(cls);
        setClock(cs);
      } finally {
        setLoading(false);
      }
    },
    [session?.outletId, today],
  );

  useFocusEffect(
    useCallback(() => {
      load(true);
    }, [load]),
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
            ago < 60 ? `${ago}m overdue` : `${Math.floor(ago / 60)}h overdue`;
        } else if (diffMin <= 30) {
          priority = "due_soon";
          timeLabel = `${diffMin}m left`;
        } else {
          timeLabel = cl.timeSlot
            ? `Due ${cl.timeSlot}`
            : diffMin < 120
              ? `${diffMin}m left`
              : `${Math.floor(diffMin / 60)}h left`;
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
  const clockedSince = clock?.activeLog
    ? new Date(clock.activeLog.clock_in).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <Screen>
      {/* Frozen header — sits OUTSIDE the ScrollView so the avatar +
          gear icon stay tappable while you scroll the task list. */}
      <View className="flex-row items-center gap-3 pt-3 pb-3">
        <Pressable
          onPress={() => router.push("/(staff)/profile")}
          accessibilityRole="button"
          accessibilityLabel="Open profile"
          hitSlop={8}
          className="flex-1 flex-row items-center gap-3 active:opacity-80"
        >
          <View className="h-10 w-10 items-center justify-center rounded-2xl bg-primary-50">
            <Text className="text-base font-display text-primary">
              {session?.name?.charAt(0)?.toUpperCase() ?? "?"}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="text-base font-display text-espresso">
              {greeting()}, {firstName(session?.name)}
            </Text>
            <Text className="text-xs font-body text-muted-fg">
              {session?.outletName ? `${session.outletName} · ` : ""}
              {dateLabel()}
              {Updates.updateId
                ? ` · build ${Updates.updateId.slice(0, 8)}`
                : ""}
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={() => router.push("/(staff)/profile")}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={10}
          className="h-10 w-10 items-center justify-center rounded-2xl bg-primary-50 active:opacity-80"
        >
          <Settings color="#A2492C" size={20} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="pb-12"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#A2492C"
            colors={["#A2492C"]}
          />
        }
      >
        {/* Clock card — biggest CTA on the page (matches web behavior). */}
        {session?.outletId ? (
          <Pressable
            onPress={() => router.push("/(staff)/clock")}
            className={`mt-4 rounded-3xl border-2 px-4 py-4 active:opacity-90 ${
              isClockedIn
                ? "border-success/40 bg-success/5"
                : "border-primary bg-primary"
            }`}
          >
            <View className="flex-row items-center gap-3">
              <View
                className={`h-12 w-12 items-center justify-center rounded-2xl ${
                  isClockedIn ? "bg-success/10" : "bg-white/20"
                }`}
              >
                <Clock
                  color={isClockedIn ? "#15803D" : "#FFFFFF"}
                  size={24}
                />
              </View>
              <View className="flex-1">
                {isClockedIn ? (
                  <>
                    <Text className="text-[10px] font-body-bold uppercase tracking-wide text-success">
                      Clocked in · {clockedSince}
                    </Text>
                    <Text className="mt-0.5 text-xl font-display text-success tabular-nums">
                      {elapsed || "—"}
                    </Text>
                    <Text className="text-xs font-body text-success/80">
                      Tap to clock out
                    </Text>
                  </>
                ) : (
                  <>
                    <Text className="text-[10px] font-body-bold uppercase tracking-wide text-white/80">
                      Not clocked in
                    </Text>
                    <Text className="mt-0.5 text-xl font-display text-white">
                      Clock in
                    </Text>
                    <Text className="text-xs font-body text-white/80">
                      GPS + biometric · 5 seconds
                    </Text>
                  </>
                )}
              </View>
              <ArrowRight
                color={isClockedIn ? "#15803D" : "#FFFFFF"}
                size={20}
              />
            </View>
          </Pressable>
        ) : null}

        {/* Progress card */}
        {totalCount > 0 ? (
          <View className="mt-4 rounded-3xl border border-border bg-surface px-4 py-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-body-semi text-espresso">
                Today's tasks
              </Text>
              <Text className="text-xs font-body-bold text-muted-fg">
                {doneCount}/{totalCount} done
              </Text>
            </View>
            <View className="mt-2 h-2 overflow-hidden rounded-full bg-primary-50">
              <View
                className={`h-full rounded-full ${
                  pct === 100
                    ? "bg-success"
                    : pct >= 50
                      ? "bg-amber-500"
                      : "bg-primary"
                }`}
                style={{ width: `${pct}%` }}
              />
            </View>
          </View>
        ) : null}

        {/* All-done banner */}
        {totalCount > 0 && pending.length === 0 ? (
          <View className="mt-4 flex-row items-center gap-3 rounded-3xl border border-success/30 bg-success/5 p-4">
            <View className="h-10 w-10 items-center justify-center rounded-2xl bg-success/10">
              <CheckCircle2 color="#15803D" size={20} />
            </View>
            <View>
              <Text className="text-sm font-body-semi text-success">
                All tasks done!
              </Text>
              <Text className="text-xs font-body text-success/80">
                {totalCount} tasks completed today
              </Text>
            </View>
          </View>
        ) : null}

        {/* Loading skeleton */}
        {loading && totalCount === 0 ? (
          <View className="mt-4 items-center justify-center py-8">
            <ActivityIndicator color="#A2492C" />
          </View>
        ) : null}

        {/* Task groups */}
        {(["overdue", "due_soon", "on_track"] as TaskPriority[]).map(
          (priority) => {
            const group = grouped[priority];
            if (!group || group.length === 0) return null;
            return (
              <View key={priority} className="mt-4">
                <Text
                  className={`mb-2 text-[10px] font-body-bold uppercase tracking-wide ${groupColor(priority)}`}
                >
                  {PRIORITY_COPY[priority]}
                </Text>
                <View className="gap-2">
                  {group.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onPress={() => router.push(task.href)}
                    />
                  ))}
                </View>
              </View>
            );
          },
        )}

        {/* Done collapsible */}
        {done.length > 0 ? (
          <View className="mt-4">
            <Pressable
              onPress={() => setShowDone((v) => !v)}
              className="flex-row items-center justify-between py-1.5"
            >
              <Text className="text-[10px] font-body-bold uppercase tracking-wide text-muted">
                Done ({done.length})
              </Text>
              <ChevronDown
                color="#6B6B6B"
                size={14}
                style={{
                  transform: [{ rotate: showDone ? "180deg" : "0deg" }],
                }}
              />
            </Pressable>
            {showDone ? (
              <View className="gap-1.5">
                {done.map((task) => (
                  <Pressable
                    key={task.id}
                    onPress={() => router.push(task.href)}
                    className="flex-row items-center gap-2.5 rounded-2xl border border-border bg-surface px-3 py-2 opacity-70"
                  >
                    <CheckCircle2 color="#15803D" size={16} />
                    <Text
                      className="flex-1 text-sm font-body text-muted-fg line-through"
                      numberOfLines={1}
                    >
                      {task.title}
                    </Text>
                    {task.photoCount ? (
                      <Text className="text-[10px] font-body text-muted">
                        {task.photoCount}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Quick actions */}
        <View className="mt-6">
          <Text className="mb-2 text-sm font-body-semi text-espresso">
            Quick actions
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <QuickAction
              icon={ClipboardCheck}
              label="Count"
              onPress={() => router.push("/stock-count")}
            />
            <QuickAction
              icon={Package}
              label="Receive"
              onPress={() => router.push("/receiving")}
            />
            <QuickAction
              icon={Trash2}
              label="Wastage"
              onPress={() => router.push("/wastage")}
            />
            <QuickAction
              icon={ArrowLeftRight}
              label="Transfer"
              onPress={() => router.push("/transfers")}
            />
            <QuickAction
              icon={Receipt}
              label="Claim"
              onPress={() => router.push("/(staff)/claims/new")}
            />
          </View>
        </View>

        {/* Inventory + audits hub entry */}
        <View className="mt-6 gap-2">
          <Pressable
            onPress={() => router.push("/checklists")}
            className="flex-row items-center gap-3 rounded-3xl border border-border bg-surface p-4 active:bg-primary-50"
          >
            <View className="h-10 w-10 items-center justify-center rounded-2xl bg-primary-50">
              <ClipboardCheck color="#A2492C" size={20} />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-body-semi text-espresso">
                Checklists
              </Text>
              <Text className="text-xs font-body text-muted-fg">
                Today's SOPs to complete
              </Text>
            </View>
            <ArrowRight color="#9CA3AF" size={16} />
          </Pressable>
          <Pressable
            onPress={() => router.push("/audit")}
            className="flex-row items-center gap-3 rounded-3xl border border-border bg-surface p-4 active:bg-primary-50"
          >
            <View className="h-10 w-10 items-center justify-center rounded-2xl bg-primary-50">
              <ClipboardList color="#A2492C" size={20} />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-body-semi text-espresso">
                Audits
              </Text>
              <Text className="text-xs font-body text-muted-fg">
                Spot checks & quality audits
              </Text>
            </View>
            <ArrowRight color="#9CA3AF" size={16} />
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

function TaskCard({
  task,
  onPress,
}: {
  task: UnifiedTask;
  onPress: () => void;
}) {
  const isOverdue = task.priority === "overdue";
  const isDueSoon = task.priority === "due_soon";
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-3xl border bg-surface px-3 py-2.5 active:opacity-90 ${
        isOverdue
          ? "border-danger/20 bg-danger/5"
          : isDueSoon
            ? "border-amber-500/30 bg-amber-50/40"
            : "border-border"
      }`}
    >
      <View className="flex-row items-center gap-2.5">
        <View
          className={`h-8 w-8 items-center justify-center rounded-xl ${
            isOverdue
              ? "bg-danger/10"
              : isDueSoon
                ? "bg-amber-500/10"
                : "bg-primary-50"
          }`}
        >
          {isOverdue ? (
            <AlertCircle color="#B91C1C" size={16} />
          ) : (
            <Camera
              color={isDueSoon ? "#F59E0B" : "#A2492C"}
              size={16}
            />
          )}
        </View>
        <View className="flex-1">
          <Text
            className="text-sm font-body-medium text-espresso"
            numberOfLines={1}
          >
            {task.title}
          </Text>
          <View className="flex-row items-center gap-1.5">
            <Text
              className={`text-[10px] font-body ${
                isOverdue
                  ? "text-danger/70"
                  : isDueSoon
                    ? "text-amber-700"
                    : "text-muted"
              }`}
            >
              {task.timeLabel}
            </Text>
            {task.photoCount ? (
              <>
                <Text className="text-[10px] text-muted">·</Text>
                <Text className="text-[10px] font-body text-muted">
                  {task.photoCount} photos
                </Text>
              </>
            ) : null}
          </View>
        </View>
        {task.progress !== undefined ? (
          <Text
            className={`text-xs font-body-bold ${
              isOverdue ? "text-danger" : isDueSoon ? "text-amber-700" : "text-muted"
            }`}
          >
            {task.progress}%
          </Text>
        ) : (
          <ArrowRight color="#D1D5DB" size={14} />
        )}
      </View>
    </Pressable>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onPress,
}: {
  icon: React.ComponentType<{ color?: string; size?: number }>;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="w-[18%] min-w-16 flex-grow basis-[18%] items-center gap-1 rounded-2xl border border-border bg-surface py-3 active:bg-primary-50"
    >
      <Icon color="#4A4A4A" size={20} />
      <Text className="text-[10px] font-body-semi text-muted-fg">{label}</Text>
    </Pressable>
  );
}

function groupColor(p: TaskPriority): string {
  if (p === "overdue") return "text-danger";
  if (p === "due_soon") return "text-amber-700";
  return "text-muted";
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
