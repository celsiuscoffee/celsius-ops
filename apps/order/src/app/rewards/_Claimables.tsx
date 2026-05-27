"use client";

import { useEffect, useState } from "react";
import { Gift, Sparkles } from "lucide-react";

/**
 * Claimable vouchers section on /rewards — one-tap claim row group.
 * Mirrors apps/pickup-native/components/ClaimableSection.tsx:
 * terracotta-tinted card per claimable, title + description, "Claim"
 * (or "Reveal" for mystery) CTA on the right. Tap fires
 * /api/loyalty/me/claimable/[id]/claim and removes the row.
 *
 * Wired exactly the same as the SPA: GET /api/loyalty/me/claimable
 * with the session token from localStorage; POST to .../claim with
 * the same auth.
 */
type Claimable = {
  id: string;
  title: string;
  description?: string | null;
  icon?: string | null;
  category?: string | null;
  source_type?: string | null;
  expires_at?: string | null;
  cta_label?: string | null;
};

type Persisted = { state?: { sessionToken?: string | null } };

function tokenFromStorage(): string | null {
  try {
    const raw = window.localStorage.getItem("celsius-pickup");
    if (!raw) return null;
    return (JSON.parse(raw) as Persisted).state?.sessionToken ?? null;
  } catch {
    return null;
  }
}

export function Claimables() {
  const [items, setItems] = useState<Claimable[] | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  useEffect(() => {
    const token = tokenFromStorage();
    if (!token) {
      setItems([]);
      return;
    }
    fetch("/api/loyalty/me/claimable", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) =>
        setItems((Array.isArray(data) ? data : (data?.claimables ?? [])) as Claimable[]),
      )
      .catch(() => setItems([]));
  }, []);

  const claim = async (c: Claimable) => {
    const token = tokenFromStorage();
    if (!token) return;
    setClaimingId(c.id);
    try {
      const res = await fetch(`/api/loyalty/me/claimable/${encodeURIComponent(c.id)}/claim`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setItems((prev) => (prev ?? []).filter((x) => x.id !== c.id));
      }
    } catch {
      /* ignore */
    } finally {
      setClaimingId(null);
    }
  };

  if (!items || items.length === 0) return null;

  return (
    <section className="px-4 pt-4">
      <h2 className="font-peachi font-bold text-[16px] mb-3">Ready to claim</h2>
      <ul className="flex flex-col gap-2">
        {items.map((c) => {
          const isMystery = c.source_type === "mystery_pending";
          const Icon = isMystery ? Sparkles : Gift;
          return (
            <li key={c.id}>
              <div
                className="flex items-center gap-3 rounded-2xl active:opacity-90"
                style={{
                  backgroundColor: "rgba(162,73,44,0.10)",
                  border: "1px solid rgba(162,73,44,0.25)",
                  padding: 14,
                }}
              >
                <span
                  className="flex items-center justify-center flex-shrink-0"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    backgroundColor: "#A2492C",
                  }}
                >
                  <Icon size={20} color="#FFFFFF" strokeWidth={1.8} />
                </span>
                <div className="flex-1 min-w-0">
                  <p
                    className="font-peachi font-bold text-[15px] truncate"
                    style={{ color: "#160800" }}
                  >
                    {c.title}
                  </p>
                  {c.description ? (
                    <p className="text-[11px] text-[#6E6E73] mt-0.5 line-clamp-2">
                      {c.description}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={claimingId === c.id}
                  onClick={() => claim(c)}
                  className="rounded-full bg-[#A2492C] text-white px-3 py-2 text-[12px] font-bold active:opacity-80 flex-shrink-0"
                  style={{ opacity: claimingId === c.id ? 0.6 : 1 }}
                >
                  {claimingId === c.id ? "…" : c.cta_label ?? "Claim"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
