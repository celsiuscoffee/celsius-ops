"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Gift, ChevronRight } from "lucide-react";

/**
 * Guest sign-in CTA on the home screen. Surfaces FIRST for logged-out
 * customers so the membership ask lands the moment the app opens.
 * Mirrors apps/pickup-native/app/index.tsx:586-644 — espresso panel
 * with a terracotta gift tile, "Free to join" eyebrow, "Become a
 * member" headline, member-benefit subline, and a white "Sign in"
 * pill. Renders nothing once signed in.
 */
type Persisted = { state?: { phone?: string | null } };

export function GuestSignInCTA() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) {
        const phone = (JSON.parse(raw) as Persisted).state?.phone ?? null;
        setSignedIn(!!phone);
        return;
      }
    } catch {
      /* ignore */
    }
    setSignedIn(false);
  }, []);

  if (signedIn !== false) return null;

  return (
    <Link
      href="/account"
      className="block mx-4 mt-4 active:opacity-90 overflow-hidden"
      style={{
        backgroundColor: "#1A0200",
        borderRadius: 16,
        boxShadow: "0 6px 14px rgba(22,8,0,0.18)",
      }}
    >
      <div className="flex items-center" style={{ paddingLeft: 20, paddingRight: 20, paddingTop: 16, paddingBottom: 16, gap: 12 }}>
        <span
          className="flex items-center justify-center flex-shrink-0"
          style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: "#A2492C" }}
        >
          <Gift size={24} color="#FFFFFF" strokeWidth={2} />
        </span>
        <span className="flex-1 min-w-0">
          <span
            className="block uppercase"
            style={{
              color: "#FBBF24",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 2,
            }}
          >
            Free to join
          </span>
          <span
            className="block font-peachi font-bold"
            style={{ color: "#FFFFFF", fontSize: 17, marginTop: 2 }}
          >
            Become a member
          </span>
          <span
            className="block truncate"
            style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 2, fontWeight: 500 }}
          >
            Earn points · unlock free drinks · members-only deals
          </span>
        </span>
        <span
          className="flex items-center gap-1 rounded-full flex-shrink-0"
          style={{
            backgroundColor: "#FFFFFF",
            paddingLeft: 14,
            paddingRight: 14,
            paddingTop: 8,
            paddingBottom: 8,
          }}
        >
          <span className="font-peachi font-bold" style={{ color: "#1A0200", fontSize: 12 }}>
            Sign in
          </span>
          <ChevronRight size={13} color="#1A0200" />
        </span>
      </div>
    </Link>
  );
}
