"use client";

import { useEffect, useState } from "react";
import { Sparkles, Gift } from "lucide-react";

/**
 * Mystery-bean reveal on the order page — port of the MysteryBean flow
 * from apps/pickup-native (components/MysteryBean.tsx + the order screen
 * wiring). After payment, GET /api/loyalty/me/mystery/[orderId] checks
 * for a pending drop; if one exists and isn't revealed, we show a
 * tap-to-reveal card. Tapping POSTs .../[dropId]/reveal which applies
 * the outcome (bean multiplier / flat beans / voucher) and returns the
 * payload we present. Web uses a tap-to-reveal card rather than the
 * native scratch animation.
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
    const win = revealed.outcome_type !== "no_bonus";
    return (
      <section className="px-4 pt-5">
        <div
          className="flex flex-col items-center text-center overflow-hidden"
          style={{
            backgroundColor: "#1A0200",
            borderRadius: 18,
            padding: 24,
            boxShadow: "0 6px 14px rgba(22,8,0,0.18)",
          }}
        >
          <span style={{ fontSize: 44, lineHeight: 1 }}>{revealed.reveal_emoji ?? (win ? "🎉" : "☕")}</span>
          <p
            className="uppercase"
            style={{ color: "rgba(251,191,36,0.75)", fontSize: 10, fontWeight: 700, letterSpacing: 2, marginTop: 12 }}
          >
            {win ? "You won" : "Mystery bean"}
          </p>
          <p className="font-peachi font-bold" style={{ color: "#FBBF24", fontSize: 22, marginTop: 4 }}>
            {revealed.label}
          </p>
          {revealed.total_beans_awarded > 0 ? (
            <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 6 }}>
              +{revealed.total_beans_awarded} beans added
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded-full active:opacity-80"
            style={{
              marginTop: 18,
              backgroundColor: "#FBBF24",
              paddingLeft: 24,
              paddingRight: 24,
              paddingTop: 10,
              paddingBottom: 10,
            }}
          >
            <span className="font-peachi font-bold" style={{ color: "#1A0200", fontSize: 14 }}>
              {revealed.voucher_id ? "View in wallet" : "Got it"}
            </span>
          </button>
        </div>
      </section>
    );
  }

  // ── Pending — tap to reveal ───────────────────────────────────────
  return (
    <section className="px-4 pt-5">
      <button
        type="button"
        onClick={reveal}
        disabled={revealing}
        className="w-full flex items-center text-left active:opacity-90"
        style={{
          backgroundColor: "#1A0200",
          borderRadius: 18,
          padding: 16,
          gap: 14,
          boxShadow: "0 6px 14px rgba(22,8,0,0.18)",
        }}
      >
        <span
          className="flex items-center justify-center flex-shrink-0"
          style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: "rgba(251,191,36,0.20)" }}
        >
          <Gift size={24} color="#FBBF24" strokeWidth={2} />
        </span>
        <span className="flex-1 min-w-0">
          <span
            className="block uppercase"
            style={{ color: "#FBBF24", fontSize: 10, fontWeight: 700, letterSpacing: 1.6 }}
          >
            Mystery bean
          </span>
          <span className="block font-peachi font-bold" style={{ color: "#FFFFFF", fontSize: 16, marginTop: 2 }}>
            {revealing ? "Revealing…" : "Tap to reveal your reward"}
          </span>
        </span>
        <Sparkles size={20} color="#FBBF24" strokeWidth={1.8} />
      </button>
    </section>
  );
}
