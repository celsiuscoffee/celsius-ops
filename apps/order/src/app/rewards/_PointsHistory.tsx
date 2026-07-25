"use client";

import { useEffect, useState } from "react";
import { History, ArrowUpRight, ArrowDownRight } from "lucide-react";

// Customer-facing points ledger. Mirrors the backoffice member drawer's
// "Points ledger" but scoped to the signed-in customer, so someone like
// Adeline can see for herself that her latest order credited — the gap
// that made her think points "weren't credited". Read-only; fed by
// /api/loyalty/points-history (phone + Bearer, same guard as /orders).

type Entry = {
  id: string;
  type: string;
  points: number;
  balance_after: number | null;
  description: string | null;
  order_number: string | null;
  created_at: string;
};

type Persisted = { state?: { phone?: string | null; sessionToken?: string | null } };

function readAuth(): { phone: string | null; token: string | null } {
  try {
    const raw = window.localStorage.getItem("celsius-pickup");
    if (!raw) return { phone: null, token: null };
    const parsed = JSON.parse(raw) as Persisted;
    return {
      phone: parsed.state?.phone ?? null,
      token: parsed.state?.sessionToken ?? null,
    };
  } catch {
    return { phone: null, token: null };
  }
}

// "Points earned for pickup order" is stored on the ledger row; when we
// have the resolved order number we lead with it so the customer can tie
// the line back to a specific visit.
function lineLabel(e: Entry): string {
  if (e.order_number) {
    return e.points >= 0 ? `Order ${e.order_number}` : `Redeemed on ${e.order_number}`;
  }
  return e.description || (e.points >= 0 ? "Points earned" : "Points redeemed");
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PointsHistory() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [phone, setPhone] = useState<string | null>(null);

  useEffect(() => {
    const { phone: p, token } = readAuth();
    setPhone(p);
    if (!p) {
      setEntries([]);
      return;
    }
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    fetch(`/api/loyalty/points-history?phone=${encodeURIComponent(p)}&limit=30`, {
      headers,
    })
      .then((r) => (r.ok ? r.json() : { history: [] }))
      .then((data) => setEntries((data?.history ?? []) as Entry[]))
      .catch(() => setEntries([]));
  }, []);

  // Anonymous / not signed in → the sign-in prompt elsewhere on the page
  // covers this; render nothing so we don't show an empty History block.
  if (!phone) return null;
  // Still loading, or nothing to show yet — keep the section quiet.
  if (entries === null || entries.length === 0) return null;

  return (
    <section className="px-4 py-4">
      <div className="flex items-center gap-1.5" style={{ paddingLeft: 4, marginBottom: 8 }}>
        <History size={13} color="#8E8E93" strokeWidth={2.2} />
        <p
          className="uppercase"
          style={{ color: "#8E8E93", fontSize: 10, fontWeight: 700, letterSpacing: 1.4 }}
        >
          Points history
        </p>
      </div>

      <ul className="flex flex-col gap-1.5">
        {entries.map((e) => {
          const positive = e.points >= 0;
          const Icon = positive ? ArrowUpRight : ArrowDownRight;
          return (
            <li
              key={e.id}
              className="flex items-center justify-between gap-3"
              style={{
                backgroundColor: "#FBEBE8",
                borderRadius: 14,
                padding: "11px 13px",
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="flex items-center justify-center flex-shrink-0"
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    backgroundColor: positive ? "rgba(22,163,74,0.12)" : "rgba(162,73,44,0.14)",
                  }}
                >
                  <Icon size={17} color={positive ? "#16A34A" : "#A2492C"} strokeWidth={2.2} />
                </span>
                <div className="min-w-0">
                  <p
                    className="truncate"
                    style={{ color: "#1A0200", fontSize: 14, fontWeight: 600, lineHeight: "18px" }}
                  >
                    {lineLabel(e)}
                  </p>
                  <p style={{ color: "rgba(26,2,0,0.55)", fontSize: 11, marginTop: 1 }}>
                    {formatWhen(e.created_at)}
                    {e.balance_after != null ? ` · balance ${e.balance_after.toLocaleString()}` : ""}
                  </p>
                </div>
              </div>
              <span
                className="flex-shrink-0 tabular-nums"
                style={{
                  color: positive ? "#16A34A" : "#A2492C",
                  fontSize: 15,
                  fontWeight: 700,
                }}
              >
                {positive ? "+" : ""}
                {e.points.toLocaleString()}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
