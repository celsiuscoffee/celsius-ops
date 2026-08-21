import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronLeft, ChevronRight } from "lucide-react-native";

// Inline month calendar with range selection — pure JS/RN, no native module,
// so it ships over-the-air. Replaces the old two free-text date boxes on the
// leave form (staff typed "7" and got "can't read the date"). One calendar,
// tap a start day then an end day; tapping a single day is a one-day leave.
//
// Dates are plain ISO (YYYY-MM-DD) built from the calendar's own y/m/d, so
// there's no timezone round-trip to slip a day.

export type DateRange = { start: string | null; end: string | null };

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
// Monday-first, the Malaysian calendar convention.
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function DateRangeCalendar({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
}) {
  // Open on the month of the current selection, else today's month.
  const init = value.start ? new Date(`${value.start}T00:00:00`) : new Date();
  const [view, setView] = useState({ y: init.getFullYear(), m: init.getMonth() });

  const startOffset = (new Date(view.y, view.m, 1).getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const pick = (d: number) => {
    const picked = iso(view.y, view.m, d);
    const { start, end } = value;
    // Fresh selection when nothing is started, a range is already complete,
    // or the tap is before the current start.
    if (!start || (start && end) || picked < start) {
      onChange({ start: picked, end: null });
    } else {
      onChange({ start, end: picked });
    }
  };

  const changeMonth = (delta: number) => {
    const m = view.m + delta;
    setView({ y: view.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 });
  };

  return (
    <View className="rounded-2xl border border-border bg-surface p-3">
      <View className="mb-2 flex-row items-center justify-between">
        <Pressable
          onPress={() => changeMonth(-1)}
          hitSlop={10}
          className="h-9 w-9 items-center justify-center rounded-full active:bg-primary-50"
        >
          <ChevronLeft color="#A2492C" size={20} />
        </Pressable>
        <Text className="text-base font-body-bold text-espresso">
          {MONTHS[view.m]} {view.y}
        </Text>
        <Pressable
          onPress={() => changeMonth(1)}
          hitSlop={10}
          className="h-9 w-9 items-center justify-center rounded-full active:bg-primary-50"
        >
          <ChevronRight color="#A2492C" size={20} />
        </Pressable>
      </View>

      <View className="flex-row">
        {WEEKDAYS.map((w) => (
          <Text key={w} className="flex-1 text-center text-[11px] font-body-semi text-muted">
            {w}
          </Text>
        ))}
      </View>

      <View className="mt-1 flex-row flex-wrap">
        {cells.map((d, i) => {
          if (d === null) {
            return <View key={`e${i}`} style={{ width: `${100 / 7}%` }} className="h-10" />;
          }
          const dISO = iso(view.y, view.m, d);
          const edge = dISO === value.start || dISO === value.end;
          const between = !!(value.start && value.end && dISO > value.start && dISO < value.end);
          return (
            <Pressable
              key={dISO}
              onPress={() => pick(d)}
              style={{ width: `${100 / 7}%` }}
              className="h-10 items-center justify-center"
            >
              <View
                className={`h-9 w-9 items-center justify-center rounded-full ${
                  edge ? "bg-primary" : between ? "bg-primary-50" : ""
                }`}
              >
                <Text
                  className={`text-sm ${
                    edge ? "font-body-bold text-white" : between ? "text-primary" : "font-body text-espresso"
                  }`}
                >
                  {d}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
