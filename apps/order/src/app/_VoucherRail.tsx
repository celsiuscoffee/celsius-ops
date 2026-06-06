"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Gift, ChevronRight, Sparkles } from "lucide-react";

/**
 * Home rewards rail — 144px ticket-stub cards mirroring apps/pickup-
 * native/components/RewardTicket.tsx. Each card splits into a coloured
 * top stub (eyebrow + Peachi-Bold headline + optional urgency pill) and
 * a white bottom stub (reward name + "Free to claim" cost label), with
 * a perforated separator (half-circle punches + dashed line) so the
 * card reads as a tear-off coupon rather than a generic card.
 *
 * Renders only for signed-in customers who have at least one active
 * voucher.
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

function expiresLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return null;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days <= 7) return `${days}d left`;
  return new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short" });
}

// Native pattern: auto-issued rewards (welcome / birthday / mystery /
// mission) get the gold accent on espresso; everything else gets the
// terracotta colourway.
function toneFor(v: Voucher): "gold" | "terracotta" {
  if (v.source_type === "welcome" || v.source_type === "birthday") return "gold";
  if (v.source_type === "mystery" || v.source_type === "mission") return "gold";
  return "terracotta";
}

function eyebrowFor(v: Voucher): string {
  switch (v.source_type) {
    case "welcome":           return "Welcome gift";
    case "birthday":          return "Birthday gift";
    case "mission":           return "Challenge reward";
    case "mystery":           return "Mystery reward";
    case "referral":          return "Referral";
    case "points_redemption": return "Bean reward";
    case "promo":             return "Promo";
    default:                  return "Reward";
  }
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
        <h2 className="font-peachi font-bold text-[18px] flex-1">Available rewards</h2>
        <Link
          href="/rewards"
          className="text-[#A2492C] text-xs font-bold flex items-center gap-0.5 active:opacity-70"
        >
          More <ChevronRight size={14} />
        </Link>
      </div>

      <ul
        className="flex gap-3 px-4 overflow-x-auto pb-1"
        style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}
      >
        {vouchers.map((v) => (
          <RewardTicket key={v.id} voucher={v} />
        ))}
      </ul>
    </section>
  );
}

function RewardTicket({ voucher }: { voucher: Voucher }) {
  const tone = toneFor(voucher);
  const topBg = tone === "gold" ? "#1A0200" : "#A2492C";
  const topAccent = tone === "gold" ? "#FBBF24" : "#FFFFFF";
  const topMuted = tone === "gold" ? "rgba(251,191,36,0.65)" : "rgba(255,255,255,0.75)";
  const headline = voucher.value_label ?? voucher.title ?? voucher.name ?? "Reward";
  const urgency = expiresLabel(voucher.expires_at);
  const eyebrow = eyebrowFor(voucher);
  const isGift = tone === "gold" || voucher.source_type === "welcome";

  return (
    <li
      className="flex-shrink-0"
      style={{
        width: 144,
        scrollSnapAlign: "start",
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
      }}
    >
      <Link href="/rewards" className="block active:opacity-80">
        {/* Top stub */}
        <div
          className="relative"
          style={{
            backgroundColor: topBg,
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 12,
            paddingBottom: 14,
            height: 100,
          }}
        >
          <div className="flex items-center justify-between">
            <span
              className="uppercase"
              style={{
                color: topMuted,
                fontWeight: 700,
                fontSize: 9,
                letterSpacing: 1.6,
              }}
            >
              {eyebrow}
            </span>
            {tone === "gold" ? (
              <Gift size={12} color={topAccent} strokeWidth={2} />
            ) : null}
          </div>
          <p
            className="font-peachi font-bold whitespace-pre-line"
            style={{
              color: topAccent,
              fontSize: 19,
              lineHeight: "21px",
              marginTop: 5,
              paddingRight: 14,
            }}
          >
            {headline}
          </p>
          {urgency ? (
            <span
              className="absolute"
              style={{
                top: 10,
                right: 10,
                backgroundColor: tone === "gold" ? "#FBBF24" : "#FFFFFF",
                color: tone === "gold" ? "#1A0200" : "#A2492C",
                paddingLeft: 6,
                paddingRight: 6,
                paddingTop: 2,
                paddingBottom: 2,
                borderRadius: 999,
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: 9,
              }}
            >
              {urgency}
            </span>
          ) : null}
          {/* Brand glyph anchored bottom-right of the top stub */}
          <span
            aria-hidden
            className="absolute"
            style={{ right: 6, bottom: 6, opacity: 0.85, pointerEvents: "none" }}
          >
            {isGift ? (
              <Gift size={36} color={topAccent} strokeWidth={1.6} />
            ) : (
              <Sparkles size={36} color={topAccent} strokeWidth={1.6} />
            )}
          </span>
        </div>

        {/* Perforated separator — half-circle punches on each edge +
            dashed line connecting them. */}
        <div className="relative" style={{ height: 0 }}>
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: -7,
              top: -7,
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: "#FFFFFF",
            }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              right: -7,
              top: -7,
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: "#FFFFFF",
            }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: 12,
              right: 12,
              top: -1,
              height: 2,
              borderTop: "1px dashed rgba(26, 2, 0, 0.18)",
            }}
          />
        </div>

        {/* Bottom stub */}
        <div
          style={{
            backgroundColor: "#FFFFFF",
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 13,
            paddingBottom: 10,
            border: "1px solid rgba(26, 2, 0, 0.10)",
            borderTop: "none",
          }}
        >
          <p
            className="font-peachi font-bold truncate"
            style={{ color: "#1A0200", fontSize: 12 }}
          >
            {voucher.name ?? voucher.title ?? "Reward"}
          </p>
          <p
            className="uppercase truncate"
            style={{
              color: tone === "gold" ? "#A2492C" : "rgba(26, 2, 0, 0.55)",
              fontWeight: 700,
              fontSize: 10,
              letterSpacing: 1.2,
              marginTop: 4,
            }}
          >
            Free to claim
          </p>
        </div>
      </Link>
    </li>
  );
}
