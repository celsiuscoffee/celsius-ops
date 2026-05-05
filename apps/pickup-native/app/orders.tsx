import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Stack, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  ClipboardList,
  RefreshCw,
  ChevronRight,
  CheckCircle2,
  Clock,
  XCircle,
  Coffee,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { EspressoHeader } from "../components/EspressoHeader";
import { BottomNav } from "../components/BottomNav";
import { useApp } from "../lib/store";
import { fetchOrderHistory, type OrderHistoryEntry } from "../lib/rewards";
import { formatPrice } from "../lib/api";

export default function OrdersTab() {
  const phone = useApp((s) => s.phone);
  const cart = useApp((s) => s.cart);
  const addToCart = useApp((s) => s.addToCart);
  const clearCart = useApp((s) => s.clearCart);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["order-history", phone],
    queryFn: () => (phone ? fetchOrderHistory(phone, 20) : Promise.resolve([])),
    enabled: !!phone,
    staleTime: 30_000,
  });

  const reorder = (order: OrderHistoryEntry) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (cart.length > 0) {
      // Wipe current cart so reordered items aren't double-added on top
      clearCart();
    }
    for (const it of order.order_items) {
      addToCart({
        productId: it.product_id,
        name: it.product_name,
        image: undefined, // not stored on order_items; will fall back to placeholder
        basePrice: (it.unit_price ?? 0) / 100,
        quantity: it.quantity ?? 1,
        modifiers: (it.modifiers ?? []).map((m) => ({
          groupId: "",
          groupName: m.groupName ?? "",
          optionId: "",
          label: m.label ?? "",
          priceDelta: (m.priceDelta ?? 0) / 100,
        })),
        specialInstructions: undefined,
        totalPrice: (it.item_total ?? it.unit_price ?? 0) / 100,
      });
    }
    router.push("/cart");
  };

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <EspressoHeader title="Orders" showCart={false} />

      {!phone ? (
        <View className="flex-1 items-center justify-center px-6">
          <ClipboardList size={48} color="#8E8E93" strokeWidth={1.25} />
          <Text
            className="text-espresso text-base mt-4"
            style={{ fontFamily: "Peachi-Bold" }}
          >
            Sign in to see your orders
          </Text>
          <Text
            className="text-muted-fg text-sm text-center mt-1"
            style={{ fontFamily: "SpaceGrotesk_400Regular" }}
          >
            Your past orders will live here once you sign in.
          </Text>
          <Pressable
            onPress={() => router.push("/account")}
            className="mt-6 bg-espresso rounded-full active:opacity-80"
            style={{ paddingHorizontal: 20, paddingVertical: 12 }}
          >
            <Text
              className="text-white text-[14px]"
              style={{ fontFamily: "Peachi-Bold" }}
            >
              Sign in
            </Text>
          </Pressable>
        </View>
      ) : isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#C05040" />
        </View>
      ) : (data?.length ?? 0) === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <ClipboardList size={48} color="#8E8E93" strokeWidth={1.25} />
          <Text
            className="text-espresso text-base mt-4"
            style={{ fontFamily: "Peachi-Bold" }}
          >
            No past orders yet
          </Text>
          <Text
            className="text-muted-fg text-sm text-center mt-1"
            style={{ fontFamily: "SpaceGrotesk_400Regular" }}
          >
            Once you place your first order, it'll show up here.
          </Text>
          <Pressable
            onPress={() => router.push("/menu")}
            className="mt-6 bg-espresso rounded-full active:opacity-80"
            style={{ paddingHorizontal: 20, paddingVertical: 12 }}
          >
            <Text
              className="text-white text-[14px]"
              style={{ fontFamily: "Peachi-Bold" }}
            >
              Browse menu
            </Text>
          </Pressable>
        </View>
      ) : (
        (() => {
          const { active, past } = splitOrders(data!);
          return (
            <ScrollView
              contentContainerClassName="px-4 py-4 pb-32 gap-3"
              refreshControl={
                <RefreshControl
                  refreshing={isRefetching}
                  onRefresh={() => refetch()}
                  tintColor="#C05040"
                />
              }
            >
              <SectionHeader label="In progress" />
              {active.length > 0 ? (
                active.map((order) => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    onReorder={() => reorder(order)}
                  />
                ))
              ) : (
                <View className="bg-surface rounded-2xl border border-border px-4 py-5 items-center">
                  <Text
                    className="text-muted-fg text-[12px] text-center"
                    style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                  >
                    No active orders right now
                  </Text>
                </View>
              )}
              {past.length > 0 && (
                <>
                  <SectionHeader label="Past orders" />
                  {past.map((order) => (
                    <OrderRow
                      key={order.id}
                      order={order}
                      onReorder={() => reorder(order)}
                    />
                  ))}
                </>
              )}
            </ScrollView>
          );
        })()
      )}

      <BottomNav />
    </View>
  );
}

// Pending orders older than this with no payment confirmation are treated as
// abandoned and grouped with past orders. Server-side cron eventually marks
// them "failed", but the customer view shouldn't wait for that round-trip.
const STALE_PENDING_MS = 10 * 60 * 1000;

function effectiveStatus(order: OrderHistoryEntry): string {
  const raw = (order.status ?? "pending").toLowerCase();
  if (raw === "pending") {
    const ageMs = Date.now() - new Date(order.created_at).getTime();
    if (ageMs > STALE_PENDING_MS) return "failed";
  }
  return raw;
}

function splitOrders(orders: OrderHistoryEntry[]) {
  const active: OrderHistoryEntry[] = [];
  const past: OrderHistoryEntry[] = [];
  for (const order of orders) {
    const status = effectiveStatus(order);
    if (status === "pending" || status === "paid" || status === "preparing" || status === "ready") {
      active.push(order);
    } else {
      past.push(order);
    }
  }
  return { active, past };
}

function SectionHeader({ label }: { label: string }) {
  return (
    <Text
      className="text-muted-fg text-[11px] uppercase tracking-wider px-1 mt-2 mb-1"
      style={{ fontFamily: "SpaceGrotesk_700Bold" }}
    >
      {label}
    </Text>
  );
}

function OrderRow({
  order,
  onReorder,
}: {
  order: OrderHistoryEntry;
  onReorder: () => void;
}) {
  const status = effectiveStatus(order);
  const StatusIcon =
    status === "completed" || status === "ready"
      ? CheckCircle2
      : status === "cancelled" || status === "failed"
      ? XCircle
      : status === "preparing" || status === "paid"
      ? Coffee
      : Clock;
  const statusColor =
    status === "completed" || status === "ready"
      ? "#16A34A"
      : status === "cancelled" || status === "failed"
      ? "#C05040"
      : "#8E8E93";

  const date = new Date(order.created_at);
  const dateLabel = date.toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const timeLabel = date.toLocaleTimeString("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const itemSummary =
    order.order_items
      .slice(0, 2)
      .map((i) => `${i.quantity}× ${i.product_name}`)
      .join(", ") +
    (order.order_items.length > 2
      ? ` · +${order.order_items.length - 2} more`
      : "");

  const totalRm = (order.total ?? 0) / 100;

  return (
    <View
      className="bg-surface rounded-2xl border border-border p-4"
      style={{
        shadowColor: "#000",
        shadowOpacity: 0.04,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      }}
    >
      <Pressable
        onPress={() => router.push({ pathname: "/order/[id]", params: { id: order.id } })}
        className="active:opacity-70"
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <StatusIcon size={16} color={statusColor} strokeWidth={2} />
            <Text
              className="text-[12px]"
              style={{ fontFamily: "SpaceGrotesk_700Bold", color: statusColor }}
            >
              {status.toUpperCase()}
            </Text>
          </View>
          <Text
            className="text-muted-fg text-[11px]"
            style={{ fontFamily: "SpaceGrotesk_500Medium" }}
          >
            #{order.order_number}
          </Text>
        </View>

        <Text
          className="text-espresso text-[15px] mt-2"
          style={{ fontFamily: "Peachi-Bold" }}
          numberOfLines={1}
        >
          {itemSummary || "Order"}
        </Text>
        <Text
          className="text-muted-fg text-[12px] mt-0.5"
          style={{ fontFamily: "SpaceGrotesk_400Regular" }}
        >
          {dateLabel} · {timeLabel} · {formatPrice(totalRm)}
        </Text>
      </Pressable>

      <View className="flex-row gap-2 mt-3 pt-3 border-t border-border">
        <Pressable
          onPress={() => router.push({ pathname: "/order/[id]", params: { id: order.id } })}
          className="flex-1 flex-row items-center justify-center gap-1 bg-background border border-border rounded-full active:opacity-70"
          style={{ paddingVertical: 10 }}
        >
          <Text
            className="text-espresso text-[13px]"
            style={{ fontFamily: "Peachi-Bold" }}
          >
            View
          </Text>
          <ChevronRight size={14} color="#160800" />
        </Pressable>
        <Pressable
          onPress={onReorder}
          className="flex-1 flex-row items-center justify-center gap-1 bg-espresso rounded-full active:opacity-80"
          style={{ paddingVertical: 10 }}
        >
          <RefreshCw size={13} color="#FFFFFF" strokeWidth={2.5} />
          <Text
            className="text-white text-[13px]"
            style={{ fontFamily: "Peachi-Bold" }}
          >
            Order again
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
