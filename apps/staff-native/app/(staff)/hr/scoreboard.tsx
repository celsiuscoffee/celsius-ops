import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import {
  BadgeCheck,
  ClipboardCheck,
  Smartphone,
  Timer,
  TrendingUp,
  Trophy,
} from "lucide-react-native";
import { Screen } from "../../../components/Screen";
import { PageHeader } from "../../../components/PageHeader";
import {
  fetchAllowances,
  type AllowanceBreakdown,
  type AllowanceLever,
} from "../../../lib/hr/api";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Every number that reaches the screen goes through these, so a missing/odd
// API value can never throw (a `toFixed of undefined` in the allowance render
// is exactly the class of crash that has bitten this tab before).
function rm(n: unknown): string {
  return `RM ${Number(n ?? 0).toFixed(2)}`;
}
function pct(n: unknown): number {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

// Per-lever icon + a plain-language "what this measures" one-liner.
const LEVER_META: Record<
  string,
  { icon: React.ComponentType<{ color?: string; size?: number }>; blurb: string }
> = {
  checklist: { icon: ClipboardCheck, blurb: "Finish your shift SOPs on time" },
  phone: { icon: Smartphone, blurb: "Ask every guest for their number" },
  serving: { icon: Timer, blurb: "Keep serve time under target" },
  audit: { icon: BadgeCheck, blurb: "Your outlet's audit score" },
};

// under / ok / perform -> label + colours (mirrors the allowance tier colours).
const TIER = {
  perform: { label: "Perform", color: "#F59E0B", bg: "bg-amber-50", text: "text-amber-700" },
  ok: { label: "On track", color: "#3B82F6", bg: "bg-blue-50", text: "text-blue-700" },
  under: { label: "Build up", color: "#9CA3AF", bg: "bg-surface", text: "text-muted-fg" },
} as const;

function tierOf(t: string) {
  return TIER[t as keyof typeof TIER] ?? TIER.under;
}

export default function ScoreboardScreen() {
  const [data, setData] = useState<AllowanceBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetchAllowances();
      setData(res.breakdown);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, [load]);

  const monthLabel =
    data?.period?.month != null ? MONTHS[data.period.month - 1] ?? "" : "";
  const daysLeft = Number(data?.period?.daysRemaining ?? 0);
  const earned = Number(data?.totalEarned ?? 0);
  const max = Number(data?.totalMax ?? 0);
  const progress = max > 0 ? Math.round((earned / max) * 100) : 0;
  const levers = (data?.levers ?? []).filter((l) => l.applicable);
  const deductionTotal =
    Number(data?.attendance?.total ?? 0) + Number(data?.reviewPenalty?.total ?? 0);
  const performCount = levers.filter((l) => l.tier === "perform").length;

  return (
    <Screen edges={["top", "left", "right"]}>
      <PageHeader title="My Scoreboard" back />
      <ScrollView
        contentContainerClassName="pb-8"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#A2492C"
            colors={["#A2492C"]}
          />
        }
      >
        {loading ? (
          <View className="flex-1 items-center justify-center py-24">
            <ActivityIndicator color="#A2492C" />
          </View>
        ) : error ? (
          <View className="mt-6 rounded-3xl border border-danger/20 bg-danger/5 p-5">
            <Text className="text-sm font-body text-danger">{error}</Text>
          </View>
        ) : data && !data.eligible ? (
          <View className="mt-8 items-center px-6">
            <View className="mb-3 h-14 w-14 items-center justify-center rounded-3xl bg-primary-50">
              <Trophy color="#A2492C" size={26} />
            </View>
            <Text className="text-center text-base font-display-medium text-espresso">
              No performance pool yet
            </Text>
            <Text className="mt-1 text-center text-sm font-body text-muted-fg">
              {data.tip || "The performance allowance is for full-time staff."}
            </Text>
          </View>
        ) : data ? (
          <>
            {/* Hero: the payoff. RM earned so far out of the monthly pool. */}
            <View className="mt-4 rounded-3xl border border-primary/30 bg-primary-50/40 p-5">
              <View className="flex-row items-center gap-2">
                <Trophy color="#A2492C" size={16} />
                <Text className="text-xs font-body-semi uppercase tracking-wide text-primary">
                  {monthLabel} performance
                </Text>
              </View>
              <View className="mt-2 flex-row items-end gap-1.5">
                <Text className="text-4xl font-display text-espresso">
                  {rm(earned)}
                </Text>
                <Text className="mb-1 text-sm font-body text-muted-fg">
                  of {rm(max)}
                </Text>
              </View>
              <View className="mt-3 h-2.5 overflow-hidden rounded-full bg-primary-50">
                <View
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${pct(progress)}%` }}
                />
              </View>
              <View className="mt-2.5 flex-row items-center justify-between">
                <Text className="text-xs font-body text-muted-fg">
                  {performCount > 0
                    ? `Top tier on ${performCount} of ${levers.length} levers`
                    : "Push a lever to Perform to earn more"}
                </Text>
                <Text className="text-xs font-body-semi text-muted-fg">
                  {daysLeft} day{daysLeft === 1 ? "" : "s"} left
                </Text>
              </View>
            </View>

            {/* The 4DX lead measures: the things you control this shift. */}
            <Text className="mb-2 mt-6 text-base font-body-semi text-espresso">
              What moves it
            </Text>
            <View className="gap-2.5">
              {levers.length === 0 ? (
                <View className="rounded-3xl border border-border bg-surface p-4">
                  <Text className="text-sm font-body text-muted-fg">
                    No levers apply to your role yet. Check back after your next shift.
                  </Text>
                </View>
              ) : (
                levers.map((lever) => <LeverTile key={lever.key} lever={lever} />)
              )}
            </View>

            {/* Deductions, only when there are any (lateness / absence / reviews). */}
            {deductionTotal > 0 ? (
              <View className="mt-4 rounded-3xl border border-danger/20 bg-danger/5 p-4">
                <View className="flex-row items-center justify-between">
                  <View className="flex-1 pr-3">
                    <Text className="text-sm font-body-semi text-espresso">
                      Deductions
                    </Text>
                    <Text className="mt-0.5 text-xs font-body text-muted-fg">
                      {Number(data.attendance?.lateCount ?? 0)} late ·{" "}
                      {Number(data.attendance?.absentCount ?? 0)} absent
                      {(data.reviewPenalty?.entries?.length ?? 0) > 0
                        ? ` · ${data.reviewPenalty.entries.length} review`
                        : ""}
                    </Text>
                  </View>
                  <Text className="text-base font-body-bold text-danger">
                    - {rm(deductionTotal)}
                  </Text>
                </View>
              </View>
            ) : null}

            {data.tip ? (
              <View className="mt-4 flex-row items-start gap-2 rounded-3xl border border-border bg-surface p-4">
                <TrendingUp color="#A2492C" size={16} />
                <Text className="flex-1 text-xs font-body text-muted-fg">
                  {data.tip}
                </Text>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function LeverTile({ lever }: { lever: AllowanceLever }) {
  const meta = LEVER_META[lever.key] ?? { icon: TrendingUp, blurb: "" };
  const Icon = meta.icon;
  const tier = tierOf(lever.tier);
  const score = pct(lever.score);
  return (
    <View className="rounded-3xl border border-border bg-surface p-4">
      <View className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-2xl bg-primary-50">
          <Icon color="#A2492C" size={19} />
        </View>
        <View className="flex-1">
          <Text className="text-base font-body-semi text-espresso">
            {lever.label}
          </Text>
          <Text className="text-xs font-body text-muted">{meta.blurb}</Text>
        </View>
        <View className={`rounded-full px-2.5 py-1 ${tier.bg}`}>
          <Text className={`text-[11px] font-body-bold ${tier.text}`}>
            {tier.label}
          </Text>
        </View>
      </View>

      <View className="mt-3 h-2 overflow-hidden rounded-full bg-primary-50">
        <View
          className="h-full rounded-full"
          style={{ width: `${score}%`, backgroundColor: tier.color }}
        />
      </View>

      <View className="mt-2 flex-row items-center justify-between">
        <Text className="text-xs font-body text-muted-fg" numberOfLines={1}>
          {lever.detail}
        </Text>
        <Text className="text-xs font-body-bold text-espresso">
          {rm(lever.earned)}{" "}
          <Text className="font-body text-muted">/ {rm(lever.slice)}</Text>
        </Text>
      </View>
    </View>
  );
}
