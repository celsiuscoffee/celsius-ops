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
 * Implementation note: kept dependency-free on purpose. SVG-based
 * gradients caused repeated rendering issues on iOS where the View
 * would shrink to fit only the first child (eyebrow only) and the
 * rest of the children would render on the page background. So this
 * version uses pure RN: solid `backgroundColor` from the tier's
 * deepest gradient stop, soft bottom corners via borderBottomRadius
 * for the "drape into body" feel, and lets the View size itself
 * naturally to its children.
 *
 * Visual cost: no in-hero gradient or floating bean ornament, only
 * a single solid colour. Worth the trade for reliable rendering —
 * tier identity already comes through via the colour itself plus
 * the eyebrow, name, and pill that the children render on top.
 */
export function TierHero({
  style,
  paddingTop,
  paddingBottom = 24,
  variant = "compact",
  children,
}: Props) {
  // Pick the gradient's deepest stop as the solid bg — that's the
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
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
      }}
    >
      {children}
    </View>
  );
}
