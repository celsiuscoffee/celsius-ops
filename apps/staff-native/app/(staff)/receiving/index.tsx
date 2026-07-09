import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
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
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import {
  AlertTriangle,
  Camera,
  Check,
  Package,
  Truck,
  X,
} from "lucide-react-native";
import { useStaff } from "../../../lib/store";
import {
  createReceiving,
  listPendingOrders,
  listRecentReceivings,
  type PendingOrder,
  type ReceivingRecord,
} from "../../../lib/ops/inventory";
import {
  ReceiptCapture,
  type CapturedPhoto,
} from "../../../components/ReceiptCapture";
import { uploadPhoto } from "../../../lib/upload";

const PENDING_STATUSES = ["SENT", "AWAITING_DELIVERY", "PARTIALLY_RECEIVED"];

type ReceivedRow = {
  qty: string;
  expiryDate?: string;
  discrepancyReason?: string;
};

export default function ReceivingPage() {
  const session = useStaff((s) => s.session);
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [recent, setRecent] = useState<ReceivingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PendingOrder | null>(null);
  const [received, setReceived] = useState<Record<string, ReceivedRow>>({});
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ordersData, recentData] = await Promise.all([
        listPendingOrders().catch(
          () => ({ items: [] }) as { items: PendingOrder[] },
        ),
        listRecentReceivings().catch(() => [] as ReceivingRecord[]),
      ]);
      const ords = Array.isArray(ordersData)
        ? ordersData
        : ordersData.items ?? [];
      setOrders(ords.filter((o) => PENDING_STATUSES.includes(o.status)));
      const recs = Array.isArray(recentData)
        ? recentData
        : recentData.data ?? [];
      setRecent(recs.slice(0, 5));
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

  const openPO = (po: PendingOrder) => {
    setSelectedPO(po);
    // pre-fill ordered quantities (happy path)
    const prefill: Record<string, ReceivedRow> = {};
    for (const item of po.items) {
      prefill[item.id] = { qty: String(item.quantity) };
    }
    setReceived(prefill);
    setPhotos([]);
  };

  const updateQty = (itemId: string, qty: string) => {
    setReceived((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? { qty: "" }), qty },
    }));
  };

  const stepQty = (itemId: string, delta: number, ordered: number) => {
    setReceived((prev) => {
      const cur = parseFloat(prev[itemId]?.qty ?? String(ordered));
      const next = Math.max(0, cur + delta);
      return {
        ...prev,
        [itemId]: { ...(prev[itemId] ?? { qty: "" }), qty: String(next) },
      };
    });
    Haptics.selectionAsync().catch(() => {});
  };

  const setDiscrepancyReason = (itemId: string, reason: string) => {
    setReceived((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? { qty: "" }), discrepancyReason: reason },
    }));
  };

  const handleCapture = async (photo: CapturedPhoto) => {
    setCameraOpen(false);
    setUploadingPhoto(true);
    try {
      const url = await uploadPhoto(photo);
      setPhotos((p) => [...p, url]);
    } catch (e) {
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Try again.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const submit = async () => {
    if (!selectedPO || !session?.outletId) return;
    setSubmitting(true);
    try {
      await createReceiving({
        orderId: selectedPO.id,
        outletId: session.outletId,
        supplierId: selectedPO.supplierId,
        items: selectedPO.items.map((item) => {
          const r = received[item.id];
          const qty = parseFloat(r?.qty ?? "0") || 0;
          return {
            productId: item.productId,
            orderedQty: item.quantity,
            receivedQty: qty,
            expiryDate: r?.expiryDate || undefined,
            discrepancyReason:
              qty !== item.quantity
                ? r?.discrepancyReason || "Quantity mismatch"
                : undefined,
          };
        }),
        notes: null,
        invoicePhotos: photos,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {},
      );
      Alert.alert("Recorded", "Inventory will be updated shortly.");
      setSelectedPO(null);
      setReceived({});
      setPhotos([]);
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

  if (cameraOpen) {
    return (
      <Modal animationType="slide" presentationStyle="fullScreen">
        <ReceiptCapture
          onCapture={handleCapture}
          onCancel={() => setCameraOpen(false)}
        />
      </Modal>
    );
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#A2492C" />
      </View>
    );
  }

  // Receive detail view
  if (selectedPO) {
    return (
      <ReceiveDetail
        po={selectedPO}
        received={received}
        photos={photos}
        uploadingPhoto={uploadingPhoto}
        submitting={submitting}
        onBack={() => setSelectedPO(null)}
        onUpdateQty={updateQty}
        onStepQty={stepQty}
        onSetReason={setDiscrepancyReason}
        onOpenCamera={() => setCameraOpen(true)}
        onRemovePhoto={(i) => setPhotos((p) => p.filter((_, idx) => idx !== i))}
        onSubmit={submit}
      />
    );
  }

  return (
    <Screen edges={["top", "left", "right"]}>
      <PageHeader title="Receive" back />
      <FlatList
        className="flex-1"
        data={orders}
        keyExtractor={(o) => o.id}
        contentContainerClassName="pt-2 pb-12"
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
      ListHeaderComponent={
        <View>
          <View className="flex-row items-center gap-2">
            <Truck color="#A2492C" size={16} />
            <Text className="text-base font-body-semi text-espresso">
              Expected today
            </Text>
            <View className="rounded-full bg-primary-50 px-2 py-0.5">
              <Text className="text-[10px] font-body-bold text-primary">
                {orders.length}
              </Text>
            </View>
          </View>
        </View>
      }
      ListEmptyComponent={
        <View className="mt-6 items-center py-8">
          <Truck color="#D1D5DB" size={32} />
          <Text className="mt-2 text-sm font-body text-muted">
            No pending deliveries
          </Text>
        </View>
      }
      ItemSeparatorComponent={() => <View className="h-2" />}
      renderItem={({ item: po }) => (
        <Pressable
          onPress={() => openPO(po)}
          className="rounded-2xl border border-border bg-surface px-3 py-3 active:bg-primary-50"
        >
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text className="text-base font-body-medium text-espresso">
                {po.supplier}
              </Text>
              <Text className="text-xs font-body text-muted">
                {po.orderNumber} · {po.items.length} item
                {po.items.length === 1 ? "" : "s"} · RM{" "}
                {Number(po.totalAmount ?? 0).toFixed(2)}
              </Text>
            </View>
            <View className="items-end gap-1">
              {po.status === "PARTIALLY_RECEIVED" ? (
                <View className="rounded-full bg-amber-100 px-2 py-0.5">
                  <Text className="text-[10px] font-body-bold text-amber-700">
                    Partial
                  </Text>
                </View>
              ) : null}
              <Package color="#9CA3AF" size={16} />
            </View>
          </View>
        </Pressable>
      )}
      ListFooterComponent={
        recent.length > 0 ? (
          <View className="mt-6">
            <Text className="mb-2 text-xs font-body-semi uppercase tracking-wide text-muted">
              Recently received
            </Text>
            <View className="gap-1.5">
              {recent.map((r) => (
                <View
                  key={r.id}
                  className="flex-row items-center justify-between rounded-2xl border border-border bg-surface px-3 py-2.5"
                >
                  <View className="flex-1">
                    <Text className="text-base font-body-medium text-espresso">
                      {r.supplier}
                    </Text>
                    <Text className="text-xs font-body text-muted">
                      {r.orderNumber} · {fmtRelative(r.receivedAt)}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <Text className="text-xs font-body text-muted">
                      {r.items.length} item{r.items.length === 1 ? "" : "s"}
                    </Text>
                    {r.status === "COMPLETE" ? (
                      <Check color="#15803D" size={16} />
                    ) : (
                      <AlertTriangle color="#F59E0B" size={16} />
                    )}
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null
      }
      showsVerticalScrollIndicator={false}
    />
    </Screen>
  );
}

function ReceiveDetail({
  po,
  received,
  photos,
  uploadingPhoto,
  submitting,
  onBack,
  onUpdateQty,
  onStepQty,
  onSetReason,
  onOpenCamera,
  onRemovePhoto,
  onSubmit,
}: {
  po: PendingOrder;
  received: Record<string, ReceivedRow>;
  photos: string[];
  uploadingPhoto: boolean;
  submitting: boolean;
  onBack: () => void;
  onUpdateQty: (id: string, qty: string) => void;
  onStepQty: (id: string, delta: number, ordered: number) => void;
  onSetReason: (id: string, reason: string) => void;
  onOpenCamera: () => void;
  onRemovePhoto: (i: number) => void;
  onSubmit: () => void;
}) {
  const insets = useSafeAreaInsets();
  const allFilled = useMemo(
    () => po.items.every((item) => (received[item.id]?.qty ?? "") !== ""),
    [po.items, received],
  );
  const hasPhoto = photos.length > 0;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View className="flex-1 bg-background">
        {/* Sticky PO header, paddingTop clears the status bar / Dynamic
            Island so the close button is always tappable. */}
        <View
          className="flex-row items-center justify-between border-b border-border bg-background px-5 pb-4"
          style={{ paddingTop: insets.top + 12 }}
        >
          <View className="flex-1">
            <Text className="text-base font-body-semi text-espresso">
              {po.supplier}
            </Text>
            <Text className="text-xs font-body text-muted">{po.orderNumber}</Text>
          </View>
          <Pressable
            onPress={onBack}
            className="h-9 w-9 items-center justify-center rounded-full bg-primary-50"
          >
            <X color="#A2492C" size={16} />
          </Pressable>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerClassName="px-5 pt-4"
          contentContainerStyle={{ paddingBottom: 96 }}
          keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
          {/* Items */}
          <View className="gap-2">
            {po.items.map((item) => {
              const r = received[item.id];
              const num = parseFloat(r?.qty ?? "");
              const isMatch = !isNaN(num) && num === item.quantity;
              const isShort = !isNaN(num) && num < item.quantity;
              const isOver = !isNaN(num) && num > item.quantity;
              return (
                <View
                  key={item.id}
                  className={`rounded-2xl border bg-surface p-3 ${
                    isShort
                      ? "border-danger/30"
                      : isOver
                        ? "border-amber-500/30"
                        : isMatch
                          ? "border-success/30"
                          : "border-border"
                  }`}
                >
                  <View className="flex-row items-start justify-between">
                    <View className="flex-1 pr-2">
                      <Text className="text-base font-body-medium text-espresso">
                        {item.product}
                      </Text>
                      <Text className="text-xs font-body text-muted">
                        Ordered {item.quantity} {item.uom} · RM{" "}
                        {Number(item.unitPrice ?? 0).toFixed(2)}/{item.uom}
                      </Text>
                    </View>
                    {isMatch ? (
                      <Check color="#15803D" size={20} />
                    ) : isShort ? (
                      <View className="rounded-full bg-danger/10 px-2 py-0.5">
                        <Text className="text-[10px] font-body-bold text-danger">
                          Short {(item.quantity - num).toFixed(0)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <View className="mt-3 flex-row items-center gap-2">
                    <Pressable
                      onPress={() => onStepQty(item.id, -1, item.quantity)}
                      className="h-11 w-11 items-center justify-center rounded-xl bg-primary-50 active:opacity-80"
                    >
                      <Text className="text-xl font-display text-primary">−</Text>
                    </Pressable>
                    <TextInput
                      value={r?.qty ?? ""}
                      onChangeText={(t) => onUpdateQty(item.id, t)}
                      keyboardType="decimal-pad"
                      className="h-11 min-w-24 flex-1 rounded-xl border border-border bg-surface px-3 text-center text-base font-body-bold text-espresso tabular-nums"
                    />
                    <Pressable
                      onPress={() => onStepQty(item.id, 1, item.quantity)}
                      className="h-11 w-11 items-center justify-center rounded-xl bg-primary-50 active:opacity-80"
                    >
                      <Text className="text-xl font-display text-primary">+</Text>
                    </Pressable>
                    <Text className="text-xs font-body text-muted">
                      {item.uom}
                    </Text>
                    {!isMatch ? (
                      <Pressable
                        onPress={() =>
                          onUpdateQty(item.id, String(item.quantity))
                        }
                        className="ml-auto rounded-full bg-success/10 px-2 py-1"
                      >
                        <Text className="text-[10px] font-body-bold text-success">
                          Match
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {(isShort || isOver) ? (
                    <TextInput
                      value={r?.discrepancyReason ?? ""}
                      onChangeText={(t) => onSetReason(item.id, t)}
                      placeholder="Reason for discrepancy…"
                      placeholderTextColor="#9CA3AF"
                      className="mt-2 h-10 rounded-xl border border-border bg-surface px-3 text-sm font-body text-espresso"
                    />
                  ) : null}
                </View>
              );
            })}
          </View>

          {/* Invoice photos */}
          <View className="mt-5">
            <Text className="mb-2 text-xs font-body-semi uppercase tracking-wide text-muted">
              Invoice photo
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {photos.map((url, i) => (
                <View key={i} className="relative">
                  <Image
                    source={{ uri: url }}
                    style={{ width: 80, height: 80, borderRadius: 12 }}
                  />
                  <Pressable
                    onPress={() => onRemovePhoto(i)}
                    className="absolute -right-1 -top-1 h-5 w-5 items-center justify-center rounded-full bg-black/70"
                  >
                    <X color="#FFFFFF" size={10} />
                  </Pressable>
                </View>
              ))}
              {uploadingPhoto ? (
                <View
                  className="items-center justify-center rounded-xl border-2 border-dashed border-primary/40"
                  style={{ width: 80, height: 80 }}
                >
                  <ActivityIndicator color="#A2492C" size="small" />
                </View>
              ) : (
                <Pressable
                  onPress={onOpenCamera}
                  className="items-center justify-center rounded-xl border-2 border-dashed border-border active:bg-primary-50"
                  style={{ width: 80, height: 80 }}
                >
                  <Camera color="#9CA3AF" size={20} />
                  <Text className="mt-1 text-[10px] font-body text-muted">
                    Add
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </ScrollView>

        {/* Pinned bottom submit */}
        <View
          style={{ paddingBottom: 12 }}
          className="absolute inset-x-0 bottom-0 border-t border-border bg-background px-5 pt-3"
        >
          {!hasPhoto ? (
            <View className="mb-2 flex-row items-center gap-2 rounded-xl bg-amber-50 px-3 py-2">
              <AlertTriangle color="#B45309" size={16} />
              <Text className="flex-1 text-xs font-body text-amber-700">
                No photo attached. Add the invoice or delivery order so this
                receiving can be verified.
              </Text>
            </View>
          ) : null}
          <Pressable
            onPress={onSubmit}
            disabled={!allFilled || submitting}
            className={`h-16 items-center justify-center rounded-2xl ${
              allFilled && !submitting ? "bg-primary" : "bg-primary/40"
            }`}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text className="text-base font-body-bold text-white">
                {hasPhoto ? "Confirm receiving" : "Confirm without photo"}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function fmtRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}
