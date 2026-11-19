import { useQuery } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { Plus, Receipt } from "lucide-react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import { listClaims, type Claim } from "../../../lib/claims";
import { sentence, useCelsius } from "../../../lib/celsius-ui";

export default function ClaimsList() {
  const C = useCelsius().color;
  const router = useRouter();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["claims"],
    queryFn: () => listClaims(50),
  });

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const claims = data?.claims ?? [];

  return (
    <Screen edges={["top", "left", "right"]}>
      <PageHeader
        title="Pay and claim"
        subtitle="Receipts you paid for, and payment requests"
        back
        right={
          <Pressable
            onPress={() => router.push("/(staff)/claims/new")}
            accessibilityLabel="New claim"
            className="h-11 w-11 items-center justify-center rounded-2xl bg-ink active:opacity-80"
          >
            <Plus color={C["on-ink"]} size={22} />
          </Pressable>
        }
      />

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-base font-body-bold text-text">
            Couldn't load claims
          </Text>
          <Text className="mt-2 text-center text-sm font-body text-text-2">
            {(error as Error).message}
          </Text>
          <Pressable
            onPress={() => refetch()}
            className="mt-6 h-12 items-center justify-center rounded-2xl bg-ink px-8 active:opacity-80"
          >
            <Text className="text-base font-body-bold text-on-ink">Retry</Text>
          </Pressable>
        </View>
      ) : claims.length === 0 ? (
        <EmptyState onNew={() => router.push("/(staff)/claims/new")} />
      ) : (
        <FlatList
          className="mt-6"
          data={claims}
          keyExtractor={(c) => c.id}
          ItemSeparatorComponent={() => <View className="h-3" />}
          contentContainerClassName="pb-6"
          renderItem={({ item }) => <ClaimCard claim={item} />}
      showsVerticalScrollIndicator={false}
    />
      )}
    </Screen>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  const C = useCelsius().color;
  return (
    <View className="flex-1 items-center justify-center px-6">
      <View className="h-20 w-20 items-center justify-center rounded-2xl bg-sunken">
        <Receipt color={C["text-2"]} size={32} />
      </View>
      <Text className="mt-4 text-xl font-display text-text text-center">
        No claims yet
      </Text>
      <Text className="mt-2 text-sm font-body text-text-2 text-center">
        Submit your first claim by snapping a receipt photo.
      </Text>
      <Pressable
        onPress={onNew}
        className="mt-6 h-16 items-center justify-center rounded-2xl bg-ink px-8 active:opacity-80"
      >
        <Text className="text-base font-body-bold text-on-ink">
          Submit a Claim
        </Text>
      </Pressable>
    </View>
  );
}

function ClaimCard({ claim }: { claim: Claim }) {
  return (
    <View className="rounded-2xl border border-line bg-surface p-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <Text className="text-base font-display-medium text-text">
            {claim.supplierName ?? "Unknown supplier"}
          </Text>
          <Text className="mt-1 text-xs font-body text-text-2">
            {fmtDate(claim.issueDate)}
            {claim.orderNumber ? ` · ${claim.orderNumber}` : ""}
          </Text>
        </View>
        <View className="items-end">
          <Text className="text-lg font-display-medium text-text">
            RM {Number(claim.amount ?? 0).toFixed(2)}
          </Text>
          <StatusPill status={claim.status} />
        </View>
      </View>
      {claim.notes ? (
        <Text
          className="mt-2 text-xs font-body text-text-2"
          numberOfLines={2}
        >
          {claim.notes}
        </Text>
      ) : null}
    </View>
  );
}

function StatusPill({ status }: { status: string }) {
  const { label, bg, fg } = statusStyle(status);
  return (
    <View className={`mt-1 rounded-full px-2 py-0.5 ${bg}`}>
      <Text className={`text-xs font-body-bold ${fg}`}>
        {label}
      </Text>
    </View>
  );
}

function statusStyle(status: string): { label: string; bg: string; fg: string } {
  const s = status.toUpperCase();
  if (s === "PAID") {
    return { label: "Paid", bg: "bg-ok-soft", fg: "text-ok-text" };
  }
  if (s === "REJECTED" || s === "CANCELLED") {
    return { label: sentence(s), bg: "bg-danger-soft", fg: "text-danger-text" };
  }
  if (s === "APPROVED") {
    return { label: "Approved", bg: "bg-sunken", fg: "text-text" };
  }
  return {
    label: sentence(s) || "Draft",
    bg: "bg-sunken",
    fg: "text-text-2",
  };
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
