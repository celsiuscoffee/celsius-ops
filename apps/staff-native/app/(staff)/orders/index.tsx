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
    <Screen>
      {/* Sticky header with inline "+ New PO" */}
              <PageHeader
          title="Purchase Orders"
          subtitle="Order stock from suppliers"
          back
          right={
            <Pressable
              onPress={() => router.push("/(staff)/orders/new" as never)}
              accessibilityLabel="New PO"
              className="h-9 flex-row items-center gap-1 rounded-lg bg-primary px-3 active:opacity-90"
            >
              <Plus color="#FFFFFF" size={14} />
              <Text className="text-xs font-body-bold text-white">New PO</Text>
            </Pressable>
          }
        />

      {/* Tabs */}
      <View className="mb-3 flex-row gap-2">
        {(["active", "completed"] as TabKey[]).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            className={`rounded-full px-3 py-1.5 ${
              tab === t ? "bg-primary" : "bg-primary-50"
            }`}
          >
            <Text
              className={`text-xs font-body-bold capitalize ${
                tab === t ? "text-white" : "text-primary"
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
          contentContainerClassName="pb-24"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load(true);
              }}
              tintColor="#C2452D"
              colors={["#C2452D"]}
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
  const tone = STATUS_TONE[order.status] ?? {
    label: order.status,
    tone: "muted" as const,
  };
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={order.orderNumber}
      className="rounded-3xl border border-border bg-surface px-4 py-3.5 active:bg-primary-50"
    >
      <View className="flex-row items-start gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-2xl bg-primary-50">
          <Truck color="#C2452D" size={20} />
        </View>
        <View className="flex-1">
          <View className="flex-row items-start justify-between gap-2">
            <Text
              className="flex-1 text-base font-body-bold text-espresso"
              numberOfLines={1}
            >
              {order.supplier}
            </Text>
            <Pill label={tone.label} tone={tone.tone} />
          </View>
          <Text
            className="mt-0.5 text-xs font-body text-muted-fg"
            numberOfLines={1}
          >
            {order.orderNumber} · {order.outletCode} · {order.items.length} item
            {order.items.length === 1 ? "" : "s"}
          </Text>
          <View className="mt-1 flex-row items-center justify-between">
            <Text className="text-base font-body-bold text-espresso tabular-nums">
              RM {order.totalAmount.toFixed(2)}
            </Text>
            <ChevronRight color="#9CA3AF" size={16} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}
