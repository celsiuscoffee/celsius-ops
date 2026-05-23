import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { ArrowLeftRight, ArrowRight } from "lucide-react-native";
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

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#A2492C" />
      </View>
    );
  }

  return (
    <FlatList
      className="flex-1 bg-background"
      data={items}
      keyExtractor={(t) => t.id}
      contentContainerClassName="px-5 pt-4 pb-12"
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
            <Text className="text-sm font-body-medium text-espresso">
              {t.fromOutlet}
            </Text>
            <ArrowRight color="#9CA3AF" size={14} />
            <Text className="text-sm font-body-medium text-espresso">
              {t.toOutlet}
            </Text>
            <Text className="ml-auto text-xs font-body text-muted">
              {fmtDate(t.createdAt)}
            </Text>
          </View>
          <Text className="mt-1 text-xs font-body text-muted">
            {t.items.length} item{t.items.length === 1 ? "" : "s"} ·{" "}
            {t.transferredBy} · {t.status.replace("_", " ").toLowerCase()}
          </Text>
          {t.notes ? (
            <Text className="mt-2 text-xs font-body text-muted-fg">
              {t.notes}
            </Text>
          ) : null}
        </View>
      )}
    />
  );
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString([], {
    day: "numeric",
    month: "short",
  });
}
