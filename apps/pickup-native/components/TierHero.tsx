import { ReactNode } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import Svg, {
  Defs,
  LinearGradient as SvgLinearGradient,
  Path,
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
 * Tier-themed hero header. Three layers:
 *
 *   1. Multi-stop linear gradient — the tier color signature.
 *      Platinum: [#3A3D45 → #0A0C12 → #000000] (black metallic)
 *      Gold:     [#FFF8DC → #FFD700 → #5C3A0A] (true gold)
 *      Silver:   [#F8F9FA → #C0C0C0 → #3F4751] (polished silver)
 *      Member:   [#F2A88E → #E2725B → #A04A35] (terracotta)
 *   2. One ghosted coffee-bean ornament off the top-right edge —
 *      coffee motif without becoming a literal product photo.
 *   3. Curved bottom edge that drapes into the page below.
 *
 * Children render in a normal RN View on top. SVG layers fill behind
 * via absoluteFill. Compact variant ~140px (Home), tall ~220px
 * (Rewards / Account where a hero statement needs more room).
 */
export function TierHero({
  style,
  paddingTop,
  paddingBottom = 28,
  variant = "compact",
  children,
}: Props) {
  const [g0, g1, g2] = style.gradient;
  // Light tiers (Silver/Member) skip the bean — it muddies the gradient.
  const showBean = g0 !== "#F8F9FA" && g0 !== "#F2A88E";

  return (
    <View
      style={{
        paddingTop,
        paddingBottom,
        paddingHorizontal: 16,
        overflow: "hidden",
        minHeight: variant === "tall" ? 200 : undefined,
        position: "relative",
      }}
    >
      {/* Background gradient + ornament */}
      <Svg
        height="100%"
        width="100%"
        style={StyleSheet.absoluteFill}
        preserveAspectRatio="none"
      >
        <Defs>
          <SvgLinearGradient id="tierGrad" x1="0" y1="0" x2="0.5" y2="1">
            {(g2
              ? [
                  <Stop key="0" offset="0" stopColor={g0} />,
                  <Stop key="1" offset="0.55" stopColor={g1} />,
                  <Stop key="2" offset="1" stopColor={g2} />,
                ]
              : [
                  <Stop key="0" offset="0" stopColor={g0} />,
                  <Stop key="1" offset="1" stopColor={g1} />,
                ])}
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

      {/* Curved bottom — sits at the bottom edge, fills exactly to the
          page background colour so the body below "peeks out" under
          the hero (Luckin / Manner pattern). */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          bottom: -1,
          left: 0,
          right: 0,
          height: 22,
        }}
      >
        <Svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${SCREEN_W} 22`}
          preserveAspectRatio="none"
        >
          <Path
            d={`M0,22 L0,12 C${SCREEN_W * 0.25},-4 ${SCREEN_W * 0.75},-4 ${SCREEN_W},12 L${SCREEN_W},22 Z`}
            fill="#f5f5f5"
          />
        </Svg>
      </View>
    </View>
  );
}
