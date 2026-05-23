import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { acknowledgeMemo, fetchMemos, type Memo } from "../../../lib/hr/api";

export default function MemosScreen() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["hr-memos"],
    queryFn: fetchMemos,
  });

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }
  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-sm text-danger text-center">
          {(error as Error).message}
        </Text>
      </View>
    );
  }

  const memos = data?.memos ?? [];

  return (
    <FlatList
      className="flex-1 bg-background"
      contentContainerClassName="px-5 pt-4 pb-8"
      data={memos}
      keyExtractor={(m) => m.id}
      ItemSeparatorComponent={() => <View className="h-3" />}
      renderItem={({ item }) => (
        <MemoCard
          memo={item}
          onAcknowledge={async () => {
            await acknowledgeMemo(item.id).catch(() => {});
            qc.invalidateQueries({ queryKey: ["hr-memos"] });
          }}
        />
      )}
      ListEmptyComponent={
        <Text className="mt-12 text-center text-sm text-muted-fg">
          No memos right now.
        </Text>
      }
    />
  );
}

function MemoCard({
  memo,
  onAcknowledge,
}: {
  memo: Memo;
  onAcknowledge: () => void;
}) {
  const acked = !!memo.my_acknowledged_at;
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
            onPress={onAcknowledge}
            className="mt-3 h-10 items-center justify-center rounded-2xl bg-primary"
          >
            <Text className="text-sm font-body-bold text-white">
              Acknowledge
            </Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}
