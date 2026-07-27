import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { CalendarX } from "lucide-react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import {
  clearDateAvailability,
  fetchDateAvailability,
  fetchWeeklyAvailability,
  saveWeeklyAvailability,
  setDateUnavailable,
  type DateAvailability,
} from "../../../lib/hr/api";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Mon-first display order (DB uses 0=Sun … 6=Sat).
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

// No typing: hours are picked from chips. Presets mirror the real shift
// templates; the strip covers 06:00–23:30 in 30-min steps for odd cases.
const PRESETS = [
  { label: "Morning", from: "07:30", until: "15:30" },
  { label: "Midday", from: "12:00", until: "20:00" },
  { label: "Evening", from: "15:30", until: "23:30" },
] as const;
const TIME_OPTIONS: string[] = [];
for (let h = 6; h <= 23; h++) {
  for (const m of ["00", "30"]) {
    TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:${m}`);
  }
}

type DayMode = "off" | "any" | "custom";
type DayState = { mode: DayMode; from: string; until: string };

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function AvailabilityScreen() {
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<Record<number, DayState> | null>(null);
  const [hasPattern, setHasPattern] = useState(false);
  const [maxShifts, setMaxShifts] = useState<number | null>(null);
  const [blockouts, setBlockouts] = useState<DateAvailability[]>([]);
  const [saving, setSaving] = useState(false);
  const [togglingDate, setTogglingDate] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<number | null>(null); // day whose hour picker is expanded

  const load = useCallback(async () => {
    try {
      const [wk, dates] = await Promise.all([
        fetchWeeklyAvailability().catch(() => ({ weekly: [] })),
        fetchDateAvailability().catch(() => ({ availability: [] })),
      ]);
      const next: Record<number, DayState> = {};
      for (const dw of WEEK_ORDER) {
        next[dw] = {
          mode: wk.weekly.length === 0 ? "any" : "off",
          from: "07:30",
          until: "15:30",
        };
      }
      for (const r of wk.weekly) {
        const from = (r.available_from ?? "00:00").slice(0, 5);
        const until = (r.available_until ?? "23:59").slice(0, 5);
        const allDay = from === "00:00" && until >= "23:59"; // stored form of "any time"
        next[r.day_of_week] = allDay
          ? { mode: "any", from: "07:30", until: "15:30" }
          : { mode: "custom", from, until };
      }
      setDays(next);
      setHasPattern(wk.weekly.length > 0);
      setMaxShifts(
        wk.weekly.find((r) => r.max_shifts_per_week != null)?.max_shifts_per_week ?? null,
      );
      setBlockouts(dates.availability.filter((a) => a.availability === "unavailable"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Live summary so staff see what they're about to save.
  const summary = useMemo(() => {
    if (!days) return "";
    const on = WEEK_ORDER.filter((dw) => days[dw].mode !== "off");
    if (on.length === 0) return "No days selected — you won't be offered any shifts.";
    if (on.length === 7 && on.every((dw) => days[dw].mode === "any")) return "Available any day, any time.";
    const parts = on.map((dw) =>
      days[dw].mode === "any" ? DAY_NAMES[dw] : `${DAY_NAMES[dw]} ${days[dw].from}–${days[dw].until}`,
    );
    return `Available: ${parts.join(", ")}${maxShifts ? ` · max ${maxShifts} shifts/week` : ""}`;
  }, [days, maxShifts]);

  const setAll = (mode: DayMode, only?: number[]) => {
    if (!days) return;
    const next = { ...days };
    for (const dw of WEEK_ORDER) {
      if (only && !only.includes(dw)) {
        next[dw] = { ...next[dw], mode: "off" };
      } else {
        next[dw] = { ...next[dw], mode };
      }
    }
    setDays(next);
    Haptics.selectionAsync();
  };

  const save = async (clear = false) => {
    if (!days) return;
    if (!clear) {
      for (const dw of WEEK_ORDER) {
        const d = days[dw];
        if (d.mode === "custom" && d.from >= d.until) {
          Alert.alert("Check your hours", `${DAY_FULL[dw]}: start time must be before end time.`);
          return;
        }
      }
    }
    setSaving(true);
    try {
      await saveWeeklyAvailability(
        clear
          ? { days: [] }
          : {
              days: WEEK_ORDER.filter((dw) => days[dw].mode !== "off").map((dw) => ({
                day_of_week: dw,
                available_from: days[dw].mode === "custom" ? days[dw].from : null,
                available_until: days[dw].mode === "custom" ? days[dw].until : null,
              })),
              max_shifts_per_week: maxShifts,
            },
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOpenDay(null);
      await load();
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const toggleDate = async (date: string, blocked: boolean) => {
    setTogglingDate(date);
    try {
      if (blocked) await clearDateAvailability(date);
      else await setDateUnavailable(date);
      Haptics.selectionAsync();
      const dates = await fetchDateAvailability();
      setBlockouts(dates.availability.filter((a) => a.availability === "unavailable"));
    } catch (e) {
      Alert.alert("Couldn't update", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setTogglingDate(null);
    }
  };

  // Next 28 days for the blockout strip.
  const today = new Date();
  const upcoming: Date[] = [];
  for (let i = 0; i < 28; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    upcoming.push(d);
  }
  const blockedSet = new Set(blockouts.map((b) => b.date));

  return (
    <Screen edges={["top", "left", "right"]}>
      <PageHeader title="My Availability" back />
      {loading || !days ? (
        <View className="items-center py-10">
          <ActivityIndicator color="#A2492C" />
        </View>
      ) : (
        <ScrollView contentContainerClassName="pb-10" showsVerticalScrollIndicator={false}>
          {/* Weekly pattern */}
          <View className="mt-5 rounded-3xl border border-border bg-surface p-4">
            <Text className="text-lg font-body-semi text-espresso">Weekly pattern</Text>
            <Text className="mt-1 text-sm font-body text-muted-fg">
              {hasPattern
                ? "You'll only be offered shifts inside this pattern."
                : "Nothing saved yet — you're flexible, any day. Set a pattern if you have fixed days."}
            </Text>

            {/* One-tap setups */}
            <View className="mt-3 flex-row flex-wrap gap-2">
              <QuickChip label="Any day" onPress={() => setAll("any")} />
              <QuickChip label="Weekdays only" onPress={() => setAll("any", [1, 2, 3, 4, 5])} />
              <QuickChip label="Weekends only" onPress={() => setAll("any", [6, 0])} />
            </View>

            <View className="mt-4 gap-2.5">
              {WEEK_ORDER.map((dw) => {
                const d = days[dw];
                const expanded = openDay === dw && d.mode === "custom";
                return (
                  <View key={dw} className={`rounded-2xl ${expanded ? "bg-primary-50/50 p-2.5" : ""}`}>
                    <View className="flex-row items-center gap-2.5">
                      <Text className="w-12 text-base font-body-bold text-espresso">
                        {DAY_NAMES[dw]}
                      </Text>
                      {(["off", "any", "custom"] as const).map((mode) => {
                        const active = d.mode === mode;
                        return (
                          <Pressable
                            key={mode}
                            onPress={() => {
                              setDays({ ...days, [dw]: { ...d, mode } });
                              setOpenDay(mode === "custom" ? dw : openDay === dw ? null : openDay);
                              Haptics.selectionAsync();
                            }}
                            className={`min-h-11 flex-1 items-center justify-center rounded-xl px-2 py-2.5 ${
                              active ? (mode === "off" ? "bg-espresso" : "bg-primary") : "bg-primary-50"
                            }`}
                          >
                            <Text
                              className={`text-sm font-body-semi ${active ? "text-white" : "text-muted-fg"}`}
                              numberOfLines={1}
                            >
                              {mode === "off" ? "Off" : mode === "any" ? "Any time" : d.mode === "custom" ? `${d.from}–${d.until}` : "Hours…"}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    {/* Hour picker — no typing, just taps */}
                    {expanded ? (
                      <View className="mt-2.5">
                        <View className="flex-row flex-wrap gap-2">
                          {PRESETS.map((p) => {
                            const active = d.from === p.from && d.until === p.until;
                            return (
                              <Pressable
                                key={p.label}
                                onPress={() => {
                                  setDays({ ...days, [dw]: { ...d, from: p.from, until: p.until } });
                                  Haptics.selectionAsync();
                                }}
                                className={`min-h-11 justify-center rounded-xl px-3.5 py-2.5 ${active ? "bg-primary" : "bg-surface border border-border"}`}
                              >
                                <Text className={`text-sm font-body-semi ${active ? "text-white" : "text-espresso"}`}>
                                  {p.label} {p.from}–{p.until}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <TimeStrip
                          label="From"
                          value={d.from}
                          onPick={(t) =>
                            setDays({
                              ...days,
                              [dw]: { ...d, from: t, until: d.until <= t ? TIME_OPTIONS[Math.min(TIME_OPTIONS.indexOf(t) + 16, TIME_OPTIONS.length - 1)] : d.until },
                            })
                          }
                        />
                        <TimeStrip
                          label="Until"
                          value={d.until}
                          options={TIME_OPTIONS.filter((t) => t > d.from)}
                          onPick={(t) => setDays({ ...days, [dw]: { ...d, until: t } })}
                        />
                        <Pressable
                          onPress={() => setOpenDay(null)}
                          className="mt-2 self-end rounded-xl px-3 py-2"
                        >
                          <Text className="text-sm font-body-semi text-primary">Done</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>

            {/* Max shifts per week */}
            <Text className="mt-5 text-base font-body-semi text-espresso">Max shifts per week</Text>
            <View className="mt-2 flex-row gap-2">
              {[null, 1, 2, 3, 4, 5].map((n) => (
                <Pressable
                  key={String(n)}
                  onPress={() => {
                    setMaxShifts(n);
                    Haptics.selectionAsync();
                  }}
                  className={`min-h-11 flex-1 items-center justify-center rounded-xl py-2.5 ${maxShifts === n ? "bg-primary" : "bg-primary-50"}`}
                >
                  <Text className={`text-base font-body-semi ${maxShifts === n ? "text-white" : "text-muted-fg"}`}>
                    {n === null ? "Any" : n}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Live summary */}
            <Text className="mt-4 text-sm font-body text-muted-fg">{summary}</Text>

            <View className="mt-3 flex-row gap-2">
              <Pressable
                onPress={() => save(false)}
                disabled={saving}
                className="min-h-13 flex-1 items-center justify-center rounded-2xl bg-primary py-3.5 active:opacity-90"
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-base font-body-semi text-white">Save pattern</Text>
                )}
              </Pressable>
              {hasPattern ? (
                <Pressable
                  onPress={() => save(true)}
                  disabled={saving}
                  className="items-center justify-center rounded-2xl border border-border px-4 py-3.5"
                >
                  <Text className="text-base font-body-semi text-muted-fg">Clear</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* Blockout dates — next 4 weeks */}
          <View className="mt-5 rounded-3xl border border-border bg-surface p-4">
            <Text className="text-lg font-body-semi text-espresso">Blockout dates</Text>
            <Text className="mt-1 text-sm font-body text-muted-fg">
              Tap a date you can&apos;t work (next 4 weeks). Red = blocked.
            </Text>
            <View className="mt-3 flex-row flex-wrap gap-1.5">
              {upcoming.map((d) => {
                const date = ymd(d);
                const blocked = blockedSet.has(date);
                const busy = togglingDate === date;
                return (
                  <Pressable
                    key={date}
                    onPress={() => toggleDate(date, blocked)}
                    disabled={busy}
                    className={`min-h-14 w-[12.5%] min-w-11 items-center justify-center rounded-xl py-2 ${
                      blocked ? "bg-danger" : "bg-primary-50"
                    }`}
                  >
                    <Text className={`text-[11px] font-body ${blocked ? "text-white" : "text-muted"}`}>
                      {DAY_NAMES[d.getDay()]}
                    </Text>
                    <Text className={`text-base font-body-semi ${blocked ? "text-white" : "text-espresso"}`}>
                      {busy ? "…" : d.getDate()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {blockouts.length > 0 ? (
              <View className="mt-3 gap-2">
                {blockouts.slice(0, 8).map((b) => (
                  <View key={b.id} className="flex-row items-center gap-2">
                    <CalendarX color="#DC2626" size={16} />
                    <Text className="text-sm font-body text-muted-fg">
                      {new Date(b.date + "T00:00:00").toLocaleDateString("en-MY", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                      {b.reason ? ` — ${b.reason}` : ""}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

function QuickChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="min-h-11 justify-center rounded-xl border border-border bg-surface px-3.5 py-2.5 active:bg-primary-50"
    >
      <Text className="text-sm font-body-semi text-espresso">{label}</Text>
    </Pressable>
  );
}

// Horizontal chip strip of times in 30-min steps — replaces typed HH:MM input.
function TimeStrip({
  label,
  value,
  options = TIME_OPTIONS,
  onPick,
}: {
  label: string;
  value: string;
  options?: string[];
  onPick: (t: string) => void;
}) {
  return (
    <View className="mt-2.5">
      <Text className="mb-1.5 text-sm font-body-semi text-muted-fg">{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5 pr-4">
        {options.map((t) => {
          const active = t === value;
          return (
            <Pressable
              key={t}
              onPress={() => {
                onPick(t);
                Haptics.selectionAsync();
              }}
              className={`min-h-11 justify-center rounded-xl px-3.5 py-2.5 ${active ? "bg-primary" : "bg-surface border border-border"}`}
            >
              <Text className={`text-base font-body-semi ${active ? "text-white" : "text-espresso"}`}>{t}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export { RouteErrorFallback as ErrorBoundary } from "../../../components/RouteErrorBoundary";
