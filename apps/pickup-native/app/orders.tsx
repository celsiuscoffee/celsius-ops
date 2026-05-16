import { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
} from "react-native";
import { Alert } from "@/lib/alert";
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
  MapPin,
} from "lucide-react-native";
import * as Haptics from "@/lib/haptics";
import { EspressoHeader } from "../components/EspressoHeader";
import { BottomNav } from "../components/BottomNav";
import { CelsiusLoader } from "../components/CelsiusLoader";
import { useApp } from "../lib/store";
import { fetchMenu } from "../lib/menu";
import { fetchOrderHistory, type OrderHistoryEntry } from "../lib/rewards";
import { formatPrice } from "../lib/api";
import { showToast } from "../lib/toast";

type OrdersTabKey = "active" | "past";

export default function OrdersTab() {
  const phone = useApp((s) => s.phone);
  const cart = useApp((s) => s.cart);
  const outletId = useApp((s) => s.outletId);
  const addToCart = useApp((s) => s.addToCart);
  const clearCart = useApp((s) => s.clearCart);
  // Menu cache keyed by outlet — same key the home + product screens use,
  // so this is usually warm. We tap into it just to look up image_url
  // for reorder, since order_items don't persist the image.
  const menu = useQuery({
    queryKey: ["menu", outletId],
    queryFn: () => fetchMenu(outletId),
    staleTime: 5 * 60_000,
  });
  // Tab state — default to "active" so customers with a live order
  // land on the tracking view first; they'll switch to "past" when
  // they want history.
  const [activeTab, setActiveTab] = useState<OrdersTabKey>("active");

  // staleTime 5min so the prefetched cache from _layout serves the
  // first-paint instantly. Background refetch still happens; the
  // pull-to-refresh affordance below force-fetches when the user
  // wants the latest. refetchInterval keeps the list live while the
  // tab is foregrounded — without it a status flip on KDS only
  // surfaces when the customer leaves and re-enters the tab.
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["order-history", phone],
    queryFn: () => (phone ? fetchOrderHistory(phone, 20) : Promise.resolve([])),
    enabled: !!phone,
    // Always refetch on tab focus — customers expect a just-placed order
    // to appear in In progress immediately. The 5-min staleTime that
    // used to live here masked the new order until pull-to-refresh.
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 5000,
  });

  const reorder = (order: OrderHistoryEntry) => {
    // If cart already has items, ask before wiping. We previously did a
    // silent clearCart() which could blow away an in-progress order.
    const apply = () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (cart.length > 0) clearCart();
      // productId → image_url lookup so reordered cart lines show the
      // right image instead of falling back to the broken placeholder.
      const imageByProduct = new Map<string, string>();
      for (const p of menu.data?.products ?? []) {
        if (p.image_url) imageByProduct.set(p.id, p.image_url);
      }
      let totalQty = 0;
      for (const it of order.order_items) {
        const q = it.quantity ?? 1;
        totalQty += q;
        // modifiers is stored as {selections:[...]} on new rows but may
        // be a flat array on older history — accept both.
        const rawMods = it.modifiers as
          | { selections?: Array<{ groupName?: string; label?: string; priceDelta?: number }> }
          | Array<{ groupName?: string; label?: string; priceDelta?: number }>
          | null
          | undefined;
        const modList = Array.isArray(rawMods)
          ? rawMods
          : rawMods?.selections ?? [];
        addToCart({
          productId: it.product_id,
          name: it.product_name,
          image: imageByProduct.get(it.product_id),
          basePrice: (it.unit_price ?? 0) / 100,
          quantity: q,
          modifiers: modList.map((m) => ({
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
      // Stay on the orders list rather than yanking the customer to /cart —
      // some reorders are exploratory. The toast lets them choose.
      showToast({
        message: `${totalQty} ${totalQty === 1 ? "item" : "items"} added to cart`,
        action: { label: "Review", onPress: () => router.push("/cart") },
        variant: "success",
      });
    };

    if (cart.length === 0) {
      apply();
      return;
    }
    Alert.alert(
      "Replace your cart?",
      `You have ${cart.length} ${cart.length === 1 ? "item" : "items"} in your cart already. Re-ordering will replace them.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Replace", style: "destructive", onPress: apply },
      ],
    );
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
          <CelsiusLoader size="md" />
        </View>
      ) : (data?.length ?? 0) === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <ClipboardList size={48} color="#8E8E93" strokeWidth={1.25} />
          <Text
            className="text-espresso text-base mt-4"
            style={{ fontFamily: "Peachi-Bold" }}
          >
            No orders yet
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
        <OrdersTabView
          orders={data!}
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          isRefetching={isRefetching}
          onRefresh={() => refetch()}
          onReorder={reorder}
        />
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

function OrdersTabView({
  orders,
  activeTab,
  onChangeTab,
  isRefetching,
  onRefresh,
  onReorder,
}: {
  orders: OrderHistoryEntry[];
  activeTab: OrdersTabKey;
  onChangeTab: (t: OrdersTabKey) => void;
  isRefetching: boolean;
  onRefresh: () => void;
  onReorder: (o: OrderHistoryEntry) => void;
}) {
  const { active, past } = useMemo(() => splitOrders(orders), [orders]);
  const list = activeTab === "active" ? active : past;
  const emptyCopy =
    activeTab === "active"
      ? "No active orders right now."
      : "No past orders yet.";

  return (
    <View className="flex-1">
      {/* Tab bar — terracotta underline marks the active tab, matching
          the pattern used elsewhere in the app. The "In progress" tab
          carries a count badge so customers spot a live order at a
          glance without having to switch tabs. */}
      <View className="flex-row border-b border-border px-4">
        <TabPill
          label="In progress"
          count={active.length}
          active={activeTab === "active"}
          onPress={() => onChangeTab("active")}
        />
        <TabPill
          label="Past orders"
          count={null}
          active={activeTab === "past"}
          onPress={() => onChangeTab("past")}
        />
      </View>

      {list.length > 0 ? (
        <ScrollView
          contentContainerClassName="px-4 py-4 pb-32 gap-3"
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={onRefresh}
              tintColor="#C05040"
            />
          }
        >
          {list.map((order) => (
            <OrderRow
              key={order.id}
              order={order}
              onReorder={() => onReorder(order)}
            />
          ))}
        </ScrollView>
      ) : (
        <View className="flex-1 items-center justify-center px-6">
          <ClipboardList size={40} color="#8E8E93" strokeWidth={1.25} />
          <Text
            className="text-muted-fg text-[13px] mt-3 text-center"
            style={{ fontFamily: "SpaceGrotesk_500Medium" }}
          >
            {emptyCopy}
          </Text>
        </View>
      )}
    </View>
  );
}

function TabPill({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number | null;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      className="flex-row items-center gap-1.5 active:opacity-70"
      style={{
        paddingVertical: 12,
        paddingHorizontal: 4,
        marginRight: 18,
        borderBottomWidth: 2,
        borderBottomColor: active ? "#C05040" : "transparent",
      }}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      <Text
        style={{
          // 15pt Space Grotesk, weight pair (700Bold active, 600SemiBold
          // inactive) on muted-grey. The Rewards tab strip has been
          // removed in favour of a single-page layout, so this is now
          // the only tab strip in the app.
          fontFamily: active ? "SpaceGrotesk_700Bold" : "SpaceGrotesk_600SemiBold",
          fontSize: 15,
          color: active ? "#1A0200" : "#6B6B6B",
        }}
      >
        {label}
      </Text>
      {count !== null && count > 0 && (
        <View
          className="rounded-full items-center justify-center"
          style={{
            minWidth: 18,
            height: 18,
            paddingHorizontal: 5,
            backgroundColor: active ? "#C05040" : "rgba(192, 80, 64, 0.15)",
          }}
        >
          <Text
            className="text-[10px] leading-none"
            style={{
              fontFamily: "SpaceGrotesk_700Bold",
              color: active ? "#FFFFFF" : "#C05040",
            }}
          >
            {count}
          </Text>
        </View>
      )}
    </Pressable>
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
        {/* Outlet row — pin icon + "Celsius Coffee Putrajaya" so the
            customer can tell where each order was placed without
            opening it. Falls back to skip the row when store_name
            isn't resolved (e.g. legacy orders with a store_id that
            no longer maps to a configured outlet). */}
        {order.store_name ? (
          <View className="flex-row items-center mt-1.5" style={{ gap: 4 }}>
            <MapPin size={11} color="#8E8E93" strokeWidth={2} />
            <Text
              className="text-muted-fg text-[12px]"
              style={{ fontFamily: "SpaceGrotesk_500Medium" }}
              numberOfLines={1}
            >
              {order.store_name}
            </Text>
          </View>
        ) : null}
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
