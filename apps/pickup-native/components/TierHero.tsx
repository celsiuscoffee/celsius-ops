import { ReactNode } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import Svg, {
  Defs,
  LinearGradient as SvgLinearGradient,
  Rect,
  Stop,
  Ellipse,
} from "react-native-svg";
import type { TierStyle } from "../lib/tier-styles";

type Props = {
  style: TierStyle;
  paddingTop: number;
  paddingBottom?: number;
  /** Tall hero (Rewards/Account) vs compact (Home). */
  variant?: "compact" | "tall";
  children: ReactNode;
};

const { width: SCREEN_W } = Dimensions.get("window");

/**
 * Tier-themed hero header. Layers, back-to-front:
 *
 *   1. Solid backgroundColor on the View (gradient end-stop). Acts as
 *      a fallback in case the SVG gradient fails to fill — without
 *      this, content can bleed through to the page bg below the View.
 *   2. Multi-stop linear gradient inside an absolute SVG.
 *   3. Optional ghosted bean ornament off the upper-right corner.
 *
 * Soft bottom corners via borderBottomRadius give the "draping into
 * the body" effect without needing an SVG curve overlay (which had
 * z-index trouble on RN-web — children at the bottom of the hero got
 * painted UNDER the curve fill and ended up looking like body text
 * sitting on the page background).
 *
 * Compact variant ~140px (Home), tall variant min-height 200px
 * (Rewards / Account where a hero statement needs more room).
 */
export function TierHero({
  style,
  paddingTop,
  paddingBottom = 24,
  variant = "compact",
  children,
}: Props) {
  const [g0, g1, g2] = style.gradient;
  const showBean = g0 !== "#F8F9FA" && g0 !== "#F2A88E";
  // Last stop drives the fallback colour — most pixels of the hero
  // sit near the bottom of the gradient, so any rendering gap matches.
  const fallbackBg = g2 ?? g1 ?? g0;

  return (
    <View
      style={{
        paddingTop,
        paddingBottom,
        paddingHorizontal: 16,
        overflow: "hidden",
        minHeight: variant === "tall" ? 200 : undefined,
        position: "relative",
        backgroundColor: fallbackBg,
        // Soft bottom curves — the "drape into body" effect.
        borderBottomLeftRadius: 28,
        borderBottomRightRadius: 28,
      }}
    >
      <Svg
        height="100%"
        width="100%"
        style={StyleSheet.absoluteFill}
        preserveAspectRatio="none"
      >
        <Defs>
          <SvgLinearGradient id="tierGrad" x1="0" y1="0" x2="0.5" y2="1">
            {g2
              ? [
                  <Stop key="0" offset="0" stopColor={g0} />,
                  <Stop key="1" offset="0.55" stopColor={g1} />,
                  <Stop key="2" offset="1" stopColor={g2} />,
                ]
              : [
                  <Stop key="0" offset="0" stopColor={g0} />,
                  <Stop key="1" offset="1" stopColor={g1} />,
                ]}
          </SvgLinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#tierGrad)" />
        {showBean ? (
          <Ellipse
            cx={SCREEN_W * 0.92}
            cy={70}
            rx={56}
            ry={82}
            fill="rgba(180, 140, 80, 0.16)"
            transform={`rotate(-22 ${SCREEN_W * 0.92} 70)`}
          />
        ) : null}
      </Svg>

      {children}
    </View>
  );
}
