import Svg, { Path, Circle, Text as SvgText } from "react-native-svg";

type Props = {
  size?: number;
  /** Stroke + wordmark colour. Defaults to terracotta. */
  color?: string;
  /** Tag fill. Defaults to transparent (outlined). */
  fill?: string;
  /** Wordmark colour when fill is solid. */
  knockout?: string;
};

/**
 * Celsius price-tag mark — companion to <CelsiusCup /> and
 * <CelsiusGift />, used on discount-type reward tickets (percent /
 * flat / fixed_amount). Reinforces "this is money off" at a glance,
 * the way the gift mark reinforces "this is a gift" and the cup mark
 * reinforces "this is a free drink".
 *
 * Shape budget: tag silhouette (rectangle with notched corner +
 * grommet hole), short string at the top, "C" letter on the tag
 * face. Same Peachi-Bold "C" as the other brand marks so the set
 * reads as one family.
 */
export function CelsiusTag({ size = 28, color = "#C05040", fill = "transparent", knockout }: Props) {
  const isFilled = fill !== "transparent";
  // Scaled to fill ~y=2..22 of the 24-unit canvas, matching cup and
  // gift so the brand-icon family stays visually consistent at any
  // size (28px in nav, 36px on reward tickets, etc.).
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* Tag string — small angled line connecting the grommet to
          an imaginary anchor point off the top edge. */}
      <Path
        d="M17.5 3.5 L20.5 1"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {/* Tag body — slanted rectangle with a notched left tip pointing
          up-left, like a clothing/price tag. The path describes a
          pentagon: notch tip → top-right → bottom-right → bottom-left
          → notch tip. */}
      <Path
        d="M9 2.5 L21.5 2.5 L21.5 17 L9 17 L2 9.75 Z"
        fill={isFilled ? fill : "transparent"}
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* Grommet hole — small ring near the notch tip */}
      <Circle
        cx="10.5"
        cy="9.75"
        r="1.7"
        fill={isFilled ? (knockout ?? "#FFFFFF") : "transparent"}
        stroke={color}
        strokeWidth="1.3"
      />
      {/* "C" wordmark on the tag face — Peachi-Bold + stroke for the
          same synthetic extra-bold weight cup/gift use. */}
      <SvgText
        x="17"
        y="12.6"
        fontSize="8"
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
