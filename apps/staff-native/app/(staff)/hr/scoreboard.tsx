import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import {
  BadgeCheck,
  ChevronRight,
  Star,
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
import { useCelsius, type ColorName } from "../../../lib/celsius-ui";

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
  phone: { icon: Smartphone, blurb: "Ask every customer for their number" },
  serving: { icon: Timer, blurb: "Keep serve time under target" },
  audit: { icon: BadgeCheck, blurb: "Your outlet's audit score" },
};

// under / ok / perform -> label + colours (mirrors the allowance tier colours).
const TIER = {
  perform: { label: "Perform", color: "ok", bg: "bg-ok-soft", text: "text-ok-text" },
  ok: { label: "On track", color: "info", bg: "bg-info-soft", text: "text-info-text" },
  under: { label: "Build up", color: "line-2", bg: "bg-sunken", text: "text-text-2" },
} as const satisfies Record<string, { label: string; color: ColorName; bg: string; text: string }>;

function tierOf(t: string) {
  return TIER[t as keyof typeof TIER] ?? TIER.under;
}

export default function ScoreboardScreen() {
  const C = useCelsius().color;
  const [data, setData] = useState<AllowanceBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deductionsOpen, setDeductionsOpen] = useState(false);

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
      <PageHeader title="My scoreboard" back />
      <ScrollView
        contentContainerClassName="pb-8"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C["text-3"]}
            colors={[C["text-3"]]}
          />
        }
      >
        {loading ? (
          <View className="flex-1 items-center justify-center py-24">
            <ActivityIndicator color={C["text-3"]} />
          </View>
        ) : error ? (
          <View className="mt-6 rounded-2xl border border-danger bg-danger-soft p-5">
            <Text className="text-sm font-body text-danger-text">{error}</Text>
          </View>
        ) : data && !data.eligible ? (
          <View className="mt-8 items-center px-6">
            <View className="mb-3 h-14 w-14 items-center justify-center rounded-2xl bg-sunken">
              <Trophy color={C["text-2"]} size={26} />
            </View>
            <Text className="text-center text-base font-display-medium text-text">
              No performance pool yet
            </Text>
            <Text className="mt-1 text-center text-sm font-body text-text-2">
              {data.tip || "The performance allowance is for full-time staff."}
            </Text>
          </View>
        ) : data ? (
          <>
            {/* Hero: the payoff. RM earned so far out of the monthly pool. */}
            <View className="mt-4 rounded-2xl border border-line-2 bg-sunken p-5">
              <View className="flex-row items-center gap-2">
                <Trophy color={C["text-2"]} size={16} />
                <Text className="text-xs font-body-semi text-text">
                  {monthLabel} performance
                </Text>
              </View>
              <View className="mt-2 flex-row items-end gap-1.5">
                <Text className="text-4xl font-display text-text">
                  {rm(earned)}
                </Text>
                <Text className="mb-1 text-sm font-body text-text-2">
                  of {rm(max)}
                </Text>
              </View>
              <View className="mt-3 h-2.5 overflow-hidden rounded-full bg-sunken">
                <View
                  className="h-full rounded-full bg-ink"
                  style={{ width: `${pct(progress)}%` }}
                />
              </View>
              <View className="mt-2.5 flex-row items-center justify-between">
                <Text className="text-xs font-body text-text-2">
                  {performCount > 0
                    ? `Top tier on ${performCount} of ${levers.length} levers`
                    : "Push a lever to Perform to earn more"}
                </Text>
                <Text className="text-xs font-body-semi text-text-2">
                  {daysLeft} day{daysLeft === 1 ? "" : "s"} left
                </Text>
              </View>
            </View>

            {/* The 4DX lead measures: the things you control this shift. */}
            <Text className="mb-2 mt-6 text-base font-body-semi text-text">
              What moves it
            </Text>
            <View className="gap-2.5">
              {levers.length === 0 ? (
                <View className="rounded-2xl border border-line bg-surface p-4">
                  <Text className="text-sm font-body text-text-2">
                    No levers apply to your role yet. Check back after your next shift.
                  </Text>
                </View>
              ) : (
                levers.map((lever) => <LeverTile key={lever.key} lever={lever} />)
              )}
            </View>

            {/* Deductions, only when there are any (lateness / absence /
                reviews). Tap for the itemised reasons (moved here from the
                old HR screen, which repeated this whole card). */}
            {deductionTotal > 0 ? (
              <View className="mt-4 rounded-2xl border border-danger bg-surface p-4">
                <Pressable
                  onPress={() => setDeductionsOpen((v) => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: deductionsOpen }}
                  className="min-h-11 flex-row items-center justify-between active:opacity-70"
                >
                  <View className="flex-1 pr-3">
                    <Text className="text-base font-body-semi text-text">Deductions</Text>
                    <Text className="mt-0.5 text-sm font-body text-text-2">
                      {Number(data.attendance?.lateCount ?? 0)} late ·{" "}
                      {Number(data.attendance?.absentCount ?? 0)} absent
                      {(data.reviewPenalty?.entries?.length ?? 0) > 0
                        ? ` · ${data.reviewPenalty.entries.length} review`
                        : ""}
                    </Text>
                  </View>
                  <Text className="mr-2 text-base font-body-bold text-danger-text">
                    - {rm(deductionTotal)}
                  </Text>
                  <ChevronRight
                    color={C["text-3"]}
                    size={18}
                    style={{ transform: [{ rotate: deductionsOpen ? "90deg" : "0deg" }] }}
                  />
                </Pressable>
                {deductionsOpen ? (
                  <View className="mt-2 gap-2 border-t border-line pt-3">
                    {(data.attendance?.deductions ?? []).map((d, i) => (
                      <View key={`att-${i}`} className="flex-row items-start justify-between gap-2">
                        <Text className="flex-1 text-sm font-body text-text">
                          {d.date ? <Text className="text-text-3">{d.date}{"  "}</Text> : null}
                          {d.label}
                        </Text>
                        <Text className="text-sm font-body-semi text-danger-text">- {rm(d.amount)}</Text>
                      </View>
                    ))}
                    {(data.reviewPenalty?.entries ?? []).map((e) => (
                      <View key={`rev-${e.id}`} className="gap-0.5">
                        <View className="flex-row items-center justify-between gap-2">
                          <View className="flex-row items-center">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star
                                key={i}
                                size={12}
                                color={C.danger}
                                fill={i < e.rating ? C.danger : "transparent"}
                              />
                            ))}
                            <Text className="ml-1.5 text-xs font-body text-text-3">{e.reviewDate}</Text>
                          </View>
                          <Text className="text-sm font-body-semi text-danger-text">- {rm(e.amount)}</Text>
                        </View>
                        {e.reviewText ? (
                          <Text className="text-sm font-body italic text-text-2" numberOfLines={2}>
                            “{e.reviewText}”
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            {data.tip ? (
              <View className="mt-4 flex-row items-start gap-2 rounded-2xl border border-line bg-surface p-4">
                <TrendingUp color={C["text-2"]} size={16} />
                <Text className="flex-1 text-xs font-body text-text-2">
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
  const C = useCelsius().color;
  const meta = LEVER_META[lever.key] ?? { icon: TrendingUp, blurb: "" };
  const Icon = meta.icon;
  const tier = tierOf(lever.tier);
  const score = pct(lever.score);
  return (
    <View className="rounded-2xl border border-line bg-surface p-4">
      <View className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-2xl bg-sunken">
          <Icon color={C["text-2"]} size={19} />
        </View>
        <View className="flex-1">
          <Text className="text-base font-body-semi text-text">
            {lever.label}
          </Text>
          <Text className="text-xs font-body text-text-3">{meta.blurb}</Text>
        </View>
        <View className={`rounded-full px-2.5 py-1 ${tier.bg}`}>
          <Text className={`text-xs font-body-bold ${tier.text}`}>
            {tier.label}
          </Text>
        </View>
      </View>

      <View className="mt-3 h-2 overflow-hidden rounded-full bg-sunken">
        <View
          className="h-full rounded-full"
          style={{ width: `${score}%`, backgroundColor: C[tier.color] }}
        />
      </View>

      <View className="mt-2 flex-row items-center justify-between">
        <Text className="text-xs font-body text-text-2" numberOfLines={1}>
          {lever.detail}
        </Text>
        <Text className="text-xs font-body-bold text-text">
          {rm(lever.earned)}{" "}
          <Text className="font-body text-text-3">/ {rm(lever.slice)}</Text>
        </Text>
      </View>
    </View>
  );
}

// Route-level boundary: a throw in this screen degrades to an inline retry
// card instead of unmounting the whole HR stack (see the Who's Working
// incident, docs in components/RouteErrorBoundary.tsx).
export { RouteErrorFallback as ErrorBoundary } from "../../../components/RouteErrorBoundary";
