import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  ChevronRight,
  Plus,
  ShoppingCart,
  Truck,
} from "lucide-react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, Pill, SkeletonList } from "../../../components/ui";
import {
  listOrders,
  type OrderListItem,
  type OrderStatus,
} from "../../../lib/ops/orders";
import { useCelsius } from "../../../lib/celsius-ui";

type TabKey = "active" | "completed";

const ACTIVE_STATUSES: OrderStatus[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT",
  "AWAITING_DELIVERY",
  "PARTIALLY_RECEIVED",
];

const STATUS_TONE: Record<
  OrderStatus,
  { label: string; tone: "success" | "danger" | "brand" | "muted" | "warning" }
> = {
  DRAFT: { label: "Draft", tone: "muted" },
  PENDING_APPROVAL: { label: "Pending approval", tone: "warning" },
  APPROVED: { label: "Approved", tone: "brand" },
  SENT: { label: "Sent", tone: "brand" },
  AWAITING_DELIVERY: { label: "Awaiting delivery", tone: "brand" },
  PARTIALLY_RECEIVED: { label: "Partial", tone: "warning" },
  COMPLETED: { label: "Completed", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
};

export default function OrdersList() {
  const C = useCelsius().color;
  const router = useRouter();
  const [items, setItems] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabKey>("active");

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const data = await listOrders({ limit: 100 }).catch(() => ({
          items: [] as OrderListItem[],
          total: 0,
        }));
        setItems(data.items);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    load();
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      load(true);
    }, [load]),
  );

  const filtered = useMemo(() => {
    if (tab === "active") {
      return items.filter((o) =>
        (ACTIVE_STATUSES as string[]).includes(o.status),
      );
    }
    return items.filter(
      (o) => o.status === "COMPLETED" || o.status === "CANCELLED",
    );
  }, [items, tab]);

  return (
    <Screen edges={["top", "left", "right"]}>
      {/* Sticky header with inline "+ New PO" */}
              <PageHeader
          title="Purchase orders"
          subtitle="Order stock from suppliers"
          back
          right={
            <Pressable
              onPress={() => router.push("/(staff)/orders/new" as never)}
              accessibilityLabel="New PO"
              className="h-11 flex-row items-center gap-1 rounded-lg bg-ink px-3 active:opacity-90"
            >
              <Plus color={C["on-ink"]} size={14} />
              <Text className="text-xs font-body-bold text-on-ink">New order</Text>
            </Pressable>
          }
        />

      {/* Tabs */}
      <View className="mb-3 flex-row gap-2">
        {(["active", "completed"] as TabKey[]).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            className={`h-11 justify-center rounded-full px-4 ${
              tab === t ? "bg-ink" : "bg-sunken"
            }`}
          >
            <Text
              className={`text-xs font-body-bold capitalize ${
                tab === t ? "text-on-ink" : "text-text-2"
              }`}
            >
              {t}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading && items.length === 0 ? (
        <SkeletonList count={4} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerClassName="pb-6"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load(true);
              }}
              tintColor={C["text-3"]}
              colors={[C["text-3"]]}
            />
          }
        >
          {filtered.length === 0 ? (
            <EmptyState
              icon={ShoppingCart}
              title={tab === "active" ? "No active POs" : "Nothing completed"}
              subtitle={
                tab === "active"
                  ? "Tap + New PO above to draft an order."
                  : "POs that have been received or cancelled will appear here."
              }
            />
          ) : (
            <View className="gap-2">
              {filtered.map((o) => (
                <OrderCard
                  key={o.id}
                  order={o}
                  onPress={() => router.push(`/(staff)/orders/${o.id}` as never)}
                />
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

function OrderCard({
  order,
  onPress,
}: {
  order: OrderListItem;
  onPress: () => void;
}) {
  const C = useCelsius().color;
  const tone = STATUS_TONE[order.status] ?? {
    label: order.status,
    tone: "muted" as const,
  };
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={order.orderNumber}
      className="rounded-2xl border border-line bg-surface px-4 py-3.5 active:bg-sunken"
    >
      <View className="flex-row items-start gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-2xl bg-sunken">
          <Truck color={C["text-2"]} size={20} />
        </View>
        <View className="flex-1">
          <View className="flex-row items-start justify-between gap-2">
            <Text
              className="flex-1 text-base font-body-bold text-text"
              numberOfLines={1}
            >
              {order.supplier}
            </Text>
            <Pill label={tone.label} tone={tone.tone} />
          </View>
          <Text
            className="mt-0.5 text-xs font-body text-text-2"
            numberOfLines={1}
          >
            {order.orderNumber} · {order.outletCode} · {order.items.length} item
            {order.items.length === 1 ? "" : "s"}
          </Text>
          <View className="mt-1 flex-row items-center justify-between">
            <Text className="text-base font-body-bold text-text tabular-nums">
              RM {Number(order.totalAmount ?? 0).toFixed(2)}
            </Text>
            <ChevronRight color={C["text-3"]} size={16} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}
