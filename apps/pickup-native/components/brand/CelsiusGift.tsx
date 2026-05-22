import Svg, { Path, Rect, Text as SvgText } from "react-native-svg";

type Props = {
  size?: number;
  /** Box stroke + wordmark colour. Defaults to terracotta. */
  color?: string;
  /** Box body fill. Defaults to transparent (outlined box). */
  fill?: string;
  /** Wordmark colour when fill is solid. */
  knockout?: string;
};

/**
 * Celsius gift mark — simple flat silhouette with a "C" letter on the
 * box face. Companion to <CelsiusCup />, used for auto-issued rewards
 * (welcome BOGO, birthday) where the gift framing reads better than
 * the cup. Hand-authored SVG so it scales crisp and recolours per
 * surface.
 *
 * Shape budget: box body (rounded square), vertical ribbon, simple
 * bow loops, "C" letter. No bow strings, no extra ornaments — matches
 * the rectangular brand-block intent of the CC system.
 */
export function CelsiusGift({ size = 28, color = "#A2492C", fill = "transparent", knockout }: Props) {
  const isFilled = fill !== "transparent";
  // Scaled to fill ~y=2..22 of the 24-unit canvas, matching the
  // visual presence of the lucide outline icons and the resized
  // CelsiusCup so the brand-icon family stays consistent.
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* Bow — two loops above the box, taller and wider */}
      <Path
        d="M12 5 C8 2 5.5 2 6.2 5.5 C6.8 7.8 10.5 6.8 12 5 C13.5 6.8 17.2 7.8 17.8 5.5 C18.5 2 16 2 12 5 Z"
        fill={isFilled ? fill : "transparent"}
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* Box body */}
      <Rect
        x="2.5"
        y="8"
        width="19"
        height="14"
        rx="1.8"
        fill={isFilled ? fill : "transparent"}
        stroke={color}
        strokeWidth="1.6"
      />
      {/* Vertical ribbon down the middle */}
      <Rect
        x="10.7"
        y="8"
        width="2.6"
        height="14"
        fill={color}
      />
      {/* "C" wordmark on the box face (left of ribbon) — Peachi-Bold
          stroked in the same colour as the fill to synthesize an
          extra-bold weight (the font file only ships Regular/Medium/
          Bold, so this gets us heavier without a fourth file). */}
      <SvgText
        x="6.6"
        y="17.4"
        fontSize="8.5"
        textAnchor="middle"
        fill={isFilled ? (knockout ?? "#FFFFFF") : color}
        stroke={isFilled ? (knockout ?? "#FFFFFF") : color}
        strokeWidth="0.5"
        fontFamily="Peachi-Bold"
      >
        C
      </SvgText>
    </Svg>
  );
}
