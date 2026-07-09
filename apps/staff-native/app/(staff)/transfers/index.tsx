import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { ArrowLeftRight, ArrowRight } from "lucide-react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { useStaff } from "../../../lib/store";
import { listTransfers, type Transfer } from "../../../lib/ops/inventory";

export default function TransfersPage() {
  const session = useStaff((s) => s.session);
  const [items, setItems] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await listTransfers(session?.outletId).catch(() => []);
      setItems(data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session?.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Screen>
      <PageHeader title="Transfers" back />
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#A2492C" />
        </View>
      ) : (
    <FlatList
      className="flex-1"
      data={items}
      keyExtractor={(t) => t.id}
      contentContainerClassName="pt-2 pb-24"
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
      ListEmptyComponent={
        <View className="mt-16 items-center px-6">
          <View className="h-20 w-20 items-center justify-center rounded-3xl bg-primary-50">
            <ArrowLeftRight color="#A2492C" size={32} />
          </View>
          <Text className="mt-4 text-base font-display text-espresso">
            No transfers yet
          </Text>
          <Text className="mt-1 text-sm font-body text-muted-fg text-center">
            Inter-outlet stock transfers will show up here.
          </Text>
        </View>
      }
      ItemSeparatorComponent={() => <View className="h-2" />}
      renderItem={({ item: t }) => (
        <View className="rounded-2xl border border-border bg-surface p-4">
          <View className="flex-row items-center gap-2">
            <Text
              className="shrink text-base font-body-medium text-espresso"
              numberOfLines={1}
            >
              {shortOutlet(t.fromOutlet)}
            </Text>
            <ArrowRight color="#9CA3AF" size={14} />
            <Text
              className="shrink text-base font-body-medium text-espresso"
              numberOfLines={1}
            >
              {shortOutlet(t.toOutlet)}
            </Text>
          </View>
          <Text className="mt-1 text-xs font-body text-muted">
            {t.items.length} item{t.items.length === 1 ? "" : "s"} ·{" "}
            {t.transferredBy} · {t.status.replace("_", " ").toLowerCase()} ·{" "}
            {fmtDate(t.createdAt)}
          </Text>
          {t.notes ? (
            <Text className="mt-2 text-xs font-body text-muted-fg">
              {t.notes}
            </Text>
          ) : null}
        </View>
      )}
      showsVerticalScrollIndicator={false}
    />
      )}
    </Screen>
  );
}

// Every outlet is stored as "Celsius Coffee <place>"; the prefix is redundant
// on both ends of the route and is what pushed the second name off-screen.
function shortOutlet(name: string): string {
  return name.replace(/^Celsius Coffee\s+/i, "").trim() || name;
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString([], {
    day: "numeric",
    month: "short",
  });
}
