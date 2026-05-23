import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { fetchShifts, type Shift } from "../../../lib/hr/api";

export default function ShiftsScreen() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["hr-shifts"],
    queryFn: fetchShifts,
  });

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }
  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-sm text-danger text-center">
          {(error as Error).message}
        </Text>
      </View>
    );
  }

  const shifts = data?.shifts ?? [];
  if (shifts.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-base font-display-medium text-espresso">
          No upcoming shifts
        </Text>
        <Text className="mt-1 text-sm text-muted-fg text-center">
          Once your manager publishes the next schedule, it'll show up here.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      className="flex-1 bg-background"
      contentContainerClassName="px-5 pt-4 pb-8"
      data={shifts}
      keyExtractor={(s) => s.id}
      ItemSeparatorComponent={() => <View className="h-3" />}
      renderItem={({ item }) => <ShiftCard shift={item} />}
    />
  );
}

function ShiftCard({ shift }: { shift: Shift }) {
  const d = new Date(shift.shift_date);
  const dayName = d.toLocaleDateString([], { weekday: "short" });
  const dayNum = d.toLocaleDateString([], { day: "numeric", month: "short" });
  return (
    <View className="flex-row rounded-3xl border border-border bg-surface p-4">
      <View className="w-16 items-center justify-center rounded-2xl bg-primary-50 py-2">
        <Text className="text-xs font-body-semi text-primary uppercase">
          {dayName}
        </Text>
        <Text className="text-lg font-display-medium text-espresso">
          {dayNum.split(" ")[0]}
        </Text>
      </View>
      <View className="ml-4 flex-1 justify-center">
        <Text className="text-base font-display-medium text-espresso">
          {fmtTime(shift.start_time)} – {fmtTime(shift.end_time)}
        </Text>
        {shift.position ? (
          <Text className="mt-1 text-sm text-muted-fg">{shift.position}</Text>
        ) : null}
        {shift.notes ? (
          <Text className="mt-1 text-xs text-muted">{shift.notes}</Text>
        ) : null}
      </View>
    </View>
  );
}

function fmtTime(t: string): string {
  const [h, m] = t.split(":");
  const d = new Date();
  d.setHours(Number(h), Number(m), 0, 0);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
