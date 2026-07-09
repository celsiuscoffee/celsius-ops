import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Bot, CheckCircle2, Clock, Plus, XCircle } from "lucide-react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import {
  fetchLeave,
  submitLeave,
  type LeaveBalance,
  type LeaveRequest,
} from "../../../lib/hr/api";

const LEAVE_TYPES = [
  { key: "annual", label: "Annual" },
  { key: "sick", label: "Sick" },
  { key: "emergency", label: "Emergency" },
  { key: "unpaid", label: "Unpaid" },
];

export default function LeaveScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [type, setType] = useState("annual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchLeave().catch(
        () => ({ balances: [], requests: [] }),
      );
      setBalances(data.balances ?? []);
      setRequests(data.requests ?? []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Guard against malformed free-text dates: a bad end date made `endDate >=
  // startDate` (a string compare) pass while new Date() was NaN, so totalDays
  // came out NaN and slipped past the `<= 0` submit/button guards, POSTing
  // total_days: null. Require real ISO dates before computing anything.
  const isISODate = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(new Date(`${s}T00:00:00`).getTime());
  const datesValid =
    isISODate(startDate) && isISODate(endDate) && endDate >= startDate;
  const totalDays = datesValid
    ? Math.ceil(
        (new Date(endDate).getTime() - new Date(startDate).getTime()) /
          (1000 * 60 * 60 * 24),
      ) + 1
    : 0;

  const submit = async () => {
    if (!startDate || !endDate || totalDays <= 0) return;
    setSubmitting(true);
    try {
      await submitLeave({
        leave_type: type,
        start_date: startDate,
        end_date: endDate,
        total_days: totalDays,
        reason,
      });
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      setSheetOpen(false);
      setStartDate("");
      setEndDate("");
      setReason("");
      load();
    } catch (e) {
      Alert.alert(
        "Couldn't submit",
        e instanceof Error ? e.message : "Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Screen>
        <PageHeader title="Leave" back />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#A2492C" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <PageHeader title="Leave" back />
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pt-4"
        contentContainerStyle={{ paddingBottom: tabBarHeight + 96 }}
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
        {/* Balances */}
        <Text className="text-xs font-body-semi uppercase tracking-wide text-muted">
          Balances ({new Date().getFullYear()})
        </Text>
        {balances.length === 0 ? (
          <Text className="mt-2 text-sm font-body text-muted-fg">
            No leave balances assigned yet.
          </Text>
        ) : (
          <View className="mt-2 flex-row flex-wrap gap-2">
            {balances.map((b) => (
              <View
                key={b.id}
                className="flex-1 min-w-[45%] rounded-2xl border border-border bg-surface p-3"
              >
                <Text className="text-xs font-body text-muted">
                  {b.leave_type}
                </Text>
                <Text className="text-2xl font-display text-primary">
                  {b.remaining_days}
                </Text>
                <Text className="text-[10px] font-body text-muted">
                  of {b.entitled_days} days
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* History */}
        <Text className="mt-5 text-xs font-body-semi uppercase tracking-wide text-muted">
          History
        </Text>
        {requests.length === 0 ? (
          <Text className="mt-2 text-sm font-body text-muted-fg">
            No leave requests yet.
          </Text>
        ) : (
          <View className="mt-2 gap-2">
            {requests.map((r) => (
              <RequestCard key={r.id} request={r} />
            ))}
          </View>
        )}
      </ScrollView>

      {/* Pinned bottom CTA */}
      <View
        style={{ paddingBottom: tabBarHeight + 12 }}
        className="absolute inset-x-0 bottom-0 border-t border-border bg-background px-5 pt-3"
      >
        <Pressable
          onPress={() => setSheetOpen(true)}
          className="h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-primary active:opacity-80"
        >
          <Plus color="#FFFFFF" size={20} />
          <Text className="text-base font-body-bold text-white">
            Request leave
          </Text>
        </Pressable>
      </View>

      {/* Request bottom sheet */}
      <Modal
        visible={sheetOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSheetOpen(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View className="flex-1 bg-background">
            <View className="flex-row items-center justify-between border-b border-border px-5 py-4">
              <Text className="text-xl font-display text-espresso">
                Request leave
              </Text>
              <Pressable
                onPress={() => setSheetOpen(false)}
                className="px-2 py-1"
              >
                <Text className="text-sm font-body-bold text-muted">
                  Cancel
                </Text>
              </Pressable>
            </View>

            <ScrollView
              className="flex-1"
              contentContainerClassName="px-5 pt-4 pb-8"
              keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
              <Text className="text-xs font-body-semi uppercase tracking-wide text-muted">
                Type
              </Text>
              <View className="mt-2 flex-row flex-wrap gap-2">
                {LEAVE_TYPES.map((t) => (
                  <Pressable
                    key={t.key}
                    onPress={() => setType(t.key)}
                    className={`rounded-full border-2 px-4 py-2 ${
                      type === t.key
                        ? "border-primary bg-primary-50"
                        : "border-border bg-surface"
                    }`}
                  >
                    <Text
                      className={`text-sm font-body-bold ${type === t.key ? "text-primary" : "text-muted-fg"}`}
                    >
                      {t.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View className="mt-5 flex-row gap-3">
                <View className="flex-1">
                  <Text className="mb-2 text-xs font-body-semi uppercase tracking-wide text-muted">
                    From
                  </Text>
                  <TextInput
                    value={startDate}
                    onChangeText={setStartDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#9CA3AF"
                    autoCapitalize="none"
                    className="h-14 rounded-2xl border border-border bg-surface px-4 text-base font-body text-espresso"
                  />
                </View>
                <View className="flex-1">
                  <Text className="mb-2 text-xs font-body-semi uppercase tracking-wide text-muted">
                    To
                  </Text>
                  <TextInput
                    value={endDate}
                    onChangeText={setEndDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#9CA3AF"
                    autoCapitalize="none"
                    className="h-14 rounded-2xl border border-border bg-surface px-4 text-base font-body text-espresso"
                  />
                </View>
              </View>
              {totalDays > 0 ? (
                <Text className="mt-2 text-sm font-body-bold text-primary">
                  {totalDays} day{totalDays === 1 ? "" : "s"}
                </Text>
              ) : null}

              <Text className="mt-5 text-xs font-body-semi uppercase tracking-wide text-muted">
                Reason (optional)
              </Text>
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="Why are you taking leave?"
                placeholderTextColor="#9CA3AF"
                multiline
                className="mt-2 min-h-20 rounded-2xl border border-border bg-surface px-4 py-3 text-base font-body text-espresso"
              />
            </ScrollView>
            <View className="border-t border-border p-5">
              <Pressable
                onPress={submit}
                disabled={!startDate || !endDate || totalDays <= 0 || submitting}
                className={`h-14 items-center justify-center rounded-2xl ${
                  totalDays > 0 && !submitting ? "bg-primary" : "bg-primary/40"
                }`}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text className="text-base font-body-bold text-white">
                    Submit request
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

function RequestCard({ request }: { request: LeaveRequest }) {
  const icon =
    request.status === "approved" ? (
      <CheckCircle2 color="#15803D" size={16} />
    ) : request.status === "rejected" ? (
      <XCircle color="#B91C1C" size={16} />
    ) : (request.status as string) === "ai_escalated" ? (
      <Bot color="#F59E0B" size={16} />
    ) : (
      <Clock color="#9CA3AF" size={16} />
    );
  const labelColor =
    request.status === "approved"
      ? "text-success"
      : request.status === "rejected"
        ? "text-danger"
        : (request.status as string) === "ai_escalated"
          ? "text-amber-700"
          : "text-muted-fg";

  return (
    <View className="flex-row items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-2.5">
      {icon}
      <View className="flex-1">
        <Text className="text-base font-body-semi text-espresso">
          {request.leave_type}
        </Text>
        <Text className="text-xs font-body text-muted">
          {fmt(request.start_date)} → {fmt(request.end_date)} ·{" "}
          {request.total_days}d
        </Text>
        {request.rejection_reason ? (
          <Text className="mt-1 text-xs font-body text-danger">
            {request.rejection_reason}
          </Text>
        ) : null}
      </View>
      <Text className={`text-[10px] font-body-bold uppercase ${labelColor}`}>
        {String(request.status).replace("ai_", "").replace("_", " ")}
      </Text>
    </View>
  );
}

function fmt(s: string): string {
  return new Date(s).toLocaleDateString([], { day: "numeric", month: "short" });
}
