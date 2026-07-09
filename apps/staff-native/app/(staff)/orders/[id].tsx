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
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
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
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const session = useStaff((s) => s.session);
  const tabBarHeight = useBottomTabBarHeight();
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
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#C2452D" />
        </View>
      </Screen>
    );
  }

  if (!order) {
    return (
      <Screen>
        <PageHeader title="Purchase Order" back />
        <View className="flex-1 items-center justify-center">
          <Text className="text-sm font-body text-muted-fg">PO not found</Text>
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
        contentContainerStyle={{ paddingBottom: tabBarHeight + 96 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor="#C2452D"
            colors={["#C2452D"]}
          />
        }
      >
        {/* Status + meta */}
        <View className="rounded-3xl border border-border bg-surface px-4 py-3.5">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <View className="h-11 w-11 items-center justify-center rounded-2xl bg-primary-50">
                <Truck color="#C2452D" size={20} />
              </View>
              <View>
                <Text className="text-base font-body-bold text-espresso">
                  {order.supplier}
                </Text>
                <Text className="text-xs font-body text-muted-fg">
                  {order.outlet}
                </Text>
              </View>
            </View>
            <Pill label={tone.label} tone={tone.tone} />
          </View>
          <View className="mt-3 flex-row items-center justify-between border-t border-border pt-3">
            <Text className="text-xs font-body text-muted-fg">Total</Text>
            <Text className="text-lg font-body-bold text-espresso tabular-nums">
              RM {Number(order.totalAmount ?? 0).toFixed(2)}
            </Text>
          </View>
          {order.deliveryDate ? (
            <View className="mt-2 flex-row items-center justify-between">
              <Text className="text-xs font-body text-muted-fg">Delivery</Text>
              <Text className="text-xs font-body-bold text-espresso">
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
              className="mt-3 flex-row items-center gap-2 rounded-2xl bg-primary-50 px-3 py-2 active:opacity-80"
            >
              <Phone color="#C2452D" size={16} />
              <Text className="text-sm font-body-bold text-primary">
                Call {order.supplierPhone}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* Items */}
        <Text className="mt-5 mb-2 text-xs font-body-semi uppercase tracking-wider text-muted">
          Items ({order.items?.length ?? 0})
        </Text>
        <View className="gap-2">
          {(order.items ?? []).map((item) => (
            <View
              key={item.id}
              className="rounded-3xl border border-border bg-surface px-4 py-3"
            >
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1">
                  <Text
                    className="text-base font-body-bold text-espresso"
                    numberOfLines={2}
                  >
                    {item.product}
                  </Text>
                  <Text className="mt-0.5 text-xs font-body text-muted-fg">
                    {item.quantity} × {item.package || item.uom} ·{" "}
                    {item.sku}
                  </Text>
                  {item.notes ? (
                    <Text className="mt-1 text-xs font-body text-muted-fg">
                      {item.notes}
                    </Text>
                  ) : null}
                </View>
                <Text className="text-base font-body-bold text-espresso tabular-nums">
                  RM {Number(item.totalPrice ?? 0).toFixed(2)}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* Notes */}
        {order.notes ? (
          <>
            <Text className="mt-5 mb-2 text-xs font-body-semi uppercase tracking-wider text-muted">
              Notes
            </Text>
            <View className="rounded-3xl border border-border bg-surface px-4 py-3">
              <Text className="text-sm font-body text-espresso">
                {order.notes}
              </Text>
            </View>
          </>
        ) : null}

        {/* Linked invoices */}
        {order.invoices && order.invoices.length > 0 ? (
          <>
            <Text className="mt-5 mb-2 text-xs font-body-semi uppercase tracking-wider text-muted">
              Invoices ({order.invoices.length})
            </Text>
            <View className="gap-2">
              {order.invoices.map((inv) => (
                <Pressable
                  key={inv.id}
                  onPress={() =>
                    router.push(`/(staff)/invoices/${inv.id}` as never)
                  }
                  className="flex-row items-center justify-between rounded-3xl border border-border bg-surface px-4 py-3 active:bg-primary-50"
                >
                  <View>
                    <Text className="text-base font-body-bold text-espresso">
                      {inv.invoiceNumber}
                    </Text>
                    <Text className="text-xs font-body text-muted-fg">
                      {inv.status}
                      {inv.dueDate
                        ? ` · due ${new Date(inv.dueDate).toLocaleDateString([], { day: "numeric", month: "short" })}`
                        : ""}
                    </Text>
                  </View>
                  <Text className="text-base font-body-bold text-espresso tabular-nums">
                    RM {Number(inv.amount).toFixed(2)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {/* Audit trail */}
        <Text className="mt-5 mb-2 text-xs font-body-semi uppercase tracking-wider text-muted">
          Activity
        </Text>
        <View className="rounded-3xl border border-border bg-surface px-4 py-3 gap-1.5">
          <Text className="text-xs font-body text-muted-fg">
            Created by {order.createdBy} ·{" "}
            {new Date(order.createdAt).toLocaleDateString([], {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </Text>
          {order.approvedAt && order.approvedBy ? (
            <Text className="text-xs font-body text-muted-fg">
              Approved by {order.approvedBy} ·{" "}
              {new Date(order.approvedAt).toLocaleDateString([], {
                day: "numeric",
                month: "short",
              })}
            </Text>
          ) : null}
          {order.sentAt ? (
            <Text className="text-xs font-body text-muted-fg">
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
            paddingBottom: tabBarHeight + 12,
            shadowColor: "#160800",
            shadowOffset: { width: 0, height: -4 },
            shadowOpacity: 0.06,
            shadowRadius: 12,
          }}
          className="absolute inset-x-0 bottom-0 bg-background px-4 pt-3 pb-3"
        >
          <View className="flex-row gap-2">
            {canCancel ? (
              <Pressable
                onPress={confirmCancel}
                disabled={!!acting}
                className="h-12 flex-row items-center justify-center gap-1.5 rounded-2xl border border-danger/30 px-4 active:bg-danger/5"
              >
                <XIcon color="#EF4444" size={16} />
                <Text className="text-sm font-body-bold text-danger">
                  Cancel
                </Text>
              </Pressable>
            ) : null}
            {canApprove ? (
              <Pressable
                onPress={doApprove}
                disabled={!!acting}
                className={`h-12 flex-1 flex-row items-center justify-center gap-1.5 rounded-2xl ${
                  acting === "approve" ? "bg-primary/50" : "bg-primary active:opacity-90"
                }`}
              >
                {acting === "approve" ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Check color="#FFFFFF" size={16} />
                    <Text className="text-sm font-body-bold text-white">
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
                  acting === "send" ? "bg-primary/50" : "bg-primary active:opacity-90"
                }`}
              >
                {acting === "send" ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Send color="#FFFFFF" size={16} />
                    <Text className="text-sm font-body-bold text-white">
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
