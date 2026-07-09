import { useCallback, useEffect, useState } from "react";
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
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  ListChecks,
  Plane,
  Star,
  Target,
  Wallet,
} from "lucide-react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import {
  fetchAllowances,
  fetchMyReviews,
  type AllowanceBreakdown,
  type AllowanceLever,
} from "../../../lib/hr/api";
import { getClockStatus, type ClockStatus } from "../../../lib/hr/clock";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const items = [
  {
    href: "/(staff)/hr/shifts",
    title: "My Shifts",
    subtitle: "Today and upcoming",
    icon: Calendar,
  },
  {
    href: "/(staff)/hr/attendance",
    title: "Attendance",
    subtitle: "Clock-in history + overtime",
    icon: Clock,
  },
  {
    href: "/(staff)/hr/leave",
    title: "Leave",
    subtitle: "Balances and requests",
    icon: Plane,
  },
  {
    href: "/(staff)/hr/payslips",
    title: "Payslips",
    subtitle: "Monthly pay history",
    icon: FileText,
  },
  {
    href: "/(staff)/hr/memos",
    title: "Memos",
    subtitle: "Notices from HR",
    icon: ListChecks,
  },
  {
    href: "/(staff)/hr/reviews",
    title: "Feedback",
    subtitle: "Reviews during your shifts",
    icon: Star,
  },
  {
    href: "/(staff)/hr/my-skills",
    title: "My Skills",
    subtitle: "Audit scores & progress",
    icon: Target,
  },
] as const;

export default function HrIndex() {
  const router = useRouter();
  const [clock, setClock] = useState<ClockStatus | null>(null);
  const [allowance, setAllowance] = useState<AllowanceBreakdown | null>(null);
  const [reviewsCount, setReviewsCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [c, a, r] = await Promise.all([
        getClockStatus().catch(() => null),
        fetchAllowances()
          .then((x) => x.breakdown)
          .catch(() => null),
        fetchMyReviews()
          .then((x) => x.count)
          .catch(() => 0),
      ]);
      setClock(c);
      setAllowance(a);
      setReviewsCount(r);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const isClockedIn = !!clock?.activeLog;
  const clockedSince = clock?.activeLog
    ? new Date(clock.activeLog.clock_in).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <Screen>
      <PageHeader title="HR" />
      <ScrollView
        contentContainerClassName="pb-24"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor="#A2492C"
          />
        }
      showsVerticalScrollIndicator={false}
    >

        {/* Clock card */}
        <Pressable
          onPress={() => router.push("/(staff)/clock")}
          className={`mt-5 flex-row items-center gap-3 rounded-3xl border p-4 active:opacity-90 ${
            isClockedIn
              ? "border-success/30 bg-success/5"
              : "border-border bg-surface"
          }`}
        >
          <View
            className={`h-12 w-12 items-center justify-center rounded-2xl ${
              isClockedIn ? "bg-success/10" : "bg-primary-50"
            }`}
          >
            <Clock
              color={isClockedIn ? "#15803D" : "#A2492C"}
              size={22}
            />
          </View>
          <View className="flex-1">
            <Text className="text-base font-body-semi text-espresso">
              {isClockedIn ? "On shift" : "Off shift"}
            </Text>
            <Text className="text-sm font-body text-muted-fg">
              {isClockedIn
                ? `Clocked in at ${clockedSince}`
                : "Tap to clock in"}
            </Text>
          </View>
          {isClockedIn ? <CheckCircle2 color="#15803D" size={20} /> : null}
        </Pressable>

        {/* Performance allowance (v2: one pool split across KPI levers, minus
            deductions). Decoupled from the clock fetch so a clock hiccup can't
            hide it. */}
        {allowance?.eligible ? (
          <View className="mt-5 rounded-3xl border border-primary/30 bg-primary-50/30 p-4">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <View className="h-10 w-10 items-center justify-center rounded-2xl bg-primary-50">
                  <Wallet color="#A2492C" size={18} />
                </View>
                <View>
                  <Text className="text-base font-body-semi text-espresso">
                    {MONTHS[allowance.period.month - 1]} allowance
                  </Text>
                  <Text className="text-xs font-body text-muted">
                    {allowance.period.daysRemaining} day
                    {allowance.period.daysRemaining !== 1 ? "s" : ""} left
                  </Text>
                </View>
              </View>
              <View className="items-end">
                <Text className="text-2xl font-display text-primary">
                  RM {Number(allowance.totalEarned ?? 0).toFixed(2)}
                </Text>
                <Text className="text-xs font-body text-muted">
                  of RM {Number(allowance.totalMax ?? 0).toFixed(2)}
                </Text>
              </View>
            </View>

            {(allowance.levers ?? [])
              .filter((l) => l.applicable)
              .map((lever) => (
                <LeverBar key={lever.key} lever={lever} />
              ))}

            {(allowance.attendance?.total ?? 0) > 0 ||
            (allowance.reviewPenalty?.total ?? 0) > 0 ? (
              <View className="mt-3 flex-row items-center justify-between rounded-2xl bg-surface px-3 py-2.5">
                <View>
                  <Text className="text-sm font-body-semi text-espresso">
                    Deductions
                  </Text>
                  <Text className="text-xs font-body text-muted">
                    {allowance.attendance?.lateCount ?? 0} late ·{" "}
                    {allowance.attendance?.absentCount ?? 0} absent
                    {(allowance.reviewPenalty?.entries?.length ?? 0) > 0
                      ? ` · ${allowance.reviewPenalty.entries.length} review`
                      : ""}
                  </Text>
                </View>
                <Text className="text-base font-body-bold text-danger">
                  - RM{" "}
                  {Number(
                    (allowance.attendance?.total ?? 0) +
                      (allowance.reviewPenalty?.total ?? 0),
                  ).toFixed(2)}
                </Text>
              </View>
            ) : null}

            {allowance.tip ? (
              <Text className="mt-3 text-xs font-body text-muted-fg">
                {allowance.tip}
              </Text>
            ) : null}
          </View>
        ) : allowance ? (
          <View className="mt-5 flex-row items-center gap-2 rounded-3xl border border-border bg-surface p-4">
            <Wallet color="#9CA3AF" size={18} />
            <Text className="flex-1 text-sm font-body text-muted-fg">
              The performance allowance is for full-time staff.
            </Text>
          </View>
        ) : loading ? (
          <View className="mt-5 items-center py-3">
            <ActivityIndicator color="#A2492C" />
          </View>
        ) : null}

        {/* Quick links */}
        <View className="mt-6 gap-2">
          {items.map((it) => {
            const Icon = it.icon;
            const subtitle =
              it.href === "/(staff)/hr/reviews" && reviewsCount > 0
                ? `${reviewsCount} review${reviewsCount === 1 ? "" : "s"} during your shifts`
                : it.subtitle;
            return (
              <Pressable
                key={it.href}
                onPress={() => router.push(it.href)}
                className="flex-row items-center gap-3 rounded-3xl border border-border bg-surface p-4 active:bg-primary-50"
              >
                <View className="h-12 w-12 items-center justify-center rounded-2xl bg-primary-50">
                  <Icon color="#A2492C" size={22} />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-body-semi text-espresso">
                    {it.title}
                  </Text>
                  <Text className="text-sm font-body text-muted-fg">
                    {subtitle}
                  </Text>
                </View>
                <ChevronRight color="#D1D5DB" size={16} />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}

function LeverBar({ lever }: { lever: AllowanceLever }) {
  // Colour the bar by earn tier: perform = amber, ok = blue, under = grey.
  const tierColor =
    lever.tier === "perform"
      ? "#F59E0B"
      : lever.tier === "ok"
        ? "#3B82F6"
        : "#9CA3AF";
  const pct = Math.min(100, Math.max(0, Number(lever.score ?? 0)));
  return (
    <View className="mt-3 rounded-2xl bg-surface px-3 py-2.5">
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-body-semi text-espresso">
          {lever.label}
        </Text>
        <Text className="text-base font-body-bold text-espresso">
          RM {Number(lever.earned ?? 0).toFixed(2)} / RM{" "}
          {Number(lever.slice ?? 0).toFixed(2)}
        </Text>
      </View>
      <View className="mt-2 h-2 overflow-hidden rounded-full bg-primary-50">
        <View
          className="h-full"
          style={{ width: `${pct}%`, backgroundColor: tierColor }}
        />
      </View>
      <Text className="mt-1 text-xs font-body text-muted-fg">{lever.detail}</Text>
    </View>
  );
}
