"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Gift, ChevronRight, Sparkles } from "lucide-react";

/**
 * Voucher wallet rail on the home page. Mirrors the SPA's home rail
 * (apps/pickup-native/app/index.tsx ~L847-1200) — horizontal scroll of
 * the customer's active vouchers, each as a themed card showing title,
 * description, and expiry. Renders only for signed-in customers who
 * have at least one active voucher.
 */
type Voucher = {
  id: string;
  name?: string | null;
  title?: string | null;
  description?: string | null;
  value_label?: string | null;
  source_type?: string | null;
  expires_at?: string | null;
  status?: string | null;
};

type Persisted = { state?: { sessionToken?: string | null } };

const THEME: Record<string, { bg: string; fg: string; chip: string }> = {
  mystery:           { bg: "#160800", fg: "#FFFFFF", chip: "#FBBF24" },
  mission:           { bg: "#1A0200", fg: "#FFFFFF", chip: "#FBBF24" },
  birthday:          { bg: "#A2492C", fg: "#FFFFFF", chip: "#FFE4D2" },
  promo:             { bg: "#A2492C", fg: "#FFFFFF", chip: "#FFE4D2" },
  welcome:           { bg: "#A2492C", fg: "#FFFFFF", chip: "#FFE4D2" },
  referral:          { bg: "#FBBF24", fg: "#160800", chip: "#160800" },
  points_redemption: { bg: "#F2EDE5", fg: "#160800", chip: "#A2492C" },
};

function themeFor(v: Voucher) {
  return THEME[v.source_type ?? ""] ?? THEME.promo;
}

function expiresLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return null;
  if (days === 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  if (days <= 7) return `Expires in ${days}d`;
  return `Expires ${new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short" })}`;
}

export function VoucherRail() {
  const [vouchers, setVouchers] = useState<Voucher[] | null>(null);

  useEffect(() => {
    let token: string | null = null;
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        token = parsed.state?.sessionToken ?? null;
      }
    } catch {
      /* ignore */
    }
    if (!token) return;
    fetch("/api/loyalty/me/vouchers", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const list = (Array.isArray(data) ? data : (data?.vouchers ?? [])) as Voucher[];
        setVouchers(list.filter((v) => v.status === "active" || !v.status));
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  if (!vouchers || vouchers.length === 0) return null;

  return (
    <section className="mt-6">
      <div className="flex items-center px-4 mb-3">
        <h2 className="font-peachi font-bold text-[20px] flex-1">Your rewards</h2>
        <Link
          href="/rewards"
          className="text-[#A2492C] text-sm flex items-center gap-1 active:opacity-70"
        >
          More <ChevronRight size={14} />
        </Link>
      </div>

      <ul
        className="flex gap-3 px-4 overflow-x-auto pb-1"
        style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}
      >
        {vouchers.map((v) => {
          const t = themeFor(v);
          const title = v.value_label ?? v.title ?? v.name ?? "Reward";
          const desc = v.description ?? v.name ?? "";
          const expiry = expiresLabel(v.expires_at);
          return (
            <li
              key={v.id}
              className="flex-shrink-0"
              style={{ width: 260, scrollSnapAlign: "start" }}
            >
              <Link
                href="/rewards"
                className="block rounded-2xl p-4 active:opacity-90"
                style={{
                  backgroundColor: t.bg,
                  color: t.fg,
                  minHeight: 130,
                  boxShadow: "0 4px 10px rgba(22,8,0,0.10)",
                }}
              >
                <div className="flex items-start gap-2">
                  <span
                    className="flex items-center justify-center"
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      backgroundColor: "rgba(255,255,255,0.14)",
                    }}
                  >
                    {v.source_type === "mystery" || v.source_type === "mission" ? (
                      <Sparkles size={18} color={t.chip} strokeWidth={1.8} />
                    ) : (
                      <Gift size={18} color={t.chip} strokeWidth={1.8} />
                    )}
                  </span>
                  {expiry ? (
                    <span
                      className="ml-auto text-[10px] uppercase tracking-widest font-bold rounded-full px-2 py-0.5"
                      style={{
                        backgroundColor: "rgba(255,255,255,0.15)",
                        color: t.chip,
                      }}
                    >
                      {expiry}
                    </span>
                  ) : null}
                </div>
                <p
                  className="mt-3 font-peachi font-bold text-lg leading-tight"
                  style={{ color: t.fg }}
                >
                  {title}
                </p>
                {desc && desc !== title ? (
                  <p
                    className="mt-1 text-[12px] leading-snug line-clamp-2"
                    style={{ color: t.fg, opacity: 0.75 }}
                  >
                    {desc}
                  </p>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
