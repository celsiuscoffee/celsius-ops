import { View, Text, Platform } from "react-native";
import Svg, { Path } from "react-native-svg";
import { CreditCard } from "lucide-react-native";

// Per-method visual identity for the checkout tiles. We use brand-
// accurate background colors with a clean monogram or simple shape on
// top — recognizable without copying any provider's official logo
// pixel-for-pixel.
type Brand = {
  bg:      string;
  fg:      string;
  label?:  string;   // short text monogram (1–5 chars)
  font?:   "Peachi-Bold" | "SpaceGrotesk_700Bold";
  border?: string;   // outline (used for white chips so they don't disappear)
  glyph?:  "card" | "apple";
};

const BRANDS: Record<string, Brand> = {
  card:       { bg: "#0B1A4A", fg: "#FFFFFF", glyph: "card" },
  apple_pay:  { bg: "#000000", fg: "#FFFFFF", glyph: "apple" },
  google_pay: { bg: "#FFFFFF", fg: "#3C4043", label: "GPay",  border: "#E5E7EB", font: "Peachi-Bold" },
  fpx:        { bg: "#1B7A8F", fg: "#FFFFFF", label: "FPX",   font: "Peachi-Bold" },
  grabpay:    { bg: "#00B14F", fg: "#FFFFFF", label: "Grab",  font: "Peachi-Bold" },
  tng:        { bg: "#005AAA", fg: "#FFD400", label: "tng",   font: "Peachi-Bold" },
  boost:      { bg: "#EC008C", fg: "#FFFFFF", label: "Boost", font: "SpaceGrotesk_700Bold" },
  shopeepay:  { bg: "#EE4D2D", fg: "#FFFFFF", label: "Pay",   font: "Peachi-Bold" },
};

function AppleGlyph({ size, color }: { size: number; color: string }) {
  // Stylized apple silhouette. Reads as the platform mark without being
  // a literal copy of any rights-holder's logo.
  const s = Math.round(size * 0.6);
  return (
    <Svg width={s} height={s} viewBox="0 0 24 24">
      <Path
        d="M16 13c0-3 2-4 2-4-1-2-3-2-4-2-2 0-3 1-4 1s-2-1-4-1c-2 0-4 1-5 4-1 4 1 9 3 11 1 1 2 2 3 2s1-1 3-1 2 1 3 1 2-1 3-2c2-2 3-5 3-5s-3-1-3-4ZM13 4c1-1 1-3 1-3s-2 0-3 1-1 3-1 3 2 0 3-1Z"
        fill={color}
      />
    </Svg>
  );
}

type Props = {
  methodId: string;
  size?:    number;
};

export function PaymentBrandIcon({ methodId, size = 36 }: Props) {
  const brand = BRANDS[methodId];
  const radius = Math.round(size * 0.28);

  // Fallback for unknown methods — keeps the layout stable instead of
  // collapsing to nothing.
  if (!brand) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: "#F2E9DD",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CreditCard size={Math.round(size * 0.5)} color="#C05040" strokeWidth={2} />
      </View>
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: brand.bg,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: brand.border ? 1 : 0,
        borderColor: brand.border,
      }}
    >
      {brand.glyph === "card" ? (
        <CreditCard size={Math.round(size * 0.55)} color={brand.fg} strokeWidth={2} />
      ) : brand.glyph === "apple" ? (
        <AppleGlyph size={size} color={brand.fg} />
      ) : (
        <Text
          style={{
            color: brand.fg,
            // Tight letter sizing so 4–5-char monograms still fit in 36pt
            // chips at default size; scales linearly with size prop.
            fontSize: Math.round(size * (brand.label && brand.label.length > 3 ? 0.28 : 0.36)),
            fontFamily: brand.font ?? "Peachi-Bold",
            letterSpacing: -0.3,
            // Slight optical lift on iOS so caps don't bottom-anchor.
            lineHeight: Platform.OS === "ios" ? Math.round(size * 0.38) : undefined,
          }}
        >
          {brand.label}
        </Text>
      )}
    </View>
  );
}
