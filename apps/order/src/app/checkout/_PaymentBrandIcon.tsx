"use client";

import { useState } from "react";
import { CreditCard, Wallet } from "lucide-react";

// Web port of apps/pickup-native/components/PaymentBrandIcon.tsx so the QR
// Table Order checkout shows the identical brand chips the native pickup
// app does. Three rendering modes per brand:
//   1. iconSrc — bundled brand PNG (the SAME assets copied from
//      apps/pickup-native/assets/pay-icons) rendered on a white chip with a
//      thin border so the logo's native colors aren't clobbered.
//   2. iconSlug — single-color mark from cdn.simpleicons.org on the
//      brand-color chip (Apple Pay / Google Pay — matches native).
//   3. label — brand-color chip with a short monogram fallback when the
//      image fails to load.
// Plus two composite chips: `card` (navy card glyph) and `ewallet` (the
// E-Wallet group chip shown before a specific wallet is picked).

type Brand = {
  bg: string;
  fg: string;
  label: string;
  iconSrc?: string;
  iconSlug?: string;
  iconFg?: string;
  border?: string;
};

const BRANDS: Record<string, Brand> = {
  apple_pay:  { bg: "#000000", fg: "#FFFFFF", label: "Pay",     iconSlug: "applepay",  iconFg: "FFFFFF" },
  google_pay: { bg: "#FFFFFF", fg: "#3C4043", label: "GPay",    iconSlug: "googlepay", border: "#E5E7EB" },
  fpx:        { bg: "#1B7A8F", fg: "#FFFFFF", label: "FPX",     iconSrc: "/payment-icons/fpx.png" },
  grabpay:    { bg: "#00B14F", fg: "#FFFFFF", label: "Grab",    iconSrc: "/payment-icons/grabpay.png" },
  tng:        { bg: "#005AAA", fg: "#FFD400", label: "tng",     iconSrc: "/payment-icons/tng.png" },
  boost:      { bg: "#EC008C", fg: "#FFFFFF", label: "Boost",   iconSrc: "/payment-icons/boost.png" },
  shopeepay:  { bg: "#EE4D2D", fg: "#FFFFFF", label: "Pay",     iconSrc: "/payment-icons/shopeepay.png" },
  duitnow:    { bg: "#FFFFFF", fg: "#ED1A3B", label: "DuitNow", iconSrc: "/payment-icons/duitnow.png", border: "#E5E7EB" },
};

function Chip({
  size,
  bg,
  border,
  children,
}: {
  size: number;
  bg: string;
  border?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        backgroundColor: bg,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: border ? `1px solid ${border}` : undefined,
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}

export function PaymentBrandIcon({ methodId, size = 36 }: { methodId: string; size?: number }) {
  const [failed, setFailed] = useState(false);

  // Composite chips — must come before the BRANDS lookup.
  if (methodId === "card") {
    return (
      <Chip size={size} bg="#0B1A4A">
        <CreditCard size={Math.round(size * 0.55)} color="#FFFFFF" strokeWidth={2} />
      </Chip>
    );
  }
  if (methodId === "ewallet") {
    return (
      <Chip size={size} bg="#A2492C">
        <Wallet size={Math.round(size * 0.55)} color="#FFFFFF" strokeWidth={2} />
      </Chip>
    );
  }

  const brand = BRANDS[methodId];
  if (!brand) {
    return (
      <Chip size={size} bg="#F2E9DD">
        <Wallet size={Math.round(size * 0.5)} color="#A2492C" strokeWidth={2} />
      </Chip>
    );
  }

  const useSrc = !!brand.iconSrc && !failed;
  const useSlug = !useSrc && !!brand.iconSlug && !failed;

  // Full-color bundled logos sit on a white card surface; simpleicon marks
  // and the monogram fallback sit on the brand-color chip (matches native).
  const chipBg = useSrc ? "#FFFFFF" : brand.bg;
  const chipBorder = useSrc ? "#E5E7EB" : brand.border;

  let inner: React.ReactNode;
  if (useSrc) {
    const s = Math.round(size * 0.92);
    inner = (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={brand.iconSrc}
        alt=""
        width={s}
        height={s}
        style={{ width: s, height: s, objectFit: "contain" }}
        onError={() => setFailed(true)}
      />
    );
  } else if (useSlug) {
    const tint = brand.iconFg ?? brand.fg.replace("#", "");
    const s = Math.round(size * 0.6);
    inner = (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`https://cdn.simpleicons.org/${brand.iconSlug}/${tint}`}
        alt=""
        width={s}
        height={s}
        style={{ width: s, height: s, objectFit: "contain" }}
        onError={() => setFailed(true)}
      />
    );
  } else {
    inner = (
      <span
        className="font-peachi"
        style={{
          color: brand.fg,
          fontWeight: 800,
          fontSize: Math.round(size * (brand.label.length > 3 ? 0.28 : 0.36)),
          letterSpacing: -0.3,
        }}
      >
        {brand.label}
      </span>
    );
  }

  return (
    <Chip size={size} bg={chipBg} border={chipBorder}>
      {inner}
    </Chip>
  );
}
