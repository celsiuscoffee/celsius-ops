"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Plus } from "lucide-react";

type Pair = { id: string; name: string; basePrice: number; image: string | null; reason: string; discountLabel?: string | null };

/**
 * In-cart upsell — "Goes well with your order". Targeted by the basket
 * (drinks cart → a bite, etc.) via /api/suggest-pairs, personalized by member.
 * Rendered as full-width rows in the SAME card style as the cart items above it
 * (contained, both-side margins) so it reads as part of the order, not an
 * edge-to-edge side rail. Tapping a row opens the product (one tap to add).
 * Renders nothing until it has a suggestion, so it never adds noise.
 */
export function CartUpsell({ productIds, loyaltyId }: { productIds: string[]; loyaltyId: string | null }) {
  const router = useRouter();
  const [pairs, setPairs] = useState<Pair[]>([]);
  const key = productIds.slice().sort().join(",");

  useEffect(() => {
    if (!productIds.length) { setPairs([]); return; }
    let cancelled = false;
    fetch("/api/suggest-pairs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cart_product_ids: productIds, member: loyaltyId }),
    })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setPairs(Array.isArray(j?.pairs) ? j.pairs : []); })
      .catch(() => { if (!cancelled) setPairs([]); });
    return () => { cancelled = true; };
  }, [key, loyaltyId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (pairs.length === 0) return null;

  return (
    <div className="mt-1 mb-4">
      <p className="uppercase px-4 mb-2" style={{ color: "#1A0200", fontSize: 13, fontWeight: 700, letterSpacing: 1.2 }}>
        Goes well with your order
      </p>
      <div className="px-4 flex flex-col gap-3">
        {pairs.map((p) => (
          <button
            key={p.id}
            onClick={() => router.push(`/product/${p.id}`)}
            className="bg-white flex gap-3 items-center text-left active:opacity-70"
            style={{ border: "1px solid rgba(26,2,0,0.10)", borderRadius: 16, padding: 12 }}
          >
            <div className="relative flex-shrink-0 bg-[#F2EDE5]" style={{ width: 56, height: 56, borderRadius: 10, overflow: "hidden" }}>
              {p.image ? <Image src={p.image} alt={p.name} fill sizes="56px" className="object-cover" /> : null}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-peachi font-bold truncate" style={{ color: "#1A0200", fontSize: 14 }}>{p.name}</p>
              <p className="uppercase truncate" style={{ color: "#A2492C", fontSize: 9, fontWeight: 700, letterSpacing: 0.5, marginTop: 2 }}>
                {p.discountLabel ?? p.reason}
              </p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <span className="font-peachi font-bold" style={{ color: "#A2492C", fontSize: 14 }}>RM{p.basePrice.toFixed(2)}</span>
              <span className="rounded-full flex items-center justify-center" style={{ width: 28, height: 28, backgroundColor: "#160800" }}>
                <Plus size={15} color="#FFFFFF" />
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
