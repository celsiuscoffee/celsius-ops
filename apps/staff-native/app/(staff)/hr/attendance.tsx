import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { fetchAttendance, type AttendanceItem } from "../../../lib/hr/api";
import { mytDayLabel, mytTime } from "../../../lib/hr/myt";

export default function AttendanceScreen() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["hr-attendance", 30],
    queryFn: () => fetchAttendance(30),
  });
  const items = data?.logs ?? [];
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
          <Text className="text-sm text-danger text-center">
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
          renderItem={({ item }) => <AttendanceCard item={item} />}
          ListEmptyComponent={
            <Text className="mt-12 text-center text-sm text-muted-fg">
              No attendance records in the last 30 days.
            </Text>
          }
      showsVerticalScrollIndicator={false}
    />
      )}
    </Screen>
  );
}

function StatsCard({ stats }: { stats: { totalHours: number; totalOT: number; daysWorked: number } }) {
  return (
    <View className="mb-4 rounded-3xl border border-border bg-surface p-5">
      <Text className="text-xs font-body-semi text-muted uppercase tracking-wide">
        Last 30 days
      </Text>
      <View className="mt-3 flex-row justify-between">
        <Stat label="Days" value={String(stats.daysWorked ?? 0)} />
        <Stat label="Hours" value={Number(stats.totalHours ?? 0).toFixed(1)} />
        <Stat label="OT" value={Number(stats.totalOT ?? 0).toFixed(1)} />
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="items-center">
      <Text className="text-2xl font-display text-espresso">{value}</Text>
      <Text className="mt-1 text-xs font-body-semi text-muted uppercase tracking-wide">
        {label}
      </Text>
    </View>
  );
}

function AttendanceCard({ item }: { item: AttendanceItem }) {
  // Malaysia time, whatever zone the phone is in.
  const dayLabel = mytDayLabel(item.clock_in);
  const ot = Number(item.overtime_hours ?? 0);
  // OT pays in 30-minute brackets (owner 2026-09-03: "pay the 0.5h"); the
  // stats card counted from 0.5 h while rows hid anything under 1 h, so the
  // total and the rows disagreed. OT only reaches payroll once a manager has
  // approved the day, so say which state it is in — the web app does.
  const otApproved = item.final_status === "approved" || item.final_status === "adjusted";
  const status =
    item.final_status === "rejected" ? "Rejected"
    : item.final_status === "adjusted" ? "Times fixed"
    : item.final_status === "approved" ? null
    : item.ai_status === "flagged" ? "Awaiting review"
    : null;
  return (
    <View className="rounded-2xl border border-border bg-surface p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-body-semi text-espresso">{dayLabel}</Text>
        <Text className="text-sm font-display-medium text-espresso">
          {item.total_hours != null ? `${Number(item.total_hours).toFixed(2)}h` : "-"}
        </Text>
      </View>
      <Text className="mt-1 text-xs text-muted-fg">
        {mytTime(item.clock_in)} → {item.clock_out ? mytTime(item.clock_out) : "still in"}
        {ot >= 0.5 ? `  ·  OT ${ot}h${otApproved ? "" : " (pending)"}` : ""}
      </Text>
      {status ? (
        <Text className={`mt-1 text-[11px] font-body-semi ${item.final_status === "rejected" ? "text-danger" : "text-muted"}`}>
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
