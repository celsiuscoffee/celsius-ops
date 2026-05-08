import { ReactNode, useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Pattern, Rect, Stop } from "react-native-svg";
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
 * Layered fills painted via react-native-svg (already in the installed
 * native binary, so this is OTA-safe — expo-linear-gradient would have
 * required a rebuild):
 *
 *   1. Base panel — deepest gradient stop, owns the tier identity colour.
 *   2. Tier gradient — the 3-stop linear from tier-styles, vertical
 *      (top-light → bottom-deep). Gives Platinum a brushed-metal
 *      sheen, Gold real richness, Silver a cool curve.
 *   3. Hairline texture — horizontal 0.5px lines at 4% white, 4px
 *      vertical rhythm. Reads like rib paper / letterpress, brand-aligned
 *      with the poster aesthetic. Subtle enough not to fight typography.
 *   4. Top-edge highlight — transparent-to-white-7% gradient over the
 *      top ~35% of the panel, simulating a polished light catch.
 *      Tier-agnostic.
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
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  const [g0, g1, g2] = style.gradient;
  const baseBg = g2 ?? g1 ?? g0;
  const stops = g2 ? [g0, g1, g2] : [g0, g1, g1];

  return (
    <View
      onLayout={onLayout}
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
      {size && (
        <Svg
          width={size.w}
          height={size.h}
          style={{ position: "absolute", top: 0, left: 0 }}
          pointerEvents="none"
        >
          <Defs>
            <SvgLinearGradient id="tierGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={stops[0]} stopOpacity="1" />
              <Stop offset="0.5" stopColor={stops[1]} stopOpacity="1" />
              <Stop offset="1" stopColor={stops[2]} stopOpacity="1" />
            </SvgLinearGradient>
            <SvgLinearGradient id="topHighlight" x1="0" y1="0" x2="0" y2="0.35">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.07" />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
            </SvgLinearGradient>
            {/* Hairline rib pattern — single thin white line every 4px.
                Reads as fine ribbed paper / letterpress at low opacity. */}
            <Pattern id="hairlines" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
              <Rect x="0" y="0" width="4" height="0.5" fill="#FFFFFF" fillOpacity="0.04" />
            </Pattern>
          </Defs>
          <Rect x="0" y="0" width={size.w} height={size.h} fill="url(#tierGrad)" />
          <Rect x="0" y="0" width={size.w} height={size.h} fill="url(#hairlines)" />
          <Rect x="0" y="0" width={size.w} height={size.h} fill="url(#topHighlight)" />
        </Svg>
      )}
      <View>{children}</View>
    </View>
  );
}
