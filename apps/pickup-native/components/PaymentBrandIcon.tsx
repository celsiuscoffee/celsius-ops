import { View, Text, Platform } from "react-native";
import { CreditCard } from "lucide-react-native";

// Per-method visual identity for the checkout tiles. Brand-accurate
// background colors with a short monogram label — informational use of
// each method's brand identity, not a reproduction of any provider's
// official logo art.
type Brand = {
  bg:      string;
  fg:      string;
  label?:  string;
  border?: string;
  glyph?:  "card";
};

const BRANDS: Record<string, Brand> = {
  card:       { bg: "#0B1A4A", fg: "#FFFFFF", glyph: "card" },
  apple_pay:  { bg: "#000000", fg: "#FFFFFF", label: "Pay"  },
  google_pay: { bg: "#FFFFFF", fg: "#3C4043", label: "GPay",  border: "#E5E7EB" },
  fpx:        { bg: "#1B7A8F", fg: "#FFFFFF", label: "FPX"  },
  grabpay:    { bg: "#00B14F", fg: "#FFFFFF", label: "Grab" },
  tng:        { bg: "#005AAA", fg: "#FFD400", label: "tng"  },
  boost:      { bg: "#EC008C", fg: "#FFFFFF", label: "Boost" },
  shopeepay:  { bg: "#EE4D2D", fg: "#FFFFFF", label: "Pay"  },
};

type Props = {
  methodId: string;
  size?:    number;
};

export function PaymentBrandIcon({ methodId, size = 36 }: Props) {
  const brand = BRANDS[methodId];
  const radius = Math.round(size * 0.28);

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
      ) : (
        <Text
          style={{
            color: brand.fg,
            fontSize: Math.round(size * (brand.label && brand.label.length > 3 ? 0.28 : 0.36)),
            fontFamily: "Peachi-Bold",
            letterSpacing: -0.3,
            lineHeight: Platform.OS === "ios" ? Math.round(size * 0.38) : undefined,
          }}
        >
          {brand.label}
        </Text>
      )}
    </View>
  );
}
