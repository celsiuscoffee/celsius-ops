import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { acknowledgeMemo, fetchMemos, type Memo } from "../../../lib/hr/api";

export default function MemosScreen() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["hr-memos"],
    queryFn: fetchMemos,
  });
  const memos = data?.memos ?? [];

  return (
    <Screen>
      <PageHeader title="Memos" back />
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-sm text-danger text-center">
            {(error as Error).message}
          </Text>
        </View>
      ) : (
    <FlatList
      className="flex-1"
      contentContainerClassName="pt-2 pb-24"
      data={memos}
      keyExtractor={(m) => m.id}
      ItemSeparatorComponent={() => <View className="h-3" />}
      renderItem={({ item }) => (
        <MemoCard
          memo={item}
          onAcknowledge={async () => {
            await acknowledgeMemo(item.id);
            qc.invalidateQueries({ queryKey: ["hr-memos"] });
          }}
        />
      )}
      ListEmptyComponent={
        <Text className="mt-12 text-center text-sm text-muted-fg">
          No memos right now.
        </Text>
      }
      showsVerticalScrollIndicator={false}
    />
      )}
    </Screen>
  );
}

function MemoCard({
  memo,
  onAcknowledge,
}: {
  memo: Memo;
  onAcknowledge: () => Promise<void>;
}) {
  const acked = !!memo.my_acknowledged_at;
  const [acking, setAcking] = useState(false);

  async function handleAcknowledge() {
    if (acking) return;
    setAcking(true);
    try {
      await onAcknowledge();
    } catch (e) {
      Alert.alert(
        "Couldn't acknowledge",
        e instanceof Error ? e.message : "Try again.",
      );
    } finally {
      setAcking(false);
    }
  }

  return (
    <View className="rounded-3xl border border-border bg-surface p-5">
      <Text className="text-xs font-body-semi text-muted uppercase tracking-wide">
        {new Date(memo.issued_at).toLocaleDateString([], {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
      </Text>
      <Text className="mt-1 text-lg font-display-medium text-espresso">
        {memo.title}
      </Text>
      <Text className="mt-2 text-sm font-body text-espresso leading-5">
        {memo.body}
      </Text>
      {memo.requires_acknowledgement ? (
        acked ? (
          <Text className="mt-3 text-xs font-body-semi text-success">
            Acknowledged
          </Text>
        ) : (
          <Pressable
            onPress={handleAcknowledge}
            disabled={acking}
            className={`mt-3 h-10 items-center justify-center rounded-2xl ${
              acking ? "bg-primary/50" : "bg-primary"
            }`}
          >
            {acking ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text className="text-sm font-body-bold text-white">
                Acknowledge
              </Text>
            )}
          </Pressable>
        )
      ) : null}
    </View>
  );
}
