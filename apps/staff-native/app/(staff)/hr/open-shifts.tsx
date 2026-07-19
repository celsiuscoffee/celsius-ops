import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { CalendarPlus, ChefHat, Coffee } from "lucide-react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import {
  fetchOpenSlots,
  requestOpenSlot,
  withdrawOpenSlotRequest,
  type OpenSlot,
  type OpenSlotsResponse,
} from "../../../lib/hr/api";

export default function OpenShiftsScreen() {
  const [data, setData] = useState<OpenSlotsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchOpenSlots());
    } catch {
      // keep whatever we had; pull-to-refresh retries
    } finally {
      setLoading(false);
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

  const confirmRequest = (slot: OpenSlot) => {
    const when = new Date(slot.shift_date + "T00:00:00").toLocaleDateString("en-MY", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    Alert.alert(
      "Request this shift?",
      `${when}\n${slot.start_time}–${slot.end_time} · ${slot.outlet_name} · ${slot.station === "kitchen" ? "Kitchen" : "Barista"}\n\nYou're raising your hand — your manager picks who gets it.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Request it",
          onPress: async () => {
            setBookingId(slot.id);
            try {
              await requestOpenSlot(slot.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert("Requested ✓", "Your manager will assign someone — it shows in My Shifts if it's you.");
              load();
            } catch (e) {
              Alert.alert("Not requested", e instanceof Error ? e.message : "Please try again.");
              load();
            } finally {
              setBookingId(null);
            }
          },
        },
      ],
    );
  };

  const withdraw = async (slot: OpenSlot) => {
    setBookingId(slot.id);
    try {
      await withdrawOpenSlotRequest(slot.id);
      Haptics.selectionAsync();
      load();
    } catch (e) {
      Alert.alert("Couldn't withdraw", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBookingId(null);
    }
  };

  const shifts = data?.shifts ?? [];
  const byDate: [string, OpenSlot[]][] = [];
  for (const s of shifts) {
    const last = byDate[byDate.length - 1];
    if (last && last[0] === s.shift_date) last[1].push(s);
    else byDate.push([s.shift_date, [s]]);
  }

  return (
    <Screen edges={["top", "left", "right"]}>
      <PageHeader title="Open Slots" back />
      <ScrollView
        contentContainerClassName="pb-10"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor="#A2492C"
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <Text className="mt-4 text-sm font-body text-muted-fg">
          Extra shifts that still need someone. Request one — your manager picks who gets it.
        </Text>

        {data?.is_pt ? (
          <View className="mt-4 rounded-3xl border border-border bg-surface px-4 py-3">
            <Text className="text-sm font-body text-espresso">
              This week:{" "}
              <Text className="font-body-bold">{data.week_hours}h</Text> across{" "}
              <Text className="font-body-bold">
                {data.week_days} day{data.week_days === 1 ? "" : "s"}
              </Text>
              <Text className="text-muted"> · cap 24h / 5 days</Text>
            </Text>
          </View>
        ) : null}

        {loading ? (
          <View className="items-center py-10">
            <ActivityIndicator color="#A2492C" />
          </View>
        ) : shifts.length === 0 ? (
          <View className="mt-5 items-center rounded-3xl border border-border bg-surface p-8">
            <CalendarPlus color="#D1D5DB" size={32} />
            <Text className="mt-2 text-sm font-body-semi text-espresso">
              No open slots right now
            </Text>
            <Text className="mt-1 text-center text-xs font-body text-muted-fg">
              New slots appear here when a schedule needs extra hands.
            </Text>
          </View>
        ) : (
          byDate.map(([date, dayShifts]) => (
            <View key={date} className="mt-5">
              <Text className="mb-2 text-sm font-body-semi text-muted-fg">
                {new Date(date + "T00:00:00").toLocaleDateString("en-MY", {
                  weekday: "long",
                  day: "numeric",
                  month: "short",
                })}
              </Text>
              <View className="gap-2">
                {dayShifts.map((s) => {
                  const isKitchen = s.station === "kitchen";
                  const busy = bookingId === s.id;
                  const requested = s.my_request === "pending";
                  return (
                    <View
                      key={s.id}
                      className={`flex-row items-center gap-3 rounded-3xl border p-4 ${requested ? "border-warning/40 bg-warning/5" : s.blocked ? "border-border bg-surface opacity-60" : "border-border bg-surface"}`}
                    >
                      <View
                        className={`h-11 w-11 items-center justify-center rounded-2xl ${isKitchen ? "bg-warning/10" : "bg-primary-50"}`}
                      >
                        {isKitchen ? (
                          <ChefHat color="#D97706" size={20} />
                        ) : (
                          <Coffee color="#A2492C" size={20} />
                        )}
                      </View>
                      <View className="flex-1">
                        <Text className="text-base font-body-semi text-espresso">
                          {s.start_time}–{s.end_time}
                          <Text className="font-body text-muted"> ({s.hours}h)</Text>
                        </Text>
                        <Text className="text-xs font-body text-muted-fg" numberOfLines={1}>
                          {s.outlet_name} · {isKitchen ? "Kitchen" : "Barista"}
                          {s.role_type ? ` · ${s.role_type}` : ""}
                          {s.pending_requests > 0 ? ` · ${s.pending_requests} asked` : ""}
                        </Text>
                        {requested ? (
                          <Text className="mt-0.5 text-xs font-body-semi text-warning">Requested — waiting for your manager</Text>
                        ) : s.blocked ? (
                          <Text className="mt-0.5 text-xs font-body text-danger">{s.blocked}</Text>
                        ) : null}
                      </View>
                      {requested ? (
                        <Pressable
                          onPress={() => withdraw(s)}
                          disabled={busy}
                          className="rounded-2xl border border-border px-3.5 py-2.5 active:opacity-90"
                        >
                          {busy ? (
                            <ActivityIndicator color="#A2492C" size="small" />
                          ) : (
                            <Text className="text-sm font-body-semi text-muted-fg">Withdraw</Text>
                          )}
                        </Pressable>
                      ) : (
                        <Pressable
                          onPress={() => confirmRequest(s)}
                          disabled={!!s.blocked || busy}
                          className={`rounded-2xl px-4 py-2.5 ${s.blocked ? "bg-border" : "bg-primary active:opacity-90"}`}
                        >
                          {busy ? (
                            <ActivityIndicator color="#fff" size="small" />
                          ) : (
                            <Text
                              className={`text-sm font-body-semi ${s.blocked ? "text-muted" : "text-white"}`}
                            >
                              Request
                            </Text>
                          )}
                        </Pressable>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

export { RouteErrorFallback as ErrorBoundary } from "../../../components/RouteErrorBoundary";
