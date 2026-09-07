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
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import {
  ReceiptCapture,
  type CapturedPhoto,
} from "../../../components/ReceiptCapture";
import {
  DateRangeCalendar,
  type DateRange,
} from "../../../components/DateRangeCalendar";
import {
  fetchLeave,
  submitLeave,
  type LeaveBalance,
  type LeaveRequest,
} from "../../../lib/hr/api";
import { calendarDayParts } from "../../../lib/hr/myt";

// The system's leave types (apps/staff/src/lib/hr/constants.ts LEAVE_TYPES).
// "emergency" was offered here but is not a type the balances or the web app
// know — it rendered as a raw key with no balance card.
const LEAVE_TYPES = [
  { key: "annual", label: "Annual" },
  { key: "sick", label: "Sick" },
  { key: "hospitalization", label: "Hospitalisation" },
  { key: "maternity", label: "Maternity" },
  { key: "paternity", label: "Paternity" },
  { key: "replacement", label: "Replacement" },
  { key: "unpaid", label: "Unpaid" },
];

// Short human echo ("Mon, 3 Aug 2026") of a selected date.
function prettyDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-MY", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function LeaveScreen() {
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [type, setType] = useState("annual");
  // One calendar, one range (a single tap = a one-day leave).
  const [range, setRange] = useState<DateRange>({ start: null, end: null });
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // MC for sick leave — captured with the same camera component the claims
  // receipts use, so no new dependency and no new permission prompt.
  const [mc, setMc] = useState<CapturedPhoto | null>(null);
  const [mcCaptureOpen, setMcCaptureOpen] = useState(false);

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

  // Range → ISO bounds. A single-day pick (only start) counts as one day.
  const startISO = range.start;
  const endISO = range.end ?? range.start;
  const datesValid = !!startISO && !!endISO && endISO >= startISO;
  const totalDays = datesValid
    ? Math.round(
        (new Date(`${endISO}T00:00:00`).getTime() -
          new Date(`${startISO}T00:00:00`).getTime()) /
          86400000,
      ) + 1
    : 0;

  // Sick leave must carry an MC. The API refuses one without it, so without
  // this the Sick chip was a dead end on native — submit came back 400 with
  // nothing on screen to attach.
  const needsMc = type === "sick";
  // Reason is compulsory for every leave type (owner 2026-08-20).
  const reasonOk = reason.trim().length > 0;
  const canSubmit =
    datesValid && totalDays > 0 && reasonOk && !submitting && !(needsMc && !mc);

  const resetForm = () => {
    setRange({ start: null, end: null });
    setReason("");
    setMc(null);
    setType("annual");
  };

  const submit = async () => {
    if (!startISO || !endISO || totalDays <= 0) {
      Alert.alert("Pick your dates", "Choose the leave date(s) on the calendar.");
      return;
    }
    if (needsMc && !mc) {
      Alert.alert(
        "MC required",
        "Attach a photo of your medical certificate to submit sick leave.",
      );
      return;
    }
    if (!reasonOk) {
      Alert.alert("Reason required", "Tell us the reason for your leave.");
      return;
    }
    setSubmitting(true);
    try {
      // The MC uploads as a raw multipart file (mc.uri), not base64-in-JSON —
      // a full-res photo would otherwise breach the platform body limit.
      await submitLeave({
        leave_type: type,
        start_date: startISO,
        end_date: endISO,
        total_days: totalDays,
        reason: reason.trim(),
        mc: mc ? { uri: mc.uri, type: "image/jpeg" } : null,
      });
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      setSheetOpen(false);
      resetForm();
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

  // Camera as a NON-NESTED full-screen modal. Nesting it inside the request
  // pageSheet modal left the camera blank / unresponsive on iOS (the reason
  // "Take a photo of your MC" appeared to do nothing) — the working claims
  // flow early-returns the camera the same way. The request form's state lives
  // in this component, so it's intact when the camera closes.
  if (mcCaptureOpen) {
    return (
      <Modal
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setMcCaptureOpen(false)}
      >
        <ReceiptCapture
          quality={0.5}
          onCapture={(photo) => {
            setMc(photo);
            setMcCaptureOpen(false);
          }}
          onCancel={() => setMcCaptureOpen(false)}
        />
      </Modal>
    );
  }

  if (loading) {
    return (
      <Screen edges={["top", "left", "right"]}>
        <PageHeader title="Leave" back />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#A2492C" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "left", "right"]}>
      <PageHeader title="Leave" back />
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pt-4"
        contentContainerStyle={{ paddingBottom: 96 }}
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
        style={{ paddingBottom: 12 }}
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

              {needsMc && (
                <View className="mt-5">
                  <Text className="mb-2 text-xs font-body-semi uppercase tracking-wide text-muted">
                    Medical certificate <Text className="text-primary">*</Text>
                  </Text>
                  <Pressable
                    onPress={() => setMcCaptureOpen(true)}
                    className={`h-14 flex-row items-center justify-center gap-2 rounded-2xl border-2 ${
                      mc
                        ? "border-primary bg-primary-50"
                        : "border-dashed border-border bg-surface"
                    }`}
                  >
                    {mc ? (
                      <>
                        <CheckCircle2 color="#A2492C" size={18} />
                        <Text className="text-sm font-body-bold text-primary">
                          MC attached — tap to retake
                        </Text>
                      </>
                    ) : (
                      <Text className="text-sm font-body-bold text-muted-fg">
                        Take a photo of your MC
                      </Text>
                    )}
                  </Pressable>
                  <Text className="mt-1 text-[11px] font-body text-muted">
                    Required for sick leave.
                  </Text>
                </View>
              )}

              {/* Dates — one calendar, tap a start day then an end day. */}
              <Text className="mt-5 mb-2 text-xs font-body-semi uppercase tracking-wide text-muted">
                Dates <Text className="text-primary">*</Text>
              </Text>
              <DateRangeCalendar value={range} onChange={setRange} />
              {totalDays > 0 ? (
                <Text className="mt-2 text-sm font-body-bold text-primary">
                  {prettyDate(startISO!)}
                  {endISO !== startISO ? ` → ${prettyDate(endISO!)}` : ""} ·{" "}
                  {totalDays} day{totalDays === 1 ? "" : "s"}
                </Text>
              ) : (
                <Text className="mt-2 text-sm font-body text-muted">
                  Tap a day, or a start and end day for a range.
                </Text>
              )}

              <Text className="mt-5 text-xs font-body-semi uppercase tracking-wide text-muted">
                Reason <Text className="text-primary">*</Text>
              </Text>
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="Why are you taking leave?"
                placeholderTextColor="#9CA3AF"
                multiline
                className="mt-2 min-h-20 rounded-2xl border border-border bg-surface px-4 py-3 text-base font-body text-espresso"
              />
              {!reasonOk && (
                <Text className="mt-1 text-[11px] font-body text-muted">
                  A reason is required.
                </Text>
              )}
            </ScrollView>
            <View className="border-t border-border p-5">
              <Pressable
                onPress={submit}
                disabled={!canSubmit}
                className={`h-14 items-center justify-center rounded-2xl ${
                  canSubmit ? "bg-primary" : "bg-primary/40"
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
  // ai_approved is the MOST COMMON approval path (the AI leave manager writes
  // it), but the card treated only "approved" as approved — so auto-approved
  // leave showed a grey pending clock, and staff chased managers to confirm.
  const isApproved = request.status === "approved" || request.status === "ai_approved";
  const icon =
    isApproved ? (
      <CheckCircle2 color="#15803D" size={16} />
    ) : request.status === "rejected" ? (
      <XCircle color="#B91C1C" size={16} />
    ) : (request.status as string) === "ai_escalated" ? (
      <Bot color="#F59E0B" size={16} />
    ) : (
      <Clock color="#9CA3AF" size={16} />
    );
  const labelColor =
    isApproved
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

// Leave dates are plain calendar days — parsing them as `new Date(s)` gave
// UTC midnight, a day early on phones west of Greenwich.
function fmt(s: string): string {
  const p = calendarDayParts(s.slice(0, 10));
  return `${p.dayNum} ${p.monthName}`;
}

// Route-level boundary: a throw in this screen degrades to an inline retry
// card instead of unmounting the whole HR stack (see the Who's Working
// incident, docs in components/RouteErrorBoundary.tsx).
export { RouteErrorFallback as ErrorBoundary } from "../../../components/RouteErrorBoundary";
