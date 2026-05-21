import { useState } from "react";
import { View, Text, Image, Platform } from "react-native";
import { SvgUri } from "react-native-svg";
import type { FpxBank } from "../lib/fpx-banks";

// Single source of truth for how an FPX bank renders as a small chip.
// Used in two places: the picker row inside the bottom-sheet, and the
// inline icon on the Online Banking category row once a bank is picked.
//
// Behaviour:
//   - bank.iconUrl present → white chip with the logo (Image for PNG/JPG,
//     SvgUri for SVG). On load error, falls back to the monogram.
//   - no URL (or URL failed) → brand-color chip with the bank's monogram.
type Props = {
  bank: FpxBank;
  size?: number;
};

function isPngLike(url: string): boolean {
  const lower = url.toLowerCase().split(/[?#]/)[0];
  return (
    lower.endsWith(".png")  ||
    lower.endsWith(".jpg")  ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".gif")
  );
}

export function BankChip({ bank, size = 32 }: Props) {
  const [iconFailed, setIconFailed] = useState(false);
  const useUrl = !!bank.iconUrl && !iconFailed;
  const radius = Math.round(size * 0.3);

  if (useUrl) {
    const iconSize = Math.round(size * 0.92);
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: "#FFFFFF",
          borderWidth: 1,
          borderColor: "#E5E7EB",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {isPngLike(bank.iconUrl!) ? (
          <Image
            source={{ uri: bank.iconUrl! }}
            style={{ width: iconSize, height: iconSize }}
            resizeMode="contain"
            onError={() => setIconFailed(true)}
          />
        ) : (
          <SvgUri
            width={iconSize}
            height={iconSize}
            uri={bank.iconUrl!}
            onError={() => setIconFailed(true)}
          />
        )}
      </View>
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: bank.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          color: bank.fg,
          fontFamily: "Peachi-Bold",
          fontSize: bank.short.length > 2 ? Math.round(size * 0.35) : Math.round(size * 0.44),
          letterSpacing: -0.3,
          lineHeight: Platform.OS === "ios" ? Math.round(size * 0.48) : undefined,
        }}
      >
        {bank.short}
      </Text>
    </View>
  );
}
