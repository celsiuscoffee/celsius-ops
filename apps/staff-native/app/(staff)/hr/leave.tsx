import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import {
  fetchLeave,
  type LeaveBalance,
  type LeaveRequest,
} from "../../../lib/hr/api";

export default function LeaveScreen() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["hr-leave"],
    queryFn: fetchLeave,
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

  const balances = data?.balances ?? [];
  const requests = data?.requests ?? [];

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-5 pt-4 pb-8 gap-4"
    >
      <View>
        <Text className="text-xs font-body-semi text-muted uppercase tracking-wide">
          Balance ({new Date().getFullYear()})
        </Text>
        {balances.length === 0 ? (
          <Text className="mt-2 text-sm text-muted-fg">
            No leave balances assigned. Ask HR.
          </Text>
        ) : (
          <View className="mt-2 gap-2">
            {balances.map((b) => (
              <BalanceCard key={b.id} balance={b} />
            ))}
          </View>
        )}
      </View>

      <View>
        <Text className="text-xs font-body-semi text-muted uppercase tracking-wide">
          Recent requests
        </Text>
        {requests.length === 0 ? (
          <Text className="mt-2 text-sm text-muted-fg">No requests yet.</Text>
        ) : (
          <View className="mt-2 gap-2">
            {requests.map((r) => (
              <RequestCard key={r.id} request={r} />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function BalanceCard({ balance }: { balance: LeaveBalance }) {
  return (
    <View className="flex-row items-center justify-between rounded-2xl border border-border bg-surface p-4">
      <View>
        <Text className="text-base font-display-medium text-espresso">
          {balance.leave_type}
        </Text>
        <Text className="text-xs text-muted-fg">
          Used {balance.used_days} of {balance.entitled_days}
        </Text>
      </View>
      <Text className="text-2xl font-display text-primary">
        {balance.remaining_days}
      </Text>
    </View>
  );
}

function RequestCard({ request }: { request: LeaveRequest }) {
  const color =
    request.status === "approved"
      ? "text-success"
      : request.status === "rejected"
        ? "text-danger"
        : "text-muted-fg";
  return (
    <View className="rounded-2xl border border-border bg-surface p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-body-semi text-espresso">
          {request.leave_type}
        </Text>
        <Text className={`text-xs font-body-bold uppercase ${color}`}>
          {request.status}
        </Text>
      </View>
      <Text className="mt-1 text-xs text-muted-fg">
        {fmtDate(request.start_date)} → {fmtDate(request.end_date)} ·{" "}
        {request.total_days}d
      </Text>
      {request.reason ? (
        <Text className="mt-2 text-sm text-espresso">{request.reason}</Text>
      ) : null}
      {request.rejection_reason ? (
        <Text className="mt-2 text-sm text-danger">
          {request.rejection_reason}
        </Text>
      ) : null}
    </View>
  );
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString([], { day: "numeric", month: "short" });
}
