import { View, Text, Pressable } from "react-native";
import * as Haptics from "expo-haptics";
import type { MemberTier } from "@/lib/rewards";

type Props = {
  tier: MemberTier;
  onPress?: () => void;
};

/**
 * Tier badge card — Sephora-style persistent display + ZUS-style hero card.
 * - Background tinted with the tier's color (subtle).
 * - Icon + name + multiplier badge.
 * - Progress bar to next tier (uses whichever metric is closer:
 *   visits or spend).
 * - Tap to open the full tier detail sheet.
 */
export function TierCard({ tier, onPress }: Props) {
  const color = tier.tier_color ?? "#92400e";
  const icon = tier.tier_icon ?? "☕";
  const name = tier.tier_name ?? "Member";
  const mul = tier.tier_multiplier ?? 1;

  // Compute progress toward next tier.
  // Pick whichever metric (visits vs spend) the user is CLOSER to,
  // so the bar always feels achievable.
  const visitsTotal = tier.next_tier_min_visits ?? 0;
  const visitsCurrent = tier.visits_this_period;
  const visitsPct = visitsTotal > 0 ? Math.min(visitsCurrent / visitsTotal, 1) : 0;

  const spendTotal = tier.next_tier_min_spend ?? 0;
  const spendCurrent = tier.spend_this_period;
  const spendPct = spendTotal > 0 ? Math.min(spendCurrent / spendTotal, 1) : 0;

  const useSpendBar = spendPct > visitsPct && spendTotal > 0;
  const progressPct = tier.next_tier_id ? (useSpendBar ? spendPct : visitsPct) : 1;
  const remainingLabel = tier.next_tier_id
    ? useSpendBar
      ? `RM${tier.spend_to_next_tier.toFixed(0)} more to ${tier.next_tier_name}`
      : `${tier.visits_to_next_tier} visits to ${tier.next_tier_name}`
    : "Top tier reached";

  const inner = (
    <View
      className="rounded-2xl p-5 overflow-hidden"
      style={{
        backgroundColor: hexWithAlpha(color, 0.12),
        borderWidth: 1,
        borderColor: hexWithAlpha(color, 0.25),
      }}
    >
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center" style={{ gap: 10 }}>
          <Text style={{ fontSize: 28 }}>{icon}</Text>
          <View>
            <Text className="text-base font-semibold" style={{ color }}>
              {name}
            </Text>
            <Text className="text-xs text-muted">
              {mul}× points on every order
            </Text>
          </View>
        </View>
        {tier.next_tier_id ? (
          <View
            className="rounded-full px-2.5 py-1"
            style={{ backgroundColor: hexWithAlpha(color, 0.2) }}
          >
            <Text
              className="text-xs font-semibold"
              style={{ color }}
            >
              Tier
            </Text>
          </View>
        ) : null}
      </View>

      {/* Progress bar */}
      <View className="mb-2 h-2 w-full rounded-full overflow-hidden bg-black/10">
        <View
          style={{
            height: "100%",
            width: `${Math.round(progressPct * 100)}%`,
            backgroundColor: color,
            borderRadius: 999,
          }}
        />
      </View>
      <Text className="text-xs text-muted">{remainingLabel}</Text>
    </View>
  );

  if (!onPress) return inner;

  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      className="active:opacity-80"
    >
      {inner}
    </Pressable>
  );
}

// Convert "#rrggbb" to "rgba(r, g, b, alpha)". Falls back to the input
// if the color is anything else.
function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
