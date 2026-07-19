import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
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
// Mon-first display order (DB uses 0=Sun … 6=Sat).
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const TIME_RE = /^\d{2}:\d{2}$/;

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
          from: "09:00",
          until: "18:00",
        };
      }
      for (const r of wk.weekly) {
        const from = (r.available_from ?? "00:00").slice(0, 5);
        const until = (r.available_until ?? "23:59").slice(0, 5);
        const allDay = from === "00:00" && until >= "23:59"; // stored form of "any time"
        next[r.day_of_week] = allDay
          ? { mode: "any", from: "09:00", until: "18:00" }
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

  const save = async (clear = false) => {
    if (!days) return;
    if (!clear) {
      for (const dw of WEEK_ORDER) {
        const d = days[dw];
        if (d.mode !== "custom") continue;
        if (!TIME_RE.test(d.from) || !TIME_RE.test(d.until) || d.from >= d.until) {
          Alert.alert("Check your hours", `${DAY_NAMES[dw]}: times must be HH:MM and start before end.`);
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
            <Text className="text-base font-body-semi text-espresso">Weekly pattern</Text>
            <Text className="mt-1 text-xs font-body text-muted-fg">
              {hasPattern
                ? "The AI scheduler only offers you shifts inside this pattern."
                : "No pattern saved — you're flexible, any day. Save one if you have fixed days."}
            </Text>

            <View className="mt-3 gap-2">
              {WEEK_ORDER.map((dw) => {
                const d = days[dw];
                return (
                  <View key={dw} className="flex-row flex-wrap items-center gap-2">
                    <Text className="w-9 text-xs font-body-bold uppercase text-muted">
                      {DAY_NAMES[dw]}
                    </Text>
                    {(["off", "any", "custom"] as const).map((mode) => (
                      <Pressable
                        key={mode}
                        onPress={() => setDays({ ...days, [dw]: { ...d, mode } })}
                        className={`rounded-xl px-2.5 py-1.5 ${
                          d.mode === mode
                            ? mode === "off"
                              ? "bg-espresso"
                              : "bg-primary"
                            : "bg-primary-50"
                        }`}
                      >
                        <Text
                          className={`text-xs font-body-semi ${
                            d.mode === mode ? "text-white" : "text-muted-fg"
                          }`}
                        >
                          {mode === "off" ? "Off" : mode === "any" ? "Any time" : "Hours"}
                        </Text>
                      </Pressable>
                    ))}
                    {d.mode === "custom" ? (
                      <View className="flex-row items-center gap-1">
                        <TextInput
                          value={d.from}
                          onChangeText={(t) => setDays({ ...days, [dw]: { ...d, from: t } })}
                          placeholder="09:00"
                          autoCapitalize="none"
                          className="rounded-lg border border-border px-2 py-1 text-xs font-body text-espresso"
                        />
                        <Text className="text-xs text-muted">–</Text>
                        <TextInput
                          value={d.until}
                          onChangeText={(t) => setDays({ ...days, [dw]: { ...d, until: t } })}
                          placeholder="18:00"
                          autoCapitalize="none"
                          className="rounded-lg border border-border px-2 py-1 text-xs font-body text-espresso"
                        />
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>

            {/* Max shifts per week */}
            <View className="mt-4 flex-row items-center gap-2">
              <Text className="text-xs font-body text-muted-fg">Max shifts/week</Text>
              {[null, 1, 2, 3, 4, 5].map((n) => (
                <Pressable
                  key={String(n)}
                  onPress={() => setMaxShifts(n)}
                  className={`rounded-xl px-2.5 py-1.5 ${maxShifts === n ? "bg-primary" : "bg-primary-50"}`}
                >
                  <Text
                    className={`text-xs font-body-semi ${maxShifts === n ? "text-white" : "text-muted-fg"}`}
                  >
                    {n === null ? "Any" : n}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View className="mt-4 flex-row gap-2">
              <Pressable
                onPress={() => save(false)}
                disabled={saving}
                className="flex-1 items-center rounded-2xl bg-primary py-3 active:opacity-90"
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-sm font-body-semi text-white">Save pattern</Text>
                )}
              </Pressable>
              {hasPattern ? (
                <Pressable
                  onPress={() => save(true)}
                  disabled={saving}
                  className="items-center justify-center rounded-2xl border border-border px-3 py-3"
                >
                  <Text className="text-sm font-body-semi text-muted-fg">Clear</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* Blockout dates — next 4 weeks */}
          <View className="mt-5 rounded-3xl border border-border bg-surface p-4">
            <Text className="text-base font-body-semi text-espresso">Blockout dates</Text>
            <Text className="mt-1 text-xs font-body text-muted-fg">
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
                    className={`w-[12.5%] min-w-10 items-center rounded-xl py-1.5 ${
                      blocked ? "bg-danger" : "bg-primary-50"
                    }`}
                  >
                    <Text
                      className={`text-[10px] font-body ${blocked ? "text-white" : "text-muted"}`}
                    >
                      {DAY_NAMES[d.getDay()]}
                    </Text>
                    <Text
                      className={`text-sm font-body-semi ${blocked ? "text-white" : "text-espresso"}`}
                    >
                      {busy ? "…" : d.getDate()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {blockouts.length > 0 ? (
              <View className="mt-3 gap-1.5">
                {blockouts.slice(0, 8).map((b) => (
                  <View key={b.id} className="flex-row items-center gap-2">
                    <CalendarX color="#DC2626" size={14} />
                    <Text className="text-xs font-body text-muted-fg">
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

export { RouteErrorFallback as ErrorBoundary } from "../../../components/RouteErrorBoundary";
