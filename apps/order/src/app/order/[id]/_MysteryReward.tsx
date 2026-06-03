"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, Gift, ChevronRight, Check } from "lucide-react";

/**
 * Mystery-reward reveal on the order page — port of the MysteryBean flow
 * from apps/pickup-native (components/MysteryBean.tsx + the order screen
 * wiring). After payment, GET /api/loyalty/me/mystery/[orderId] checks
 * for a pending drop; if one exists and isn't revealed, we show a
 * tap-to-reveal card. Tapping POSTs .../[dropId]/reveal which applies
 * the outcome (point multiplier / bonus Points / voucher) and returns the
 * payload we present. Web uses a tap-to-reveal card rather than the
 * native scratch animation, but mirrors native's gold pre-reveal tile +
 * espresso reveal card and the "Points" / "Mystery Reward" copy.
 */
type Pending = { drop_id: string; revealed: boolean };

type Revealed = {
  drop_id: string;
  outcome_type: "beans_multiplier" | "flat_beans" | "voucher" | "no_bonus" | "surprise_in_store";
  multiplier_value: number | null;
  flat_beans_value: number | null;
  voucher_id: string | null;
  reveal_emoji: string | null;
  label: string;
  total_beans_awarded: number;
};

type Persisted = { state?: { sessionToken?: string | null } };

function token(): string | null {
  try {
    const raw = window.localStorage.getItem("celsius-pickup");
    if (!raw) return null;
    return (JSON.parse(raw) as Persisted).state?.sessionToken ?? null;
  } catch {
    return null;
  }
}

export function MysteryReward({
  orderId,
  baseBeansEarned,
}: {
  orderId: string;
  baseBeansEarned?: number;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const t = token();
    if (!t) return;
    let cancelled = false;
    fetch(`/api/loyalty/me/mystery/${orderId}`, {
      headers: { Authorization: `Bearer ${t}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (d && d.drop_id && !d.revealed) setPending(d as Pending);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const reveal = async () => {
    if (!pending || revealing) return;
    const t = token();
    if (!t) return;
    setRevealing(true);
    try {
      const res = await fetch(`/api/loyalty/me/mystery/${pending.drop_id}/reveal`, {
        method: "POST",
        headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
        body: JSON.stringify({ base_beans_earned: baseBeansEarned ?? null }),
      });
      if (res.ok) {
        setRevealed((await res.json()) as Revealed);
      }
    } catch {
      /* ignore */
    } finally {
      setRevealing(false);
    }
  };

  if (dismissed) return null;
  if (!pending && !revealed) return null;

  // ── Revealed outcome ──────────────────────────────────────────────
  if (revealed) {
    const isMultiplier =
      revealed.outcome_type === "beans_multiplier" &&
      !!revealed.multiplier_value &&
      revealed.multiplier_value > 1;
    const isVoucher = revealed.outcome_type === "voucher";
    const isNoBonus = revealed.outcome_type === "no_bonus";
    const isFlat = revealed.outcome_type === "flat_beans" && !!revealed.flat_beans_value;
    const isSurprise = revealed.outcome_type === "surprise_in_store";
    const isTyped = isMultiplier || isVoucher || isFlat || isSurprise;

    // No bonus — quiet white card, never feels punishing.
    if (isNoBonus) {
      return (
        <section className="px-4 pt-5">
          <div
            className="flex flex-col items-center text-center"
            style={{
              backgroundColor: "#FFFFFF",
              border: "1px solid rgba(26,2,0,0.10)",
              borderRadius: 18,
              padding: 24,
            }}
          >
            <Sparkles size={32} color="#6B6B6B" strokeWidth={1.6} />
            <p className="font-peachi font-bold" style={{ color: "#1A0200", fontSize: 18, marginTop: 10 }}>
              No bonus this time
            </p>
            <p style={{ color: "#6B6B6B", fontSize: 13, marginTop: 4 }}>
              Better luck on your next order ☕
            </p>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="flex items-center justify-center active:opacity-85"
              style={{
                marginTop: 20,
                backgroundColor: "#1A0200",
                borderRadius: 9999,
                paddingTop: 11,
                paddingBottom: 11,
                width: "100%",
              }}
            >
              <span className="font-peachi font-bold" style={{ color: "#FFFFFF", fontSize: 14 }}>
                Got it
              </span>
            </button>
          </div>
        </section>
      );
    }

    // Win — espresso surface with amber accents.
    return (
      <section className="px-4 pt-5">
        <div
          className="flex flex-col items-center text-center overflow-hidden"
          style={{
            backgroundColor: "#1A0200",
            borderRadius: 18,
            padding: "28px 24px",
            boxShadow: "0 10px 18px rgba(26,2,0,0.18)",
          }}
        >
          <Sparkles size={38} color="#FBBF24" strokeWidth={1.6} />

          {isMultiplier ? (
            <>
              <span
                className="font-peachi font-bold"
                style={{ color: "#FBBF24", fontSize: 56, letterSpacing: -2, lineHeight: "56px", marginTop: 10 }}
              >
                {revealed.multiplier_value}×
              </span>
              <span
                className="uppercase"
                style={{ color: "rgba(251,191,36,0.85)", fontSize: 10, fontWeight: 700, letterSpacing: 2, marginTop: 6 }}
              >
                Point Multiplier
              </span>
              <div
                style={{ height: 1, backgroundColor: "rgba(251,191,36,0.18)", alignSelf: "stretch", margin: "18px -24px" }}
              />
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 13 }}>
                Your {baseBeansEarned ?? 0} Points became
              </span>
              <span className="font-peachi font-bold" style={{ color: "#FFFFFF", fontSize: 22, marginTop: 2 }}>
                {revealed.total_beans_awarded} Points
              </span>
            </>
          ) : null}

          {isVoucher ? (
            <>
              <span
                className="font-peachi font-bold"
                style={{ color: "#FBBF24", fontSize: 22, letterSpacing: -0.3, marginTop: 10 }}
              >
                {revealed.label}
              </span>
              <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, marginTop: 6 }}>
                Added to your rewards
              </span>
            </>
          ) : null}

          {isFlat ? (
            <>
              <span
                className="font-peachi font-bold"
                style={{ color: "#FBBF24", fontSize: 48, letterSpacing: -2, marginTop: 10 }}
              >
                +{revealed.flat_beans_value}
              </span>
              <span
                className="uppercase"
                style={{ color: "rgba(251,191,36,0.85)", fontSize: 10, fontWeight: 700, letterSpacing: 2, marginTop: 4 }}
              >
                Bonus Points
              </span>
            </>
          ) : null}

          {isSurprise ? (
            <>
              <span className="font-peachi font-bold" style={{ color: "#FBBF24", fontSize: 20, marginTop: 10 }}>
                Surprise at pickup
              </span>
              <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, marginTop: 6 }}>
                Show this to the barista when you collect your order
              </span>
            </>
          ) : null}

          {/* Generic win fallback when the outcome label doesn't map to a
              typed variant — still presents the prize + any Points added. */}
          {!isTyped ? (
            <>
              <span className="font-peachi font-bold" style={{ color: "#FBBF24", fontSize: 22, marginTop: 10 }}>
                {revealed.label}
              </span>
              {revealed.total_beans_awarded > 0 ? (
                <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 6 }}>
                  +{revealed.total_beans_awarded} Points added
                </span>
              ) : null}
            </>
          ) : null}

          {isVoucher ? (
            <Link
              href="/rewards"
              onClick={() => setDismissed(true)}
              className="flex items-center justify-center active:opacity-85"
              style={{
                marginTop: 20,
                backgroundColor: "#FBBF24",
                borderRadius: 9999,
                paddingTop: 11,
                paddingBottom: 11,
                width: "100%",
                gap: 6,
              }}
            >
              <Gift size={15} color="#1A0200" strokeWidth={2.4} />
              <span className="font-peachi font-bold" style={{ color: "#1A0200", fontSize: 14 }}>
                View in rewards
              </span>
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="flex items-center justify-center active:opacity-85"
              style={{
                marginTop: 20,
                backgroundColor: "#FBBF24",
                borderRadius: 9999,
                paddingTop: 11,
                paddingBottom: 11,
                width: "100%",
                gap: 6,
              }}
            >
              <Check size={15} color="#1A0200" strokeWidth={2.6} />
              <span className="font-peachi font-bold" style={{ color: "#1A0200", fontSize: 14 }}>
                Got it
              </span>
            </button>
          )}
        </div>
      </section>
    );
  }

  // ── Pending — gold "Tap to Reveal" tile (matches native MysteryBean) ──
  return (
    <section className="px-4 pt-5">
      <button
        type="button"
        onClick={reveal}
        disabled={revealing}
        className="w-full flex flex-col items-center text-center active:opacity-90"
        style={{
          backgroundColor: "#FBBF24",
          borderRadius: 18,
          padding: 24,
          border: "1px solid rgba(26,2,0,0.25)",
          boxShadow: "0 6px 14px rgba(26,2,0,0.28)",
        }}
      >
        <Gift size={44} color="#1A0200" strokeWidth={1.8} />
        <span
          className="uppercase"
          style={{ color: "rgba(26,2,0,0.7)", fontSize: 10, fontWeight: 700, letterSpacing: 2, marginTop: 14 }}
        >
          Tap to Reveal
        </span>
        <span
          className="font-peachi font-bold"
          style={{ color: "#1A0200", fontSize: 26, letterSpacing: -0.3, marginTop: 4 }}
        >
          Mystery Reward
        </span>
        <span style={{ color: "rgba(26,2,0,0.72)", fontSize: 13, marginTop: 6, fontWeight: 500 }}>
          You&apos;ve got something. One tap.
        </span>
        <span
          className="flex items-center justify-center"
          style={{
            marginTop: 16,
            backgroundColor: "#1A0200",
            borderRadius: 9999,
            paddingLeft: 20,
            paddingRight: 20,
            paddingTop: 10,
            paddingBottom: 10,
            gap: 6,
          }}
        >
          <span className="font-peachi font-bold" style={{ color: "#FBBF24", fontSize: 13 }}>
            {revealing ? "Revealing…" : "Reveal"}
          </span>
          {!revealing ? <ChevronRight size={14} color="#FBBF24" strokeWidth={2.4} /> : null}
        </span>
      </button>
    </section>
  );
}
