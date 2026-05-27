"use client";

import { useEffect, useState } from "react";
import { Gift, Sparkles, Check } from "lucide-react";

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
          const isClaiming = claimingId === c.id;
          return (
            <li key={c.id}>
              <div
                className="relative flex items-center bg-white rounded-2xl"
                style={{
                  border: "1px solid rgba(162,73,44,0.25)",
                  padding: 12,
                  gap: 12,
                  boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                }}
              >
                {/* Left "fresh" stripe — terracotta, top/bottom inset 14px */}
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 14,
                    bottom: 14,
                    width: 3,
                    backgroundColor: "#A2492C",
                    borderTopRightRadius: 2,
                    borderBottomRightRadius: 2,
                  }}
                />
                {/* NEW badge */}
                <span
                  className="uppercase"
                  style={{
                    position: "absolute",
                    top: -7,
                    left: 14,
                    backgroundColor: "#A2492C",
                    paddingLeft: 8,
                    paddingRight: 8,
                    paddingTop: 2,
                    paddingBottom: 2,
                    borderRadius: 6,
                    color: "#FFFFFF",
                    fontSize: 8.5,
                    fontWeight: 800,
                    letterSpacing: 1.2,
                  }}
                >
                  New
                </span>

                <span
                  className="flex items-center justify-center flex-shrink-0 rounded-xl"
                  style={{ width: 44, height: 44, backgroundColor: "#FBEBE8" }}
                >
                  <Icon size={22} color="#A2492C" strokeWidth={1.8} />
                </span>
                <div className="flex-1 min-w-0">
                  <p
                    className="font-peachi font-bold text-[15px] truncate"
                    style={{ color: "#1A0200" }}
                  >
                    {c.title}
                  </p>
                  {c.description ? (
                    <p
                      className="text-[11px] mt-0.5 line-clamp-1"
                      style={{ color: "#6B6B6B", letterSpacing: 0.2, fontWeight: 500 }}
                    >
                      {c.description}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={isClaiming}
                  onClick={() => claim(c)}
                  className="flex items-center gap-1 rounded-full active:opacity-80 flex-shrink-0"
                  style={{
                    backgroundColor: "#A2492C",
                    paddingLeft: 14,
                    paddingRight: 14,
                    paddingTop: 7,
                    paddingBottom: 7,
                    opacity: isClaiming ? 0.6 : 1,
                  }}
                >
                  <span
                    className="font-peachi font-bold text-[12px]"
                    style={{ color: "#FFFFFF" }}
                  >
                    {isClaiming ? "Claiming…" : c.cta_label ?? "Claim"}
                  </span>
                  {!isClaiming ? (
                    <Check size={10} color="#FFFFFF" strokeWidth={2.8} />
                  ) : null}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
