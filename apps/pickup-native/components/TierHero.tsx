import { ReactNode } from "react";
import { View, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
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
 * Two stacked gradient layers on top of a solid base:
 *   1. Base panel — deepest gradient stop, owns the tier identity colour.
 *   2. Tier gradient — the 3-stop linear from tier-styles, vertical
 *      (top-light → bottom-deep). Gives Platinum a brushed-metal
 *      sheen, Gold real richness, Silver a cool curve.
 *   3. Top-edge highlight — a thin transparent-to-white-4% gradient
 *      capped at ~30% of the height. Reads as a polished light catch
 *      on the panel rather than a flat slab. Tier-agnostic since
 *      white-on-anything reads as light.
 *
 * No curves, no draping, no ornaments — the rectangular brand-block
 * intent (CC Brand System v2026) is preserved; we're just letting
 * the existing tier gradients actually render.
 */
export function TierHero({
  style,
  paddingTop,
  paddingBottom = 24,
  variant = "compact",
  children,
}: Props) {
  // Solid fallback colour, in case the gradient layers fail to paint
  // for any reason (Android edge cases, low-end devices). Customers
  // still see the tier identity colour underneath.
  const [g0, g1, g2] = style.gradient;
  const baseBg = g2 ?? g1 ?? g0;

  // Whether to direction the gradient with a hint of warmth. We let
  // tier-styles define the stops directly — Platinum, Gold, Silver,
  // Member each have their own curve baked in.
  const stops = (g2 ? [g0, g1, g2] : [g0, g1]) as [string, string, ...string[]];

  return (
    <View
      style={{
        paddingTop,
        paddingBottom,
        paddingHorizontal: 16,
        backgroundColor: baseBg,
        minHeight: variant === "tall" ? 200 : 110,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <LinearGradient
        colors={stops}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Top-edge highlight — soft white wash that fades out a third
          of the way down. Reads as light catching the panel rather
          than a flat coloured slab. Tier-agnostic. */}
      <LinearGradient
        colors={["rgba(255,255,255,0.06)", "rgba(255,255,255,0)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 0.35 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View>{children}</View>
    </View>
  );
}
