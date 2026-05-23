import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  Plus,
} from "lucide-react-native";
import { listAudits, type AuditListItem } from "../../../lib/ops/audits";

export default function AuditList() {
  const router = useRouter();
  const [items, setItems] = useState<AuditListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await listAudits().catch(() => []);
      setItems(data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(true);
    }, [load]),
  );

  const inProgress = items.filter((a) => a.status === "IN_PROGRESS");
  const completed = items.filter((a) => a.status === "COMPLETED");

  if (loading && items.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#A2492C" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={[]}
        keyExtractor={() => ""}
        renderItem={() => null}
        contentContainerClassName="px-5 pt-4 pb-32"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load(true);
            }}
            tintColor="#A2492C"
          />
        }
        ListHeaderComponent={
          <View>
            {inProgress.length > 0 ? (
              <View className="mb-4">
                <Text className="mb-2 text-xs font-body-semi uppercase tracking-wide text-muted">
                  In progress
                </Text>
                <View className="gap-2">
                  {inProgress.map((a) => (
                    <AuditCard
                      key={a.id}
                      audit={a}
                      onPress={() => router.push(`/audit/${a.id}`)}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {completed.length > 0 ? (
              <View>
                <Text className="mb-2 text-xs font-body-semi uppercase tracking-wide text-muted">
                  Completed
                </Text>
                <View className="gap-2">
                  {completed.slice(0, 10).map((a) => (
                    <AuditCard
                      key={a.id}
                      audit={a}
                      onPress={() => router.push(`/audit/${a.id}`)}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {items.length === 0 ? (
              <View className="mt-12 items-center px-6">
                <View className="h-20 w-20 items-center justify-center rounded-3xl bg-primary-50">
                  <ClipboardList color="#A2492C" size={32} />
                </View>
                <Text className="mt-4 text-base font-display text-espresso">
                  No audits yet
                </Text>
                <Text className="mt-1 text-sm font-body text-muted-fg text-center">
                  Tap the button below to start a spot check.
                </Text>
              </View>
            ) : null}
          </View>
        }
      />

      {/* Pinned bottom CTA */}
      <View className="absolute inset-x-0 bottom-0 border-t border-border bg-background px-5 pt-3 pb-8">
        <Pressable
          onPress={() => router.push("/audit/new")}
          className="h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-primary active:opacity-80"
        >
          <Plus color="#FFFFFF" size={20} />
          <Text className="text-base font-body-bold text-white">
            New audit
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function AuditCard({
  audit,
  onPress,
}: {
  audit: AuditListItem;
  onPress: () => void;
}) {
  const done = audit.status === "COMPLETED";
  const Icon = done ? CheckCircle2 : Clock;
  return (
    <Pressable
      onPress={onPress}
      className="rounded-2xl border border-border bg-surface px-3 py-2.5 active:bg-primary-50"
    >
      <View className="flex-row items-center gap-3">
        <View
          className={`h-9 w-9 items-center justify-center rounded-xl ${done ? "bg-success/10" : "bg-blue-100"}`}
        >
          <Icon color={done ? "#15803D" : "#2563EB"} size={16} />
        </View>
        <View className="flex-1">
          <View className="flex-row items-center gap-1.5">
            <Text
              className="flex-1 text-sm font-body-medium text-espresso"
              numberOfLines={1}
            >
              {audit.template.name}
            </Text>
            {audit.isMine ? (
              <View className="rounded-full bg-primary-50 px-1.5 py-px">
                <Text className="text-[9px] font-body-bold text-primary">
                  YOU
                </Text>
              </View>
            ) : null}
          </View>
          <Text className="mt-0.5 text-[10px] font-body text-muted">
            {audit.auditor.name} · {audit.date} · {audit.completedItems}/
            {audit.totalItems}
          </Text>
        </View>
        {done ? (
          <View
            className={`rounded-full px-2 py-0.5 ${
              (audit.overallScore ?? 0) >= 80
                ? "bg-success/10"
                : (audit.overallScore ?? 0) >= 60
                  ? "bg-amber-100"
                  : "bg-danger/10"
            }`}
          >
            <Text
              className={`text-xs font-body-bold ${
                (audit.overallScore ?? 0) >= 80
                  ? "text-success"
                  : (audit.overallScore ?? 0) >= 60
                    ? "text-amber-700"
                    : "text-danger"
              }`}
            >
              {audit.overallScore ?? 0}%
            </Text>
          </View>
        ) : (
          <Text className="text-sm font-body-bold text-espresso">
            {audit.progress}%
          </Text>
        )}
        <ChevronRight color="#D1D5DB" size={14} />
      </View>
      {!done ? (
        <View className="mt-2 h-1 overflow-hidden rounded-full bg-primary-50">
          <View
            className="h-full bg-primary"
            style={{ width: `${audit.progress}%` }}
          />
        </View>
      ) : null}
    </Pressable>
  );
}
