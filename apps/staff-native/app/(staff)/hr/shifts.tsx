import { useQuery } from "@tanstack/react-query";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  Text,
  View,
} from "react-native";
import { CalendarPlus, Clock } from "lucide-react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { fetchShifts, type Shift } from "../../../lib/hr/api";
import { buildShiftCalendarUrl, formatDuration } from "../../../lib/hr/calendar";

export default function ShiftsScreen() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["hr-shifts"],
    queryFn: fetchShifts,
  });
  const shifts = data?.shifts ?? [];

  return (
    <Screen>
      <PageHeader title="My Shifts" back />
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
      ) : shifts.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-base font-display-medium text-espresso">
            No upcoming shifts
          </Text>
          <Text className="mt-1 text-sm text-muted-fg text-center">
            Once your manager publishes the next schedule, it'll show up here.
          </Text>
        </View>
      ) : (
        <FlatList
          className="flex-1"
          contentContainerClassName="pt-2 pb-24"
          data={shifts}
          keyExtractor={(s) => s.id}
          ItemSeparatorComponent={() => <View className="h-3" />}
          renderItem={({ item }) => <ShiftCard shift={item} />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </Screen>
  );
}

// "Today" / "Tomorrow" / null for a shift date, comparing calendar days in
// local time (dates come back as plain YYYY-MM-DD).
function relativeDay(dateISO: string): string | null {
  const [y, m, d] = dateISO.split("-").map(Number);
  const shift = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((shift.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return null;
}

function ShiftCard({ shift }: { shift: Shift }) {
  const d = new Date(shift.shift_date);
  const dayName = d.toLocaleDateString([], { weekday: "short" });
  const dayNum = d.toLocaleDateString([], { day: "numeric" });
  const monthName = d.toLocaleDateString([], { month: "short" });
  const rel = relativeDay(shift.shift_date);
  const duration = formatDuration(shift.start_time, shift.end_time);

  const addToCalendar = () => {
    const url = buildShiftCalendarUrl(shift);
    Linking.openURL(url).catch(() =>
      Alert.alert(
        "Couldn't open calendar",
        "We couldn't open your calendar app. Please try again.",
      ),
    );
  };

  return (
    <View className="rounded-3xl border border-border bg-surface p-4">
      <View className="flex-row items-center">
        {/* Date chip */}
        <View className="w-16 items-center justify-center rounded-2xl bg-primary-50 py-2">
          <Text className="text-xs font-body-semi text-primary uppercase">
            {dayName}
          </Text>
          <Text className="text-xl font-display-medium text-espresso">
            {dayNum}
          </Text>
          <Text className="text-[10px] font-body text-muted uppercase">
            {monthName}
          </Text>
        </View>

        {/* Time + role */}
        <View className="ml-4 flex-1 justify-center">
          <Text className="text-base font-display-medium text-espresso">
            {fmtTime(shift.start_time)} – {fmtTime(shift.end_time)}
          </Text>
          <View className="mt-1.5 flex-row items-center gap-2">
            <View className="flex-row items-center gap-1">
              <Clock color="#6B6B6B" size={13} />
              <Text className="text-xs font-body-medium text-muted-fg">
                {duration}
              </Text>
            </View>
            {shift.position ? (
              <View className="rounded-full bg-primary-100 px-2 py-0.5">
                <Text className="text-[11px] font-body-semi text-primary-900">
                  {shift.position}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Relative-day badge */}
        {rel ? (
          <View className="self-start rounded-full bg-espresso px-2.5 py-1">
            <Text className="text-[11px] font-body-semi text-background">
              {rel}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Add to calendar */}
      <Pressable
        onPress={addToCalendar}
        accessibilityRole="button"
        accessibilityLabel="Add this shift to your calendar"
        hitSlop={6}
        className="mt-3 flex-row items-center justify-center gap-2 rounded-2xl border border-primary-100 bg-primary-50 py-2.5 active:opacity-70"
      >
        <CalendarPlus color="#A2492C" size={16} />
        <Text className="text-sm font-body-semi text-primary">
          Add to calendar
        </Text>
      </Pressable>
    </View>
  );
}

function fmtTime(t: string): string {
  const [h, m] = t.split(":");
  const d = new Date();
  d.setHours(Number(h), Number(m), 0, 0);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
