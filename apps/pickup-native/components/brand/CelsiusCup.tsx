import Svg, { Path, Rect, Text as SvgText } from "react-native-svg";

type Props = {
  size?: number;
  /** Stroke + wordmark colour. Defaults to terracotta. */
  color?: string;
  /** Cup body fill. Defaults to transparent (outlined cup). */
  fill?: string;
  /** Background colour the icon will sit on — used as the wordmark
   *  cutout so the "C" reads as a knockout when fill is solid. */
  knockout?: string;
};

/**
 * Celsius takeaway cup mark — simple flat silhouette with a "C" letter
 * baked into the cup face. Hand-authored SVG so it scales crisp at any
 * tab/icon/anchor size and recolours per surface (terracotta on cream,
 * white on espresso, amber on gold-tier).
 *
 * Shape budget: cup body (rounded trapezoid), lid, "C" letter. No
 * steam, no straw, no detail — matches the rectangular brand-block
 * intent of the CC system.
 */
export function CelsiusCup({ size = 28, color = "#C05040", fill = "transparent", knockout }: Props) {
  const isFilled = fill !== "transparent";
  // 24-unit canvas; the icon sits comfortably inside a [2..22] frame.
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* Lid — slightly wider than the cup mouth */}
      <Rect
        x="4.5"
        y="3.5"
        width="15"
        height="2.5"
        rx="0.8"
        fill={isFilled ? fill : "transparent"}
        stroke={color}
        strokeWidth="1.4"
      />
      {/* Cup body — tapered trapezoid via cubic path */}
      <Path
        d="M5.5 6.5 H18.5 L17 21 a1.4 1.4 0 0 1 -1.4 1.2 H8.4 a1.4 1.4 0 0 1 -1.4 -1.2 Z"
        fill={isFilled ? fill : "transparent"}
        stroke={color}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* "C" wordmark on the cup face — knockout when filled, color
          when outlined. Uses SVG <Text> so it inherits the system
          font; we deliberately don't use Peachi here to keep the
          mark identifiable at 16-22px. */}
      <SvgText
        x="12"
        y="16.4"
        fontSize="9"
        fontWeight="900"
        textAnchor="middle"
        fill={isFilled ? (knockout ?? "#FFFFFF") : color}
        fontFamily="Helvetica"
      >
        C
      </SvgText>
    </Svg>
  );
}
