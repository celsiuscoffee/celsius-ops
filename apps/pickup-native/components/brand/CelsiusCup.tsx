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
  /** When true, mimics lucide's active-tab treatment: thicker outline
   *  (matches lucide strokeWidth=2.4) plus an 8% colour wash inside
   *  the cup body — same "subtle filled" look the other tabs use. */
  active?: boolean;
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
 *
 * The `active` flag aligns the bottom-nav usage with the lucide
 * outline icons on the other tabs — same stroke-thickness shift and
 * same 8% body wash when the tab is selected, so the brand mark
 * doesn't look like an outlier in the row.
 */
export function CelsiusCup({ size = 28, color = "#C05040", fill = "transparent", knockout, active = false }: Props) {
  const isFilled = fill !== "transparent";
  // Lucide outline icons in the bottom nav use strokeWidth 1.75 inactive
  // / 2.4 active. We map the SVG outline stroke to those exact values
  // so the visual weight matches across the tab row.
  const strokeWidth = active ? 2.4 : 1.75;
  // The 8% wash mirrors the bottom-nav treatment for the active lucide
  // icons (`fillOpacity={active ? 0.08 : 0}`). Skipped when the cup is
  // already explicitly filled (e.g. on a reward ticket's espresso stub).
  const bodyFill = isFilled ? fill : active ? color : "transparent";
  const bodyFillOpacity = isFilled ? 1 : active ? 0.08 : 0;
  // 24-unit canvas — the cup now spans ~x=2.5..21.5 horizontally
  // (lid) and ~x=3..21 (body top), matching lucide's typical
  // x=2..22 silhouette width. Earlier draft only spanned x=3.5..20.5,
  // so the icon read narrower than its tab-row neighbours even at
  // identical size={26}.
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* Lid — slightly wider than the cup mouth */}
      <Rect
        x="2.5"
        y="2"
        width="19"
        height="3"
        rx="1"
        fill={bodyFill}
        fillOpacity={bodyFillOpacity}
        stroke={color}
        strokeWidth={strokeWidth}
      />
      {/* Cup body — tapered trapezoid via path with rounded base */}
      <Path
        d="M3 5.5 H21 L19.3 22 a1.5 1.5 0 0 1 -1.5 1.3 H6.2 a1.5 1.5 0 0 1 -1.5 -1.3 Z"
        fill={bodyFill}
        fillOpacity={bodyFillOpacity}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      {/* "C" wordmark on the cup face — Peachi-Bold to match the
          rest of the app's brand typography (greeting, headlines,
          prices). Synthesised extra-bold via a same-colour stroke,
          since the font file only ships Regular/Medium/Bold. */}
      <SvgText
        x="12"
        y="17.5"
        fontSize="12"
        textAnchor="middle"
        fill={isFilled ? (knockout ?? "#FFFFFF") : color}
        stroke={isFilled ? (knockout ?? "#FFFFFF") : color}
        strokeWidth="0.6"
        fontFamily="Peachi-Bold"
      >
        C
      </SvgText>
    </Svg>
  );
}
