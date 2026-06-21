"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Gift, ChevronRight } from "lucide-react";

/**
 * Home "reward waiting" banner — pulls the customer back to an UNREVEALED
 * mystery reward. Today the reveal only lives on the order screen, so ~1/3 of
 * wins are never tapped (and an unrevealed win never becomes a voucher, so it
 * can never be redeemed). This surfaces it prominently on the home and deep-
 * links to the reveal. Renders nothing when there's nothing to reveal.
 */
type Claimable = {
  id: string;
  order_id?: string | null;
  title?: string | null;
  source_type?: string | null;
};

type Persisted = { state?: { sessionToken?: string | null } };

export function RewardWaiting() {
  const [drop, setDrop] = useState<Claimable | null>(null);

  useEffect(() => {
    let token: string | null = null;
    try {
      const raw = localStorage.getItem("celsius-pickup");
      if (raw) token = (JSON.parse(raw) as Persisted).state?.sessionToken ?? null;
    } catch { /* ignore */ }
    if (!token) return;
    let cancelled = false;
    fetch("/api/loyalty/me/claimable", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Claimable[]) => {
        const pending = (Array.isArray(data) ? data : []).find(
          (c) => c.source_type === "mystery_pending" && c.order_id,
        );
        if (!cancelled) setDrop(pending ?? null);
      })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, []);

  if (!drop) return null;

  return (
    <div className="px-4 mt-3">
      <Link
        href={`/order/${drop.order_id}`}
        className="flex items-center gap-3 active:opacity-80"
        style={{ backgroundColor: "#1A0200", borderRadius: 16, padding: "12px 14px" }}
      >
        <span
          className="flex-shrink-0 rounded-full flex items-center justify-center"
          style={{ width: 36, height: 36, backgroundColor: "#A2492C" }}
        >
          <Gift size={18} color="#FFFFFF" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="uppercase" style={{ color: "#FBBF24", fontSize: 10, fontWeight: 700, letterSpacing: 1.5 }}>
            Mystery reward
          </p>
          <p style={{ color: "#FFFFFF", fontSize: 14, fontWeight: 600 }}>You&apos;ve got a reward to reveal</p>
        </div>
        <span className="flex items-center gap-0.5 flex-shrink-0" style={{ color: "#FBBF24", fontSize: 13, fontWeight: 700 }}>
          Reveal <ChevronRight size={15} />
        </span>
      </Link>
    </div>
  );
}
