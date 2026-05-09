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
export function CelsiusGift({ size = 28, color = "#C05040", fill = "transparent", knockout }: Props) {
  const isFilled = fill !== "transparent";
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* Bow — two loops above the box */}
      <Path
        d="M12 6 C9 4 7 4 7.5 6.4 C8 8.2 10.5 7.4 12 6 C13.5 7.4 16 8.2 16.5 6.4 C17 4 15 4 12 6 Z"
        fill={isFilled ? fill : "transparent"}
        stroke={color}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      {/* Box body */}
      <Rect
        x="3.5"
        y="9"
        width="17"
        height="11"
        rx="1.6"
        fill={isFilled ? fill : "transparent"}
        stroke={color}
        strokeWidth="1.4"
      />
      {/* Vertical ribbon down the middle */}
      <Rect
        x="11"
        y="9"
        width="2"
        height="11"
        fill={color}
      />
      {/* "C" wordmark on the box face (left of ribbon) — Peachi-Bold
          stroked in the same colour as the fill to synthesize an
          extra-bold weight (the font file only ships Regular/Medium/
          Bold, so this gets us heavier without a fourth file). */}
      <SvgText
        x="7.4"
        y="17"
        fontSize="7"
        textAnchor="middle"
        fill={isFilled ? (knockout ?? "#FFFFFF") : color}
        stroke={isFilled ? (knockout ?? "#FFFFFF") : color}
        strokeWidth="0.4"
        fontFamily="Peachi-Bold"
      >
        C
      </SvgText>
    </Svg>
  );
}
