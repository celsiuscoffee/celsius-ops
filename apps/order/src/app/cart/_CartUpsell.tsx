"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Plus } from "lucide-react";

type Pair = { id: string; name: string; basePrice: number; image: string | null; reason: string };

/**
 * In-cart upsell rail — "Goes well with your order". Targeted by the basket
 * (drinks cart → a bite, etc.) via /api/suggest-pairs, personalized by member.
 * Cards link to the product page (one tap to add, same flow as the best-seller
 * rail). Renders nothing until it has a suggestion, so it never adds noise.
 *
 * outletId (the store slug) is forwarded so the shared engine can drop items
 * that are 86'd / snoozed at this outlet — otherwise a snoozed item, hidden
 * from the menu, would still surface here and let the customer order it.
 */
export function CartUpsell({ productIds, loyaltyId, outletId }: { productIds: string[]; loyaltyId: string | null; outletId: string | null }) {
  const [pairs, setPairs] = useState<Pair[]>([]);
  const key = productIds.slice().sort().join(",");

  useEffect(() => {
    if (!productIds.length) { setPairs([]); return; }
    let cancelled = false;
    fetch("/api/suggest-pairs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cart_product_ids: productIds, member: loyaltyId, outlet_id: outletId }),
    })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setPairs(Array.isArray(j?.pairs) ? j.pairs : []); })
      .catch(() => { if (!cancelled) setPairs([]); });
    return () => { cancelled = true; };
    // Re-fetch when the cart contents change (key), the member resolves, or the
    // selected outlet changes (different outlet = different 86 list).
  }, [key, loyaltyId, outletId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (pairs.length === 0) return null;

  return (
    <div className="mt-2 mb-4">
      <p className="uppercase px-4 mb-2" style={{ color: "#1A0200", fontSize: 13, fontWeight: 700, letterSpacing: 1.2 }}>
        Goes well with your order
      </p>
      <div
        className="flex gap-3 px-4 overflow-x-auto pb-1"
        style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}
      >
        {pairs.map((p) => (
          <Link
            key={p.id}
            href={`/product/${p.id}`}
            className="flex-shrink-0 bg-white overflow-hidden active:opacity-70"
            style={{ width: 150, borderRadius: 16, border: "1px solid rgba(26,2,0,0.10)", boxShadow: "0 3px 8px rgba(0,0,0,0.06)", scrollSnapAlign: "start" }}
          >
            <div className="relative bg-[#F2EDE5]" style={{ width: 150, height: 130 }}>
              {p.image ? <Image src={p.image} alt={p.name} fill sizes="150px" className="object-cover" /> : null}
              <span
                className="absolute uppercase"
                style={{ top: 8, left: 8, backgroundColor: "rgba(22,8,0,0.82)", color: "#FBBF24", fontSize: 8, fontWeight: 700, letterSpacing: 0.6, padding: "3px 6px", borderRadius: 999 }}
              >
                {p.reason}
              </span>
            </div>
            <div style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 8, paddingBottom: 10 }}>
              <p className="font-peachi font-bold truncate" style={{ color: "#1A0200", fontSize: 13 }}>{p.name}</p>
              <div className="flex items-center justify-between" style={{ marginTop: 4 }}>
                <span className="font-peachi font-bold" style={{ color: "#A2492C", fontSize: 14 }}>
                  RM{p.basePrice.toFixed(2)}
                </span>
                <span className="rounded-full flex items-center justify-center" style={{ width: 24, height: 24, backgroundColor: "#160800" }}>
                  <Plus size={14} color="#FFFFFF" />
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
