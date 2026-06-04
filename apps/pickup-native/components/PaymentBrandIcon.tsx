import { useState } from "react";
import { View, Text, Platform, Image } from "react-native";
import type { ImageSourcePropType } from "react-native";
import { SvgUri } from "react-native-svg";
import { Wallet, CreditCard } from "lucide-react-native";

// Pick the renderer per file extension. SVGs go through SvgUri (handles
// raster scaling on every device pixel ratio); PNGs and JPGs go through
// the React Native Image component which already handles remote fetch +
// cache. Treat unknown extensions as SVG since most brand kits ship SVG.
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

// Per-method visual identity for the checkout tiles. Three rendering
// modes, picked per brand:
//
//   1. iconUrl — full-color SVG hosted elsewhere (Wikimedia, brand kit,
//      etc.). Renders on a white card-like chip so the logo's native
//      colors aren't clobbered by a tinted background. Used when the
//      merchant has explicitly supplied a URL for that brand.
//   2. iconSlug — single-color mark from cdn.simpleicons.org, tinted to
//      contrast against the brand-color chip. Convenient when the brand
//      is on Simple Icons.
//   3. label — brand-color chip with a short monogram (e.g. "Boost").
//      The fallback when no URL or slug is configured (or both fail to
//      load).
//
// Adding a brand: paste its iconUrl from wherever you sourced it into
// the BRANDS map below. No other changes needed.
// Local PNG assets — bundled at build time. Metro statically resolves
// require() calls so each path must be a string literal.
const FPX_ICON       = require("../assets/pay-icons/FPX Logo.png");
const TNG_ICON       = require("../assets/pay-icons/tng.png");
const BOOST_ICON     = require("../assets/pay-icons/boost.png");
const GRABPAY_ICON   = require("../assets/pay-icons/grab.png");
const SHOPEEPAY_ICON = require("../assets/pay-icons/shopee.png");
const DUITNOW_ICON   = require("../assets/pay-icons/duitnow.png");

type Brand = {
  bg:          string;
  fg:          string;
  label:       string;
  // Preferred: bundled PNG via require(). Renders fast, works offline,
  // no hot-link issues. Falls back to iconUrl / iconSlug / monogram if
  // the asset fails to decode (extremely rare for bundled raster).
  iconSource?: ImageSourcePropType;
  iconUrl?:    string;
  iconSlug?:   string;
  iconFg?:     string;
  border?:     string;
};

const BRANDS: Record<string, Brand> = {
  apple_pay:  { bg: "#FFFFFF", fg: "#3C4043", label: "Pay",   iconSlug: "applepay", iconFg: "000000", border: "#E5E7EB" },
  google_pay: { bg: "#FFFFFF", fg: "#3C4043", label: "GPay",  iconSlug: "googlepay", border: "#E5E7EB" },
  fpx:        { bg: "#1B7A8F", fg: "#FFFFFF", label: "FPX",   iconSource: FPX_ICON       },
  grabpay:    { bg: "#00B14F", fg: "#FFFFFF", label: "Grab",  iconSource: GRABPAY_ICON   },
  tng:        { bg: "#005AAA", fg: "#FFD400", label: "tng",   iconSource: TNG_ICON       },
  boost:      { bg: "#EC008C", fg: "#FFFFFF", label: "Boost", iconSource: BOOST_ICON     },
  shopeepay:  { bg: "#EE4D2D", fg: "#FFFFFF", label: "Pay",   iconSource: SHOPEEPAY_ICON },
  duitnow:    { bg: "#FFFFFF", fg: "#ED1A3B", label: "DuitNow", iconSource: DUITNOW_ICON, border: "#E5E7EB" },
};

type Props = {
  methodId: string;
  size?:    number;
};

// Card chip — generic credit-card glyph on a white card surface with a
// thin border, matching the brand-logo tiles. Stays network-agnostic so
// the tile doesn't imply any specific network is accepted on its own.
function CardChip({ size }: { size: number }) {
  const radius = Math.round(size * 0.28);
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
      <CreditCard size={Math.round(size * 0.52)} color="#1A0200" strokeWidth={2} />
    </View>
  );
}

// Group icon for the E-Wallet category — generic wallet glyph on a white
// card surface with a thin border, matching the brand-logo tiles. Used
// when no specific wallet is picked yet so the tile doesn't visually
// favour one wallet over the others.
function EWalletGroupChip({ size }: { size: number }) {
  const radius = Math.round(size * 0.28);
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
      <Wallet size={Math.round(size * 0.52)} color="#1A0200" strokeWidth={2} />
    </View>
  );
}

export function PaymentBrandIcon({ methodId, size = 36 }: Props) {
  // Composite renderers — must come before the BRANDS lookup since
  // they don't have a single iconSlug or monogram.
  if (methodId === "card")    return <CardChip size={size} />;
  if (methodId === "ewallet") return <EWalletGroupChip size={size} />;

  const brand = BRANDS[methodId];
  const radius = Math.round(size * 0.28);
  const [iconFailed, setIconFailed] = useState(false);

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
        <Wallet size={Math.round(size * 0.5)} color="#A2492C" strokeWidth={2} />
      </View>
    );
  }

  const useSource = !!brand.iconSource && !iconFailed;
  const useUrl    = !useSource && !!brand.iconUrl && !iconFailed;
  // When rendering a full-color logo (local or URL), switch the chip to
  // a white card surface with a thin border so the logo's native colors
  // aren't fighting a tinted background.
  const chipBg     = (useSource || useUrl) ? "#FFFFFF" : brand.bg;
  const chipBorder = (useSource || useUrl) ? "#E5E7EB" : brand.border;

  const inner = (() => {
    if (useSource) {
      const iconSize = Math.round(size * 0.92);
      return (
        <Image
          source={brand.iconSource}
          style={{ width: iconSize, height: iconSize }}
          resizeMode="contain"
          onError={() => setIconFailed(true)}
        />
      );
    }
    if (useUrl) {
      // Fill close to the chip edge — small inset so the logo doesn't
      // touch the chip border. Logos with their own internal padding
      // (most brand kits ship this way) still look right; logos that
      // are tight to the artwork edges look "full bleed" which matches
      // how ZUS and similar apps present brand chips.
      const iconSize = Math.round(size * 0.92);
      if (isPngLike(brand.iconUrl!)) {
        return (
          <Image
            source={{ uri: brand.iconUrl! }}
            style={{ width: iconSize, height: iconSize }}
            resizeMode="contain"
            onError={() => setIconFailed(true)}
          />
        );
      }
      return (
        <SvgUri
          width={iconSize}
          height={iconSize}
          uri={brand.iconUrl!}
          onError={() => setIconFailed(true)}
        />
      );
    }
    if (brand.iconSlug && !iconFailed) {
      const tint = brand.iconFg ?? brand.fg.replace("#", "");
      const iconSize = Math.round(size * 0.6);
      return (
        <SvgUri
          width={iconSize}
          height={iconSize}
          uri={`https://cdn.simpleicons.org/${brand.iconSlug}/${tint}`}
          onError={() => setIconFailed(true)}
        />
      );
    }
    return (
      <Text
        style={{
          color: brand.fg,
          fontSize: Math.round(size * (brand.label.length > 3 ? 0.28 : 0.36)),
          fontFamily: "Peachi-Bold",
          letterSpacing: -0.3,
          lineHeight: Platform.OS === "ios" ? Math.round(size * 0.38) : undefined,
        }}
      >
        {brand.label}
      </Text>
    );
  })();

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: chipBg,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: chipBorder ? 1 : 0,
        borderColor: chipBorder,
      }}
    >
      {inner}
    </View>
  );
}
