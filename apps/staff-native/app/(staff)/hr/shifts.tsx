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
import { buildShiftIcsUrl, formatDuration } from "../../../lib/hr/calendar";
import { calendarDayParts, isRestDayRow, mytToday, wallTime } from "../../../lib/hr/myt";

export default function ShiftsScreen() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["hr-shifts"],
    queryFn: fetchShifts,
  });
  // Rest-day markers (00:00–00:00 / "Rest Day") are roster rows, not shifts:
  // they rendered as a 24 h shift with an add-to-calendar button.
  const shifts = (data?.shifts ?? []).filter((s) => !isRestDayRow(s));

  return (
    <Screen edges={["top", "left", "right"]}>
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
          contentContainerClassName="pt-2 pb-6"
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

// "Today" / "Tomorrow" / null for a shift date, comparing MALAYSIA calendar
// days (roster dates are plain YYYY-MM-DD in Malaysia time; the phone's zone
// is irrelevant).
function relativeDay(dateISO: string): string | null {
  const days = Math.round((Date.parse(`${dateISO}T00:00:00Z`) - Date.parse(`${mytToday()}T00:00:00Z`)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return null;
}

function ShiftCard({ shift }: { shift: Shift }) {
  // Never `new Date("YYYY-MM-DD")`: that is UTC midnight, the previous evening
  // on any phone west of Greenwich, so the card showed the wrong day.
  const { dayName, dayNum, monthName } = calendarDayParts(shift.shift_date);
  const rel = relativeDay(shift.shift_date);
  const duration = formatDuration(shift.start_time, shift.end_time);

  const addToCalendar = () => {
    const url = buildShiftIcsUrl(shift);
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
          {shift.outlet_name ? (
            <Text className="mt-1 text-xs font-body-medium text-muted-fg">{shift.outlet_name}</Text>
          ) : null}
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

// Roster times are Malaysia wall-clock strings already; show them as such.
function fmtTime(t: string): string {
  return wallTime(t);
}

// Route-level boundary: a throw in this screen degrades to an inline retry
// card instead of unmounting the whole HR stack (see the Who's Working
// incident, docs in components/RouteErrorBoundary.tsx).
export { RouteErrorFallback as ErrorBoundary } from "../../../components/RouteErrorBoundary";
