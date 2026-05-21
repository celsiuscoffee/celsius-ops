import { useState } from "react";
import { View, Text, Platform, Image } from "react-native";
import { SvgUri } from "react-native-svg";
import { Wallet, CreditCard } from "lucide-react-native";

// Pick the renderer per file extension. SVGs go through SvgUri (handles
// raster scaling on every device pixel ratio); PNGs and JPGs go through
// the React Native Image component which already handles remote fetch +
// cache. Treat unknown extensions as SVG since most brand kits ship SVG.
function isPngLike(url: string): boolean {
  const lower = url.toLowerCase().split(/[?#]/)[0];
  return lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg");
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
type Brand = {
  bg:        string;
  fg:        string;
  label:     string;
  iconUrl?:  string;   // full URL → renders on white chip
  iconSlug?: string;   // simpleicons.org slug → tinted on brand chip
  iconFg?:   string;   // hex (no #) for slug tinting; defaults to brand.fg
  border?:   string;
};

const BRANDS: Record<string, Brand> = {
  apple_pay:  { bg: "#000000", fg: "#FFFFFF", label: "Pay",   iconSlug: "applepay", iconFg: "FFFFFF" },
  google_pay: { bg: "#FFFFFF", fg: "#3C4043", label: "GPay",  iconSlug: "googlepay", border: "#E5E7EB" },
  fpx:        { bg: "#1B7A8F", fg: "#FFFFFF", label: "FPX"   },
  grabpay:    { bg: "#00B14F", fg: "#FFFFFF", label: "Grab",  iconSlug: "grab", iconFg: "FFFFFF" },
  tng:        {
    bg:      "#005AAA",
    fg:      "#FFD400",
    label:   "tng",
    // Wikimedia Special:FilePath redirects (302) to the upload.wikimedia.org
    // CDN URL. SvgUri follows the redirect on both iOS and Android.
    iconUrl: "https://upload.wikimedia.org/wikipedia/commons/f/fb/Touch_%27n_Go_eWallet_logo.svg",
  },
  boost:      { bg: "#EC008C", fg: "#FFFFFF", label: "Boost" },
  shopeepay:  { bg: "#EE4D2D", fg: "#FFFFFF", label: "Pay",   iconSlug: "shopee", iconFg: "FFFFFF" },
};

type Props = {
  methodId: string;
  size?:    number;
};

// Card chip — generic credit-card glyph on the brand navy. Stays
// network-agnostic so the tile doesn't imply any specific network is
// accepted on its own.
function CardChip({ size }: { size: number }) {
  const radius = Math.round(size * 0.28);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: "#0B1A4A",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <CreditCard size={Math.round(size * 0.55)} color="#FFFFFF" strokeWidth={2} />
    </View>
  );
}

// Group icon for the E-Wallet category — generic wallet glyph on the
// brand primary background. Used when no specific wallet is picked yet
// so the tile doesn't visually favour one wallet over the others.
function EWalletGroupChip({ size }: { size: number }) {
  const radius = Math.round(size * 0.28);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: "#C05040",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Wallet size={Math.round(size * 0.55)} color="#FFFFFF" strokeWidth={2} />
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
        <Wallet size={Math.round(size * 0.5)} color="#C05040" strokeWidth={2} />
      </View>
    );
  }

  const useUrl = !!brand.iconUrl && !iconFailed;
  // When rendering a full-color SVG via iconUrl, switch the chip to a
  // white card surface with a thin border so the logo's native colors
  // aren't fighting a tinted background.
  const chipBg     = useUrl ? "#FFFFFF" : brand.bg;
  const chipBorder = useUrl ? "#E5E7EB" : brand.border;

  const inner = (() => {
    if (useUrl) {
      const iconSize = Math.round(size * 0.72);
      // PNG / JPG → Image (handles raster fetch + cache natively). SVG
      // (or unknown ext) → SvgUri (renders crisp at any pixel ratio).
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
