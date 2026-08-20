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

// Free-text date → ISO. Staff type dates the Malaysian way (27/7/2026,
// 27-07-2026), but only strict ISO used to validate, so the day-count and
// submit button silently never enabled — "apply tak boleh" reports with no
// error shown. Accept day-first D/M/Y with /, - or . separators (2-digit
// years → 20xx) plus ISO, and round-trip through Date so 31/2 can't sneak by.
export function parseLeaveDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match: RegExpMatchArray | null;
  if ((match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  } else if ((match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) {
    d = Number(match[1]); m = Number(match[2]); y = Number(match[3]);
    if (match[3].length <= 2) y += 2000;
  } else {
    return null;
  }
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  // Round-trip: JS rolls invalid days forward (31 Feb → 2/3 Mar) — reject those.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

// Short human echo ("Mon, 3 Aug 2026") so the typist can confirm the app
// understood their date the way they meant it.
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
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
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

  // Normalize free-text input to ISO before computing anything (see
  // parseLeaveDate — accepts 27/7/2026-style local input, rejects rolled-over
  // dates so total_days can never POST as null).
  const startISO = parseLeaveDate(startDate);
  const endISO = parseLeaveDate(endDate);
  const datesValid = !!startISO && !!endISO && endISO >= startISO;
  const totalDays = datesValid
    ? Math.ceil(
        (new Date(endISO!).getTime() - new Date(startISO!).getTime()) /
          (1000 * 60 * 60 * 24),
      ) + 1
    : 0;

  // Sick leave must carry an MC. The API refuses one without it, so without
  // this the Sick chip was a dead end on native — submit came back 400 with
  // nothing on screen to attach.
  const needsMc = type === "sick";

  const submit = async () => {
    if (!startISO || !endISO || totalDays <= 0) return;
    if (needsMc && !mc) {
      Alert.alert(
        "MC required",
        "Attach a photo of your medical certificate to submit sick leave.",
      );
      return;
    }
    setSubmitting(true);
    try {
      // The MC goes up as a raw multipart file (mc.uri), not base64-in-JSON —
      // see submitLeave. This is what fixes the old "retake, it's too large"
      // dead-end: a full-res iOS photo now uploads without the base64 33%
      // inflation that used to breach the platform body limit.
      await submitLeave({
        leave_type: type,
        start_date: startISO,
        end_date: endISO,
        total_days: totalDays,
        reason,
        mc: mc ? { uri: mc.uri, type: "image/jpeg" } : null,
      });
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      setSheetOpen(false);
      setStartDate("");
      setEndDate("");
      setReason("");
      setMc(null);
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

              <View className="mt-5 flex-row gap-3">
                <View className="flex-1">
                  <Text className="mb-2 text-xs font-body-semi uppercase tracking-wide text-muted">
                    From
                  </Text>
                  <TextInput
                    value={startDate}
                    onChangeText={setStartDate}
                    placeholder="27/7/2026"
                    placeholderTextColor="#9CA3AF"
                    autoCapitalize="none"
                    keyboardType="numbers-and-punctuation"
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
                    placeholder="27/7/2026"
                    placeholderTextColor="#9CA3AF"
                    autoCapitalize="none"
                    keyboardType="numbers-and-punctuation"
                    className="h-14 rounded-2xl border border-border bg-surface px-4 text-base font-body text-espresso"
                  />
                </View>
              </View>
              {/* Feedback row: previously a bad format failed SILENTLY — no day
                  count, submit stuck disabled, no reason shown. Always tell the
                  typist what the app understood or what's wrong. */}
              {totalDays > 0 ? (
                <Text className="mt-2 text-sm font-body-bold text-primary">
                  {prettyDate(startISO!)} → {prettyDate(endISO!)} · {totalDays} day
                  {totalDays === 1 ? "" : "s"}
                </Text>
              ) : (startDate.trim() && !startISO) || (endDate.trim() && !endISO) ? (
                <Text className="mt-2 text-sm font-body text-red-600">
                  Can&apos;t read the date — try 27/7/2026 or 2026-07-27
                </Text>
              ) : startISO && endISO && endISO < startISO ? (
                <Text className="mt-2 text-sm font-body text-red-600">
                  End date is before start date
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
                disabled={
                  !startDate ||
                  !endDate ||
                  totalDays <= 0 ||
                  submitting ||
                  (needsMc && !mc)
                }
                className={`h-14 items-center justify-center rounded-2xl ${
                  totalDays > 0 && !submitting && !(needsMc && !mc)
                    ? "bg-primary"
                    : "bg-primary/40"
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

      {/* MC camera — same component the claims receipts use. The MC now
          uploads as a raw multipart file (no base64 inflation), so the old
          ~4.5MB JSON-body ceiling no longer applies. We still cap edge size
          and drop the JPEG quality a notch to keep the upload quick on outlet
          Wi-Fi; the MC only needs to be legible, not archival. */}
      <Modal
        visible={mcCaptureOpen}
        animationType="slide"
        onRequestClose={() => setMcCaptureOpen(false)}
      >
        <ReceiptCapture
          maxEdgePx={1600}
          quality={0.5}
          onCapture={(photo) => {
            setMc(photo);
            setMcCaptureOpen(false);
          }}
          onCancel={() => setMcCaptureOpen(false)}
        />
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

function fmt(s: string): string {
  return new Date(s).toLocaleDateString([], { day: "numeric", month: "short" });
}

// Route-level boundary: a throw in this screen degrades to an inline retry
// card instead of unmounting the whole HR stack (see the Who's Working
// incident, docs in components/RouteErrorBoundary.tsx).
export { RouteErrorFallback as ErrorBoundary } from "../../../components/RouteErrorBoundary";
