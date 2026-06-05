import { View, Text, Pressable } from "react-native";
import * as Haptics from "@/lib/haptics";
import type { MemberTier } from "../lib/rewards";

type Props = {
  tier: MemberTier;
  onPress?: () => void;
};

/**
 * Tier hero card for the Account tab. Designed to read at a glance:
 * - Top color rail in the tier color (Sephora pattern).
 * - Icon tile + tier name + multiplier badge.
 * - Inline progress: "12 / 20 visits → Silver" with a sub-line
 *   "8 more visits to unlock".
 * - Defensive: uses inline styles + explicit margins (no `gap`).
 */
export function TierCard({ tier, onPress }: Props) {
  if (!tier || !tier.tier_name) return null;

  const color = tier.tier_color || "#92400e";
  const icon = tier.tier_icon || "☕";
  const name = tier.tier_name || "Member";
  const mul = tier.tier_multiplier ?? 1;

  const visitsTotal = tier.next_tier_min_visits ?? 0;
  const visitsCurrent = tier.visits_this_period ?? 0;
  const visitsPct = visitsTotal > 0 ? Math.min(visitsCurrent / visitsTotal, 1) : 0;

  const spendTotal = tier.next_tier_min_spend ?? 0;
  const spendCurrent = tier.spend_this_period ?? 0;
  const spendPct = spendTotal > 0 ? Math.min(spendCurrent / spendTotal, 1) : 0;

  const useSpendBar = spendPct > visitsPct && spendTotal > 0;
  const progressPct = tier.next_tier_id ? (useSpendBar ? spendPct : visitsPct) : 1;

  const bgFill = hexWithAlpha(color, 0.08);
  const borderFill = hexWithAlpha(color, 0.18);
  const tileFill = hexWithAlpha(color, 0.18);
  const trackFill = hexWithAlpha(color, 0.15);

  const inner = (
    <View
      style={{
        borderRadius: 16,
        overflow: "hidden",
        backgroundColor: bgFill,
        borderWidth: 1,
        borderColor: borderFill,
      }}
    >
      {/* Top color rail */}
      <View style={{ height: 4, backgroundColor: color }} />

      <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 18 }}>
        {/* Header row */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                backgroundColor: tileFill,
                alignItems: "center",
                justifyContent: "center",
                marginRight: 12,
              }}
            >
              <Text style={{ fontSize: 26 }}>{icon}</Text>
            </View>
            <View>
              <Text
                style={{
                  fontSize: 10,
                  letterSpacing: 1.5,
                  textTransform: "uppercase",
                  color: hexWithAlpha(color, 0.7),
                  fontWeight: "600",
                }}
              >
                Your tier
              </Text>
              <Text
                style={{
                  fontSize: 20,
                  fontWeight: "700",
                  color,
                  marginTop: 2,
                }}
              >
                {name}
              </Text>
            </View>
          </View>
          <View
            style={{
              backgroundColor: color,
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 999,
            }}
          >
            <Text style={{ color: "white", fontSize: 12, fontWeight: "700" }}>
              {mul}× pts
            </Text>
          </View>
        </View>

        {/* Progress strip */}
        {tier.next_tier_id ? (
          <View>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <Text style={{ fontSize: 12, color: "rgba(0,0,0,0.65)" }}>
                {useSpendBar
                  ? `RM${Math.round(spendCurrent)} / RM${spendTotal}`
                  : `${visitsCurrent} / ${visitsTotal} visits`}
              </Text>
              <Text style={{ fontSize: 12, fontWeight: "700", color }}>
                → {tier.next_tier_name}
              </Text>
            </View>
            <View
              style={{
                height: 6,
                borderRadius: 999,
                backgroundColor: trackFill,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  height: 6,
                  width: `${Math.round(progressPct * 100)}%`,
                  backgroundColor: color,
                  borderRadius: 999,
                }}
              />
            </View>
            <Text
              style={{
                fontSize: 11,
                color: "rgba(0,0,0,0.55)",
                marginTop: 8,
              }}
            >
              {useSpendBar
                ? `RM${(tier.spend_to_next_tier ?? 0).toFixed(0)} more to unlock`
                : `${tier.visits_to_next_tier ?? 0} more visit${(tier.visits_to_next_tier ?? 0) === 1 ? "" : "s"} to unlock`}
            </Text>
          </View>
        ) : (
          <Text style={{ fontSize: 13, fontWeight: "700", color }}>
            You&apos;ve reached the top tier
          </Text>
        )}
      </View>
    </View>
  );

  if (!onPress) return inner;

  return (
    <Pressable
      onPress={() => {
        try {
          Haptics.selectionAsync();
        } catch {
          /* no-op */
        }
        onPress();
      }}
    >
      {inner}
    </Pressable>
  );
}

function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return `rgba(146, 64, 14, ${alpha})`;
  const num = parseInt(m[1], 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
