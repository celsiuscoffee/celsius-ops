import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { ComponentType } from "react";
import {
  Calendar,
  CalendarClock,
  ChevronRight,
  Clock,
  FileText,
  Plane,
  Star,
  Target,
  Trophy,
  Users,
  Wallet,
} from "lucide-react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { List, ListRow, Section } from "../../../components/ui";
import { fetchAllowances, fetchMyReviews, type AllowanceBreakdown } from "../../../lib/hr/api";
import { getClockStatus, type ClockStatus } from "../../../lib/hr/clock";
import { fetchProfile } from "../../../lib/hr/profile";
import { useStaff } from "../../../lib/store";
import { clock12, useCelsius } from "../../../lib/celsius-ui";

// Me: everything about the person, in one place (docs/design/staff-native-structure.md).
// Today keeps the clock card and the day's tasks; this tab holds the rest:
// shifts, time and pay, how you are doing, and the profile and settings.
type Item = {
  href: string;
  title: string;
  subtitle: string;
  icon: ComponentType<{ color?: string; size?: number }>;
};

const SHIFTS: Item[] = [
  { href: "/(staff)/hr/shifts", title: "My shifts", subtitle: "Today and upcoming", icon: Calendar },
  { href: "/(staff)/hr/whos-working", title: "Who's working", subtitle: "Your team's shifts by day", icon: Users },
  { href: "/(staff)/hr/availability", title: "My availability", subtitle: "Weekly pattern and days off", icon: CalendarClock },
];

const TIME_AND_PAY: Item[] = [
  { href: "/(staff)/hr/attendance", title: "Attendance", subtitle: "Clock-in history and overtime", icon: Clock },
  { href: "/(staff)/hr/leave", title: "Leave", subtitle: "Balances and requests", icon: Plane },
  { href: "/(staff)/hr/payslips", title: "Payslips", subtitle: "Monthly pay history", icon: Wallet },
];

const GROWTH: Item[] = [
  { href: "/(staff)/hr/reviews", title: "Feedback", subtitle: "Customer reviews during your shifts", icon: Star },
  { href: "/(staff)/hr/my-skills", title: "My skills", subtitle: "Audit scores and progress", icon: Target },
  { href: "/(staff)/hr/memos", title: "Memos", subtitle: "Notices from HR", icon: FileText },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const rm = (n: unknown) => `RM ${Number(n ?? 0).toFixed(2)}`;

export default function MeScreen() {
  const C = useCelsius().color;
  const router = useRouter();
  const session = useStaff((s) => s.session);
  const [clock, setClock] = useState<ClockStatus | null>(null);
  const [allowance, setAllowance] = useState<AllowanceBreakdown | null>(null);
  const [reviewsCount, setReviewsCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Availability is a part-timer tool (interns too) — full-timers have
  // manager-set schedules, so hide it for them.
  const [isPartTimer, setIsPartTimer] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, a, r, p] = await Promise.all([
        getClockStatus().catch(() => null),
        fetchAllowances()
          .then((x) => x.breakdown)
          .catch(() => null),
        fetchMyReviews()
          .then((x) => x.count)
          .catch(() => 0),
        fetchProfile()
          .then((x) => x.profile?.employment_type ?? null)
          .catch(() => null),
      ]);
      setClock(c);
      setAllowance(a);
      setReviewsCount(r);
      setIsPartTimer(["part_time", "intern"].includes(p ?? ""));
    } finally {
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
  const role = session?.role ? session.role.charAt(0) + session.role.slice(1).toLowerCase() : null;

  // One line that says where the month stands; the breakdown is on My scoreboard.
  const scoreMeta = allowance?.eligible
    ? `${rm(allowance.totalEarned)} of ${rm(allowance.totalMax)} in ${MONTHS[(allowance.period?.month ?? 1) - 1] ?? ""} · ${
        allowance.period?.daysRemaining ?? 0
      } ${allowance.period?.daysRemaining === 1 ? "day" : "days"} left`
    : "Your KPIs and allowance this month";

  const row = (it: Item) => (
    <ListRow
      key={it.href}
      icon={it.icon}
      title={it.title}
      meta={
        it.href === "/(staff)/hr/reviews" && reviewsCount > 0
          ? `${reviewsCount} ${reviewsCount === 1 ? "review" : "reviews"} during your shifts`
          : it.subtitle
      }
      onPress={() => router.push(it.href as never)}
    />
  );

  return (
    <Screen edges={["top", "left", "right"]}>
      <PageHeader title="Me" />
      <ScrollView
        contentContainerClassName="pb-8"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={C["text-3"]}
            colors={[C["text-2"]]}
          />
        }
      >
        {/* Who you are: opens Profile (personal info, PIN, appearance, sign out). */}
        <Pressable
          onPress={() => router.push("/(staff)/profile")}
          accessibilityRole="button"
          accessibilityLabel="Profile and settings"
          className="flex-row items-center gap-3 rounded-2xl border border-line bg-surface p-4 active:bg-sunken"
        >
          <View className="h-12 w-12 items-center justify-center rounded-full bg-sunken">
            <Text className="text-lg font-display text-text">
              {session?.name?.charAt(0)?.toUpperCase() ?? "?"}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="text-base font-body-semi text-text" numberOfLines={1}>
              {session?.name ?? "-"}
            </Text>
            <Text className="text-sm font-body text-text-2" numberOfLines={1}>
              {[role, session?.outletName].filter(Boolean).join(" · ") || "Profile and settings"}
            </Text>
          </View>
          <ChevronRight color={C["text-3"]} size={18} />
        </Pressable>

        {/* Today shows the clock card only for people with an outlet; anyone
            else clocks in from here. */}
        {!session?.outletId ? (
          <View className="mt-3">
            <List>
              <ListRow
                icon={Clock}
                tone={isClockedIn ? "ok" : "neutral"}
                title={isClockedIn ? "On shift" : "Clock in"}
                meta={
                  isClockedIn && clock?.activeLog
                    ? `Clocked in at ${clock12(clock.activeLog.clock_in)} · tap to clock out`
                    : "Selfie and location"
                }
                onPress={() => router.push("/(staff)/clock")}
              />
            </List>
          </View>
        ) : null}

        <Section title="How you're doing">
          <List>
            <ListRow
              icon={Trophy}
              title="My scoreboard"
              meta={scoreMeta}
              onPress={() => router.push("/(staff)/hr/scoreboard")}
            />
            {GROWTH.map(row)}
          </List>
        </Section>

        <Section title="Shifts">
          <List>
            {SHIFTS.filter((it) => it.href !== "/(staff)/hr/availability" || isPartTimer).map(row)}
          </List>
        </Section>

        <Section title="Time and pay">
          <List>{TIME_AND_PAY.map(row)}</List>
        </Section>
      </ScrollView>
    </Screen>
  );
}

// Route-level boundary: a throw in this screen degrades to an inline retry
// card instead of unmounting the whole Me stack (see the Who's Working
// incident, docs in components/RouteErrorBoundary.tsx).
export { RouteErrorFallback as ErrorBoundary } from "../../../components/RouteErrorBoundary";
