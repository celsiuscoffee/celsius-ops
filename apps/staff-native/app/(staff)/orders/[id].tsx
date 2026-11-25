import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  Check,
  Phone,
  Send,
  Truck,
  X as XIcon,
} from "lucide-react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { Pill } from "../../../components/ui";
import { useStaff } from "../../../lib/store";
import {
  approveOrder,
  cancelOrder,
  getOrder,
  sendOrder,
  type OrderDetail,
} from "../../../lib/ops/orders";
import { useCelsius } from "../../../lib/celsius-ui";

type Tone = "success" | "danger" | "brand" | "muted" | "warning";
const STATUS_TONE: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "muted" },
  PENDING_APPROVAL: { label: "Pending approval", tone: "warning" },
  APPROVED: { label: "Approved", tone: "brand" },
  SENT: { label: "Sent", tone: "brand" },
  AWAITING_DELIVERY: { label: "Awaiting delivery", tone: "brand" },
  PARTIALLY_RECEIVED: { label: "Partial", tone: "warning" },
  COMPLETED: { label: "Completed", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
};

export default function OrderDetailScreen() {
  const C = useCelsius().color;
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const session = useStaff((s) => s.session);
  const isManager =
    session?.role === "OWNER" ||
    session?.role === "ADMIN" ||
    session?.role === "MANAGER";

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState<null | "approve" | "send" | "cancel">(
    null,
  );

  const load = useCallback(async () => {
    try {
      const data = await getOrder(id);
      setOrder(data as unknown as OrderDetail);
    } catch (e) {
      Alert.alert(
        "Couldn't load PO",
        e instanceof Error ? e.message : "Try again.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function doApprove() {
    if (!order) return;
    setActing("approve");
    try {
      await approveOrder(order.id);
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      load();
    } catch (e) {
      Alert.alert(
        "Couldn't approve",
        e instanceof Error ? e.message : "Try again.",
      );
    } finally {
      setActing(null);
    }
  }

  async function doSend() {
    if (!order) return;
    setActing("send");
    try {
      await sendOrder(order.id);
      // Try to open WhatsApp with a pre-filled message to the supplier.
      // Best-effort, if the supplier has no phone, just shows the status
      // change confirmation.
      const phone = order.supplierPhone?.replace(/\D/g, "");
      if (phone) {
        const msg = encodeURIComponent(
          `Hi ${order.supplier},\n\nPlease find attached PO ${order.orderNumber} for ${order.outlet}. Total: RM ${Number(order.totalAmount ?? 0).toFixed(2)}.\n\nThanks!`,
        );
        Linking.openURL(`https://wa.me/${phone}?text=${msg}`).catch(() => {});
      }
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      load();
    } catch (e) {
      Alert.alert(
        "Couldn't send",
        e instanceof Error ? e.message : "Try again.",
      );
    } finally {
      setActing(null);
    }
  }

  function confirmCancel() {
    Alert.alert(
      "Cancel PO?",
      "This can't be undone. Cancellation is blocked if any payment has already been initiated.",
      [
        { text: "Keep PO", style: "cancel" },
        {
          text: "Cancel PO",
          style: "destructive",
          onPress: async () => {
            if (!order) return;
            setActing("cancel");
            try {
              await cancelOrder(order.id);
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              ).catch(() => {});
              load();
            } catch (e) {
              Alert.alert(
                "Couldn't cancel",
                e instanceof Error ? e.message : "Try again.",
              );
            } finally {
              setActing(null);
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <Screen edges={["top", "left", "right"]}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={C["text-3"]} />
        </View>
      </Screen>
    );
  }

  if (!order) {
    return (
      <Screen edges={["top", "left", "right"]}>
        <PageHeader title="Purchase order" back />
        <View className="flex-1 items-center justify-center">
          <Text className="text-sm font-body text-text-2">PO not found</Text>
        </View>
      </Screen>
    );
  }

  const tone = STATUS_TONE[order.status] ?? {
    label: order.status,
    tone: "muted" as Tone,
  };

  const canApprove =
    isManager &&
    (order.status === "DRAFT" || order.status === "PENDING_APPROVAL");
  const canSend =
    isManager &&
    (order.status === "APPROVED" || order.status === "DRAFT");
  const canCancel =
    isManager &&
    order.status !== "COMPLETED" &&
    order.status !== "CANCELLED";

  return (
    <Screen
      edges={
        canApprove || canSend || canCancel
          ? ["top", "left", "right"]
          : undefined
      }
    >
      <PageHeader title={order.orderNumber} subtitle={order.supplier} back />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 96 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={C["text-3"]}
            colors={[C["text-3"]]}
          />
        }
      >
        {/* Status + meta */}
        <View className="rounded-2xl border border-line bg-surface px-4 py-3.5">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <View className="h-11 w-11 items-center justify-center rounded-2xl bg-sunken">
                <Truck color={C["text-2"]} size={20} />
              </View>
              <View>
                <Text className="text-base font-body-bold text-text">
                  {order.supplier}
                </Text>
                <Text className="text-xs font-body text-text-2">
                  {order.outlet}
                </Text>
              </View>
            </View>
            <Pill label={tone.label} tone={tone.tone} />
          </View>
          <View className="mt-3 flex-row items-center justify-between border-t border-line pt-3">
            <Text className="text-xs font-body text-text-2">Total</Text>
            <Text className="text-lg font-body-bold text-text tabular-nums">
              RM {Number(order.totalAmount ?? 0).toFixed(2)}
            </Text>
          </View>
          {order.deliveryDate ? (
            <View className="mt-2 flex-row items-center justify-between">
              <Text className="text-xs font-body text-text-2">Delivery</Text>
              <Text className="text-xs font-body-bold text-text">
                {new Date(order.deliveryDate).toLocaleDateString([], {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
              </Text>
            </View>
          ) : null}
          {order.supplierPhone ? (
            <Pressable
              onPress={() => Linking.openURL(`tel:${order.supplierPhone}`)}
              className="mt-3 flex-row items-center gap-2 rounded-2xl bg-sunken px-3 py-2 active:opacity-80"
            >
              <Phone color={C["text-2"]} size={16} />
              <Text className="text-sm font-body-bold text-text">
                Call {order.supplierPhone}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* Items */}
        <Text className="mt-5 mb-2 text-sm font-body-semi text-text-2">
          Items ({order.items?.length ?? 0})
        </Text>
        <View className="gap-2">
          {(order.items ?? []).map((item) => (
            <View
              key={item.id}
              className="rounded-2xl border border-line bg-surface px-4 py-3"
            >
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1">
                  <Text
                    className="text-base font-body-bold text-text"
                    numberOfLines={2}
                  >
                    {item.product}
                  </Text>
                  <Text className="mt-0.5 text-xs font-body text-text-2">
                    {item.quantity} × {item.package || item.uom} ·{" "}
                    {item.sku}
                  </Text>
                  {item.notes ? (
                    <Text className="mt-1 text-xs font-body text-text-2">
                      {item.notes}
                    </Text>
                  ) : null}
                </View>
                <Text className="text-base font-body-bold text-text tabular-nums">
                  RM {Number(item.totalPrice ?? 0).toFixed(2)}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* Notes */}
        {order.notes ? (
          <>
            <Text className="mt-5 mb-2 text-sm font-body-semi text-text-2">
              Notes
            </Text>
            <View className="rounded-2xl border border-line bg-surface px-4 py-3">
              <Text className="text-sm font-body text-text">
                {order.notes}
              </Text>
            </View>
          </>
        ) : null}

        {/* Linked invoices */}
        {order.invoices && order.invoices.length > 0 ? (
          <>
            <Text className="mt-5 mb-2 text-sm font-body-semi text-text-2">
              Invoices ({order.invoices.length})
            </Text>
            <View className="gap-2">
              {order.invoices.map((inv) => (
                <Pressable
                  key={inv.id}
                  onPress={() =>
                    router.push(`/(staff)/invoices/${inv.id}` as never)
                  }
                  className="flex-row items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 active:bg-sunken"
                >
                  <View>
                    <Text className="text-base font-body-bold text-text">
                      {inv.invoiceNumber}
                    </Text>
                    <Text className="text-xs font-body text-text-2">
                      {inv.status}
                      {inv.dueDate
                        ? ` · due ${new Date(inv.dueDate).toLocaleDateString([], { day: "numeric", month: "short" })}`
                        : ""}
                    </Text>
                  </View>
                  <Text className="text-base font-body-bold text-text tabular-nums">
                    RM {Number(inv.amount).toFixed(2)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {/* Audit trail */}
        <Text className="mt-5 mb-2 text-sm font-body-semi text-text-2">
          Activity
        </Text>
        <View className="rounded-2xl border border-line bg-surface px-4 py-3 gap-1.5">
          <Text className="text-xs font-body text-text-2">
            Created by {order.createdBy} ·{" "}
            {new Date(order.createdAt).toLocaleDateString([], {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </Text>
          {order.approvedAt && order.approvedBy ? (
            <Text className="text-xs font-body text-text-2">
              Approved by {order.approvedBy} ·{" "}
              {new Date(order.approvedAt).toLocaleDateString([], {
                day: "numeric",
                month: "short",
              })}
            </Text>
          ) : null}
          {order.sentAt ? (
            <Text className="text-xs font-body text-text-2">
              Sent to supplier ·{" "}
              {new Date(order.sentAt).toLocaleDateString([], {
                day: "numeric",
                month: "short",
              })}
            </Text>
          ) : null}
        </View>
      </ScrollView>

      {/* Manager actions, pinned bottom */}
      {(canApprove || canSend || canCancel) && (
        <View
          style={{
            paddingBottom: 12,
            shadowColor: C.text,
            shadowOffset: { width: 0, height: -4 },
            shadowOpacity: 0.06,
            shadowRadius: 12,
          }}
          className="absolute inset-x-0 bottom-0 bg-bg px-4 pt-3 pb-3"
        >
          <View className="flex-row gap-2">
            {canCancel ? (
              <Pressable
                onPress={confirmCancel}
                disabled={!!acting}
                className="h-12 flex-row items-center justify-center gap-1.5 rounded-2xl border border-danger px-4 active:bg-danger-soft"
              >
                <XIcon color={C.danger} size={16} />
                <Text className="text-sm font-body-bold text-danger-text">
                  Cancel
                </Text>
              </Pressable>
            ) : null}
            {canApprove ? (
              <Pressable
                onPress={doApprove}
                disabled={!!acting}
                className={`h-12 flex-1 flex-row items-center justify-center gap-1.5 rounded-2xl ${
                  acting === "approve" ? "bg-ink opacity-50" : "bg-ink active:opacity-90"
                }`}
              >
                {acting === "approve" ? (
                  <ActivityIndicator color={C["on-ink"]} size="small" />
                ) : (
                  <>
                    <Check color={C["on-ink"]} size={16} />
                    <Text className="text-sm font-body-bold text-on-ink">
                      Approve
                    </Text>
                  </>
                )}
              </Pressable>
            ) : null}
            {canSend ? (
              <Pressable
                onPress={doSend}
                disabled={!!acting}
                className={`h-12 flex-1 flex-row items-center justify-center gap-1.5 rounded-2xl ${
                  acting === "send" ? "bg-ink opacity-50" : "bg-ink active:opacity-90"
                }`}
              >
                {acting === "send" ? (
                  <ActivityIndicator color={C["on-ink"]} size="small" />
                ) : (
                  <>
                    <Send color={C["on-ink"]} size={16} />
                    <Text className="text-sm font-body-bold text-on-ink">
                      Send via WhatsApp
                    </Text>
                  </>
                )}
              </Pressable>
            ) : null}
          </View>
        </View>
      )}
    </Screen>
  );
}
