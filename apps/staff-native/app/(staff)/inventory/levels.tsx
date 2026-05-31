import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { AlertTriangle, Package, Search } from "lucide-react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, SkeletonList } from "../../../components/ui";
import { useStaff } from "../../../lib/store";
import {
  fetchStockLevels,
  type StockItem,
} from "../../../lib/ops/stock-levels";

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "critical", label: "Out" },
  { key: "low", label: "Low" },
  { key: "ok", label: "OK" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["key"];

export default function StockLevelsScreen() {
  const session = useStaff((s) => s.session);
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchStockLevels(session?.outletId);
      setItems(res.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session?.outletId]);

  useEffect(() => {
    load();
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = items.filter((i) => {
      if (status !== "all" && i.status !== status) return false;
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) ||
        i.sku.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q)
      );
    });
    const byArea = new Map<string, StockItem[]>();
    for (const i of filtered) {
      const arr = byArea.get(i.storageArea) ?? [];
      arr.push(i);
      byArea.set(i.storageArea, arr);
    }
    return Array.from(byArea.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );
  }, [items, query, status]);

  const counts = useMemo(() => {
    const out = { critical: 0, low: 0, ok: 0, no_par: 0 };
    for (const i of items) out[i.status]++;
    return out;
  }, [items]);

  return (
    <Screen>
      <PageHeader
        title="Stock levels"
        subtitle={
          session?.outletName
            ? `${session.outletName} · ${items.length} item${items.length === 1 ? "" : "s"}`
            : `${items.length} items`
        }
        back
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="pt-2 pb-32"
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
        {counts.critical + counts.low > 0 ? (
          <View className="mt-4 flex-row items-center gap-3 rounded-3xl border border-danger/30 bg-danger/5 p-4">
            <View className="h-10 w-10 items-center justify-center rounded-2xl bg-danger/10">
              <AlertTriangle color="#B91C1C" size={18} />
            </View>
            <Text className="flex-1 text-base font-display text-danger">
              {counts.critical} out, {counts.low} low on stock
            </Text>
          </View>
        ) : null}

        {/* Search */}
        <View className="mt-4 flex-row items-center gap-2 rounded-2xl border border-border bg-surface px-3">
          <Search color="#9CA3AF" size={18} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search products, SKU, category"
            placeholderTextColor="#9B9B9B"
            className="h-12 flex-1 text-base font-body text-espresso"
          />
        </View>

        {/* Filters */}
        <View className="mt-3 flex-row gap-2">
          {STATUS_FILTERS.map((f) => {
            const active = status === f.key;
            const count =
              f.key === "all"
                ? items.length
                : f.key === "critical"
                  ? counts.critical
                  : f.key === "low"
                    ? counts.low
                    : counts.ok;
            return (
              <Pressable
                key={f.key}
                onPress={() => setStatus(f.key)}
                accessibilityLabel={`${f.label} filter`}
                className={`rounded-full border-2 px-3 py-1.5 ${
                  active
                    ? "border-primary bg-primary-50"
                    : "border-border bg-surface"
                }`}
              >
                <Text
                  className={`text-xs font-body-bold ${
                    active ? "text-primary" : "text-muted-fg"
                  }`}
                >
                  {f.label} · {count}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {loading ? (
          <View className="mt-6">
            <SkeletonList count={5} />
          </View>
        ) : error ? (
          <View className="mt-6">
            <EmptyState
              icon={AlertTriangle}
              title="Couldn't load stock levels"
              subtitle={error}
            />
          </View>
        ) : grouped.length === 0 ? (
          <View className="mt-6">
            <EmptyState
              icon={Package}
              title="Nothing matches"
              subtitle="Try a different search or status filter."
            />
          </View>
        ) : (
          grouped.map(([area, list]) => (
            <View key={area} className="mt-6">
              <View className="mb-3 flex-row items-center gap-2">
                <View className="h-1.5 w-1.5 rounded-full bg-primary" />
                <Text className="text-xs font-body-bold uppercase tracking-wider text-muted">
                  {area}
                </Text>
                <Text className="text-xs font-body text-muted">
                  · {list.length}
                </Text>
              </View>
              <View className="gap-2.5">
                {list.map((i) => (
                  <Row key={i.id} item={i} />
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

function Row({ item }: { item: StockItem }) {
  const { tint, bg, label } = statusStyle(item.status);
  return (
    <View className="flex-row items-center justify-between rounded-3xl border border-border bg-surface p-4">
      <View className="flex-1 pr-3">
        <Text
          className="text-base font-display text-espresso"
          numberOfLines={1}
        >
          {item.name}
        </Text>
        <Text className="mt-0.5 text-xs font-body text-muted-fg">
          {item.category} · {item.baseUom}
        </Text>
      </View>
      <View className="items-end">
        <Text className="text-lg font-body-bold text-espresso tabular-nums">
          {item.quantity}
        </Text>
        {item.parLevel != null ? (
          <Text className="text-[10px] font-body text-muted tabular-nums">
            par {item.parLevel}
          </Text>
        ) : null}
        <View className={`mt-1 rounded-full px-2 py-0.5 ${bg}`}>
          <Text
            className={`text-[10px] font-body-bold uppercase tracking-wider ${tint}`}
          >
            {label}
          </Text>
        </View>
      </View>
    </View>
  );
}

function statusStyle(s: StockItem["status"]) {
  if (s === "critical")
    return { tint: "text-danger", bg: "bg-danger/10", label: "Out" };
  if (s === "low")
    return {
      tint: "text-amber-700",
      bg: "bg-amber-400/10",
      label: "Low",
    };
  if (s === "ok")
    return { tint: "text-success", bg: "bg-success/10", label: "OK" };
  return { tint: "text-muted-fg", bg: "bg-muted/10", label: "—" };
}
