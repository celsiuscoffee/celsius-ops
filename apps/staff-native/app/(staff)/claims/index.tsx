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

export default function ClaimsList() {
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
    <Screen>
      <PageHeader
        title="Claims"
        subtitle="Out-of-pocket purchases"
        right={
          <Pressable
            onPress={() => router.push("/(staff)/claims/new")}
            accessibilityLabel="New claim"
            className="h-11 w-11 items-center justify-center rounded-2xl bg-primary active:opacity-80"
          >
            <Plus color="#FFFFFF" size={22} />
          </Pressable>
        }
      />

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-4">
          <Text className="text-sm text-danger text-center">
            {(error as Error).message}
          </Text>
        </View>
      ) : claims.length === 0 ? (
        <EmptyState onNew={() => router.push("/(staff)/claims/new")} />
      ) : (
        <FlatList
          className="mt-6"
          data={claims}
          keyExtractor={(c) => c.id}
          ItemSeparatorComponent={() => <View className="h-3" />}
          contentContainerClassName="pb-12"
          renderItem={({ item }) => <ClaimCard claim={item} />}
      showsVerticalScrollIndicator={false}
    />
      )}
    </Screen>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <View className="flex-1 items-center justify-center px-6">
      <View className="h-20 w-20 items-center justify-center rounded-3xl bg-primary-50">
        <Receipt color="#A2492C" size={32} />
      </View>
      <Text className="mt-4 text-xl font-display text-espresso text-center">
        No claims yet
      </Text>
      <Text className="mt-2 text-sm font-body text-muted-fg text-center">
        Submit your first claim by snapping a receipt photo.
      </Text>
      <Pressable
        onPress={onNew}
        className="mt-6 h-16 items-center justify-center rounded-2xl bg-primary px-8 active:opacity-80"
      >
        <Text className="text-base font-body-bold text-white">
          Submit a Claim
        </Text>
      </Pressable>
    </View>
  );
}

function ClaimCard({ claim }: { claim: Claim }) {
  return (
    <View className="rounded-3xl border border-border bg-surface p-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <Text className="text-base font-display-medium text-espresso">
            {claim.supplierName ?? "Unknown supplier"}
          </Text>
          <Text className="mt-1 text-xs font-body text-muted-fg">
            {fmtDate(claim.issueDate)}
            {claim.orderNumber ? ` · ${claim.orderNumber}` : ""}
          </Text>
        </View>
        <View className="items-end">
          <Text className="text-lg font-display-medium text-espresso">
            RM {claim.amount.toFixed(2)}
          </Text>
          <StatusPill status={claim.status} />
        </View>
      </View>
      {claim.notes ? (
        <Text
          className="mt-2 text-xs font-body text-muted-fg"
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
      <Text className={`text-[10px] font-body-bold uppercase ${fg}`}>
        {label}
      </Text>
    </View>
  );
}

function statusStyle(status: string): { label: string; bg: string; fg: string } {
  const s = status.toUpperCase();
  if (s === "PAID") {
    return { label: "Paid", bg: "bg-success/10", fg: "text-success" };
  }
  if (s === "REJECTED" || s === "CANCELLED") {
    return { label: s.toLowerCase(), bg: "bg-danger/10", fg: "text-danger" };
  }
  if (s === "APPROVED") {
    return { label: "Approved", bg: "bg-primary-50", fg: "text-primary" };
  }
  return {
    label: s.toLowerCase() || "draft",
    bg: "bg-muted/10",
    fg: "text-muted-fg",
  };
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
