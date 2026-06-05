import { View, Text, Pressable } from "react-native";
import * as Haptics from "@/lib/haptics";
import type { MemberTier } from "../lib/rewards";

type Props = {
  tier: MemberTier;
  onPress?: () => void;
  tone?: "dark" | "light";
};

/**
 * Compact inline tier badge — for headers / inline contexts.
 * Shows icon + tier name + multiplier on one line.
 *
 * Defensive: no `gap` style (Yoga support varies), uses margins on
 * children. No external icon imports.
 */
export function TierBadge({ tier, onPress, tone = "dark" }: Props) {
  if (!tier || !tier.tier_name) return null;
  const color = tier.tier_color || "#92400e";
  const mul = tier.tier_multiplier ?? 1;

  const bg = tone === "dark" ? "rgba(255,255,255,0.10)" : hexWithAlpha(color, 0.12);
  const fg = tone === "dark" ? "#FFFFFF" : color;
  const sub = tone === "dark" ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.55)";

  const inner = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: bg,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
      }}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: "700",
          color: fg,
          marginRight: 6,
        }}
      >
        {tier.tier_name}
      </Text>
      <Text style={{ fontSize: 11, color: sub }}>{mul}× pts</Text>
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
