"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

/**
 * The dark espresso info card that overlays the bottom of the hero
 * poster. Mirrors the SPA's home info-card design — "Hi, [name]." up
 * top, KPI strip (Points | Rewards) below with the gold accent when
 * vouchers > 0. Tap anywhere on the card → /rewards.
 */
type Persisted = {
  state?: {
    phone?: string | null;
    loyaltyId?: string | null;
    sessionToken?: string | null;
    member?: { name?: string | null; pointsBalance?: number };
  };
};

function firstNameOf(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim().split(/\s+/)[0];
  return trimmed || null;
}

function greetingFor(hour: number): string {
  if (hour < 5) return "Hello";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function HeroInfoCard() {
  const [name, setName] = useState<string | null>(null);
  const [beans, setBeans] = useState<number | null>(null);
  const [voucherCount, setVoucherCount] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let memberId: string | null = null;
    let token: string | null = null;
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        setName(firstNameOf(parsed.state?.member?.name));
        setBeans(parsed.state?.member?.pointsBalance ?? null);
        memberId = parsed.state?.loyaltyId ?? null;
        token = parsed.state?.sessionToken ?? null;
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);

    let cancelled = false;

    // Refresh the LIVE balance from member_brands (the same source POS +
    // native read). The cached localStorage value goes stale whenever points
    // change on another surface (e.g. a POS purchase) — which is why the web
    // could show 1894 while POS showed 2102. Falls back to the cached value
    // if the fetch fails.
    if (memberId) {
      fetch(`/api/loyalty/member-tier?member_id=${encodeURIComponent(memberId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled) return;
          const live = (d as { points_balance?: number | null } | null)?.points_balance;
          if (typeof live !== "number") return;
          setBeans(live);
          // Write the fresh value back so the account / tier surfaces that read
          // the same cache also show it.
          try {
            const raw = window.localStorage.getItem("celsius-pickup");
            const parsed = raw ? JSON.parse(raw) : { state: {} };
            const state = parsed.state ?? {};
            state.member = { ...(state.member ?? {}), pointsBalance: live };
            window.localStorage.setItem("celsius-pickup", JSON.stringify({ ...parsed, state }));
          } catch {
            /* ignore */
          }
        })
        .catch(() => {
          /* keep cached value */
        });
    }

    // Active-rewards count — fetched from the SAME /api/loyalty/me/vouchers
    // source the home VoucherRail renders, so the header "Rewards" counter
    // matches the "Available rewards" rail. Was stuck at 0: the home page
    // renders <HeroInfoCard /> with no voucherCount prop, so the default held.
    if (token) {
      fetch("/api/loyalty/me/vouchers", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => {
          if (cancelled) return;
          const list = (Array.isArray(data) ? data : (data?.vouchers ?? [])) as Array<{
            status?: string | null;
          }>;
          setVoucherCount(list.filter((v) => v.status === "active" || !v.status).length);
        })
        .catch(() => {
          /* keep 0 */
        });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const greeting = greetingFor(new Date().getHours());
  const heading = name ? `Hi, ${name}.` : `${greeting}.`;

  return (
    <Link
      href="/rewards"
      className="absolute left-4 right-4 bottom-0 bg-[#160800] text-white block active:opacity-95"
      style={{
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        padding: "11px 16px",
        boxShadow: "0 8px 16px rgba(0,0,0,0.28)",
      }}
    >
      <p className="text-[17px] font-peachi font-bold truncate">{heading}</p>
      <div
        className="mt-2 pt-2 flex items-center"
        style={{ borderTop: "1px solid rgba(255,255,255,0.10)" }}
      >
        <div className="flex-1">
          <p className="font-peachi font-bold text-[18px]">
            {hydrated && beans !== null ? beans.toLocaleString() : "—"}
          </p>
          <p
            className="text-[10px] uppercase mt-0.5 text-white/55"
            style={{ letterSpacing: 1.2, fontWeight: 500 }}
          >
            Points
          </p>
        </div>
        <div
          className="flex-1 pl-4"
          style={{ borderLeft: "1px solid rgba(255,255,255,0.10)" }}
        >
          <p
            className="font-peachi font-bold text-[18px]"
            style={{ color: voucherCount > 0 ? "#FBBF24" : "#FFFFFF" }}
          >
            {voucherCount}
          </p>
          <p
            className="text-[10px] uppercase mt-0.5 text-white/55"
            style={{ letterSpacing: 1.2, fontWeight: 500 }}
          >
            Rewards
          </p>
        </div>
        <ChevronRight size={16} className="text-white/55" />
      </div>
    </Link>
  );
}
