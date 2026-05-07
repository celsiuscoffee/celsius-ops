import { ReactNode } from "react";
import { View } from "react-native";
import type { TierStyle } from "../lib/tier-styles";

type Props = {
  style: TierStyle;
  paddingTop: number;
  paddingBottom?: number;
  /** Tall hero (Rewards/Account) vs compact (Home). */
  variant?: "compact" | "tall";
  children: ReactNode;
};

/**
 * Tier-themed hero header.
 *
 * Brand-system aligned: solid colour panel, flat edges, no curves
 * or decorative gradients. The CC Brand System v2026 marketing
 * materials use clean rectangular blocks of brand colour (the
 * orange "Brand Identity" sheet, the espresso-black
 * "Gastrohub Nilai" outlet poster) — soft borders or curved drape
 * effects don't appear anywhere in the system.
 *
 * Tier identity is carried by:
 *   - the panel colour itself (gradient's deepest stop)
 *   - typography on top (eyebrow + name)
 *   - children styling (tier accent on points pill, etc.)
 */
export function TierHero({
  style,
  paddingTop,
  paddingBottom = 24,
  variant = "compact",
  children,
}: Props) {
  // Pick the gradient's deepest stop as the solid bg — the
  // colour customers most associate with the tier (Platinum=black,
  // Gold=deep amber, Silver=slate, Member=deep terracotta).
  const [, g1, g2] = style.gradient;
  const bg = g2 ?? g1 ?? style.gradient[0];

  return (
    <View
      style={{
        paddingTop,
        paddingBottom,
        paddingHorizontal: 16,
        backgroundColor: bg,
        minHeight: variant === "tall" ? 200 : 110,
      }}
    >
      {children}
    </View>
  );
}
