"use client";

import { useEffect, useState } from "react";
import { Gift, Check } from "lucide-react";

type Challenge = { title: string; reward: string; message: string; met: boolean; progressPct: number };

/**
 * AOV challenge nudge at the cart — "Spend RM12 more to unlock Free Coffee".
 * Surfaces the member's closest-to-complete single-order mission so building a
 * bigger basket completes a reward right now. Pairs with the upsell rail below
 * (which suggests the items to get there). Renders nothing when nothing's close.
 */
export function CartChallengeNudge({
  items,
  loyaltyId,
}: {
  items: { product_id: string; quantity: number; total_sen: number }[];
  loyaltyId: string | null;
}) {
  const [c, setC] = useState<Challenge | null>(null);
  const key = items.map((i) => `${i.product_id}:${i.quantity}:${i.total_sen}`).sort().join("|");

  useEffect(() => {
    if (!loyaltyId || !items.length) { setC(null); return; }
    let cancelled = false;
    fetch("/api/loyalty/me/cart-challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member: loyaltyId, items }),
    })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setC(j?.challenge ?? null); })
      .catch(() => { if (!cancelled) setC(null); });
    return () => { cancelled = true; };
  }, [key, loyaltyId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!c) return null;

  return (
    <div className="px-4 mb-3">
      <div className="flex items-center gap-2.5" style={{ backgroundColor: "#160800", borderRadius: 14, padding: "10px 14px" }}>
        <span
          className="flex-shrink-0 rounded-full flex items-center justify-center"
          style={{ width: 30, height: 30, backgroundColor: c.met ? "#16a34a" : "#A2492C" }}
        >
          {c.met ? <Check size={16} color="#FFFFFF" /> : <Gift size={16} color="#FFFFFF" />}
        </span>
        <div className="flex-1 min-w-0">
          <p style={{ color: "#FFFFFF", fontSize: 13, fontWeight: 600 }}>{c.message}</p>
          {!c.met && (
            <div style={{ marginTop: 5, height: 4, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.18)" }}>
              <div style={{ width: `${Math.round(c.progressPct * 100)}%`, height: 4, borderRadius: 999, backgroundColor: "#FBBF24" }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
