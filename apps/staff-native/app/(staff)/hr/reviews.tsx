import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { Star, MessageSquare } from "lucide-react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { fetchMyReviews, type MyReview } from "../../../lib/hr/api";

export default function ReviewsScreen() {
  const [reviews, setReviews] = useState<MyReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchMyReviews().catch(() => ({
        reviews: [] as MyReview[],
        count: 0,
      }));
      setReviews(data.reviews ?? []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Screen edges={["top", "left", "right"]}>
      <PageHeader title="Feedback" back />
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#A2492C" />
        </View>
      ) : (
    <FlatList
      className="flex-1"
      data={reviews}
      keyExtractor={(r) => r.id}
      contentContainerClassName="pt-2 pb-6"
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
        <View className="mt-12 items-center px-6">
          <View className="h-20 w-20 items-center justify-center rounded-3xl bg-primary-50">
            <MessageSquare color="#A2492C" size={32} />
          </View>
          <Text className="mt-4 text-base font-display text-espresso">
            No reviews yet
          </Text>
          <Text className="mt-1 text-sm font-body text-muted-fg text-center">
            Customer reviews left during your shifts will show up here.
          </Text>
        </View>
      }
      ItemSeparatorComponent={() => <View className="h-2" />}
      renderItem={({ item: r }) => (
        <View className="rounded-2xl border border-border bg-surface p-4">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  key={n}
                  color={n <= r.rating ? "#FBBF24" : "#E5E7EB"}
                  fill={n <= r.rating ? "#FBBF24" : "transparent"}
                  size={16}
                />
              ))}
            </View>
            <Text className="text-xs font-body text-muted">
              {fmt(r.review_date)}
            </Text>
          </View>
          {r.comment ? (
            <Text className="mt-2 text-sm font-body text-espresso">
              {r.comment}
            </Text>
          ) : null}
          <Text className="mt-2 text-xs font-body text-muted">
            {r.reviewer_name ?? "Anonymous"} · {r.source ?? "review"}
          </Text>
        </View>
      )}
      showsVerticalScrollIndicator={false}
    />
      )}
    </Screen>
  );
}

function fmt(s: string): string {
  return new Date(s).toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
