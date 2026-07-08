import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { fetchAttendance, type AttendanceItem } from "../../../lib/hr/api";

export default function AttendanceScreen() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["hr-attendance", 30],
    queryFn: () => fetchAttendance(30),
  });
  const items = data?.logs ?? [];
  const stats = data?.stats;

  return (
    <Screen>
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
          contentContainerClassName="pt-2 pb-8"
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
  const ci = new Date(item.clock_in);
  const co = item.clock_out ? new Date(item.clock_out) : null;
  const dayLabel = ci.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return (
    <View className="rounded-2xl border border-border bg-surface p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-body-semi text-espresso">{dayLabel}</Text>
        <Text className="text-sm font-display-medium text-espresso">
          {item.total_hours != null ? `${item.total_hours.toFixed(2)}h` : "—"}
        </Text>
      </View>
      <Text className="mt-1 text-xs text-muted-fg">
        {fmtTime(ci)} → {co ? fmtTime(co) : "still in"}
        {item.overtime_hours && Number(item.overtime_hours) >= 1
          ? `  ·  OT ${item.overtime_hours}h`
          : ""}
      </Text>
    </View>
  );
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
