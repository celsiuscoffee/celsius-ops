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
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* Tag string — small angled line connecting the grommet to
          an imaginary anchor point off the top edge. */}
      <Path
        d="M16.5 4.5 L19 2"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      {/* Tag body — slanted rectangle with a notched left tip pointing
          up-left, like a clothing/price tag. The path describes a
          pentagon: notch tip → top-right → bottom-right → bottom-left
          → notch tip. */}
      <Path
        d="M9.5 3.5 L20.5 3.5 L20.5 14.5 L9.5 14.5 L4 9 Z"
        fill={isFilled ? fill : "transparent"}
        stroke={color}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* Grommet hole — small ring near the notch tip */}
      <Circle
        cx="11"
        cy="9"
        r="1.4"
        fill={isFilled ? (knockout ?? "#FFFFFF") : "transparent"}
        stroke={color}
        strokeWidth="1.2"
      />
      {/* "C" wordmark on the tag face — Peachi-Bold + stroke for the
          same synthetic extra-bold weight cup/gift use. */}
      <SvgText
        x="16.5"
        y="11.6"
        fontSize="6.5"
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
