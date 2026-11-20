import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { fetchAttendance, type AttendanceItem } from "../../../lib/hr/api";
import { mytDayLabel } from "../../../lib/hr/myt";
import { clock12 } from "../../../lib/celsius-ui";

export default function AttendanceScreen() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["hr-attendance", 30],
    queryFn: () => fetchAttendance(30),
  });
  const items = data?.logs ?? [];
  // Overtime still with a manager shows once per day, on that day's first row.
  const mytDate = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const firstOfDay = new Set<string>();
  const seenDays = new Set<string>();
  for (const it of items) {
    const d = mytDate(it.clock_in);
    if (!seenDays.has(d)) { seenDays.add(d); firstOfDay.add(it.id); }
  }
  const stats = data?.stats;

  return (
    <Screen edges={["top", "left", "right"]}>
      <PageHeader title="Attendance" back />
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-sm text-danger-text text-center">
            {(error as Error).message}
          </Text>
        </View>
      ) : (
        <FlatList
          className="flex-1"
          contentContainerClassName="pt-2 pb-6"
          data={items}
          keyExtractor={(a) => a.id}
          ListHeaderComponent={stats ? <StatsCard stats={stats} /> : null}
          ItemSeparatorComponent={() => <View className="h-2" />}
          renderItem={({ item }) => (
          <AttendanceCard
            item={item}
            pendingOt={firstOfDay.has(item.id) ? data?.pendingOtByDate?.[mytDate(item.clock_in)] ?? 0 : 0}
          />
        )}
          ListEmptyComponent={
            <Text className="mt-12 text-center text-sm text-text-2">
              No clock-ins in the last 30 days. They show here after your next shift.
            </Text>
          }
      showsVerticalScrollIndicator={false}
    />
      )}
    </Screen>
  );
}

function StatsCard({ stats }: { stats: { totalHours: number; totalOT: number; pendingOT?: number; daysWorked: number } }) {
  return (
    <View className="mb-4 rounded-2xl border border-line bg-surface p-5">
      <Text className="text-sm font-body-semi text-text-2">
        Last 30 days
      </Text>
      <View className="mt-3 flex-row justify-between">
        <Stat label="Days" value={String(stats.daysWorked ?? 0)} />
        <Stat label="Hours" value={Number(stats.totalHours ?? 0).toFixed(1)} />
        <Stat label="Overtime" value={Number(stats.totalOT ?? 0).toFixed(1)} />
      </View>
      {Number(stats.pendingOT ?? 0) > 0 ? (
        <Text className="mt-3 text-sm text-info-text">
          +{Number(stats.pendingOT).toFixed(1)} h overtime with your manager
        </Text>
      ) : null}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="items-center">
      <Text className="text-2xl font-display text-text">{value}</Text>
      <Text className="mt-1 text-sm font-body-semi text-text-2">
        {label}
      </Text>
    </View>
  );
}

function AttendanceCard({ item, pendingOt }: { item: AttendanceItem; pendingOt: number }) {
  // Malaysia time, whatever zone the phone is in.
  const dayLabel = mytDayLabel(item.clock_in);
  const ot = Number(item.overtime_hours ?? 0);
  // OT pays in 30-minute brackets (owner 2026-09-03: "pay the 0.5h"). Since
  // 19 Nov the clocked tail lands on the log only once a manager approves it
  // on the Overtime page; until then it shows as "with your manager" (the
  // way Gosamē's Staff app shows it, owner 20 Nov 2026).
  const status =
    item.final_status === "rejected" ? "Rejected"
    : item.final_status === "adjusted" ? "Times fixed"
    : item.final_status === "approved" ? null
    : item.ai_status === "flagged" ? "Awaiting review"
    : null;
  return (
    <View className="rounded-2xl border border-line bg-surface p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-body-semi text-text">{dayLabel}</Text>
        <Text className="text-sm font-display-medium text-text">
          {item.total_hours != null ? `${Number(item.total_hours).toFixed(2)} h` : "-"}
        </Text>
      </View>
      <Text className="mt-1 text-xs text-text-2">
        {clock12(item.clock_in)} – {item.clock_out ? clock12(item.clock_out) : "still in"}
        {ot >= 0.5 ? `  ·  Overtime ${ot} h` : ""}
      </Text>
      {pendingOt > 0 ? (
        <Text className="mt-1 text-xs font-body-semi text-info-text">+{pendingOt} h overtime · with your manager</Text>
      ) : null}
      {status ? (
        <Text className={`mt-1 text-xs font-body-semi ${item.final_status === "rejected" ? "text-danger-text" : "text-text-3"}`}>
          {status}
        </Text>
      ) : null}
    </View>
  );
}

// Route-level boundary: a throw in this screen degrades to an inline retry
// card instead of unmounting the whole HR stack (see the Who's Working
// incident, docs in components/RouteErrorBoundary.tsx).
export { RouteErrorFallback as ErrorBoundary } from "../../../components/RouteErrorBoundary";
