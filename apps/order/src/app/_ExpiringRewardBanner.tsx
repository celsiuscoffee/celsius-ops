"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, ChevronRight } from "lucide-react";
import { applyWalletVoucherToState, type WalletVoucher } from "@/lib/loyalty/apply-wallet-voucher";

/**
 * Home "use it before it's gone" banner — the REDEEM half of the reward
 * loop. Customers earn vouchers (mystery / challenge) but ~9 in 10 never
 * get used; this surfaces the SOONEST-EXPIRING active voucher above the
 * fold with urgency + a one-tap "use now" that pre-applies it and drops
 * the customer on the menu to start the next order.
 *
 * Distinct from VoucherRail (a passive wallet list further down): shows
 * only the single most-urgent reward, only when it expires within the
 * urgency window, and routes straight into an order with the reward
 * already applied. Renders nothing otherwise (guests, no expiring reward).
 */

const URGENCY_DAYS = 7;

type Persisted = { state?: { sessionToken?: string | null } };
type Voucher = WalletVoucher & { status?: string | null; source_type?: string | null };

function daysLeft(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function expiryPhrase(d: number): string {
  if (d <= 0) return "today";
  if (d === 1) return "tomorrow";
  return `in ${d} days`;
}

// Tie-break: a free drink beats a discount; otherwise bigger discount wins.
function valueRank(v: Voucher): number {
  if (v.discount_type === "free_item") return 1_000_000;
  return v.discount_value ?? 0;
}

export function ExpiringRewardBanner() {
  const router = useRouter();
  const [pick, setPick] = useState<Voucher | null>(null);

  useEffect(() => {
    let token: string | null = null;
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) token = (JSON.parse(raw) as Persisted).state?.sessionToken ?? null;
    } catch {
      /* ignore */
    }
    if (!token) return;
    fetch("/api/loyalty/me/vouchers", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const list = (Array.isArray(data) ? data : (data?.vouchers ?? [])) as Voucher[];
        const soonest = list
          .filter((v) => v.status === "active" || !v.status)
          .map((v) => ({ v, d: daysLeft(v.expires_at) }))
          .filter((x): x is { v: Voucher; d: number } => x.d !== null && x.d >= 0 && x.d <= URGENCY_DAYS)
          .sort((a, b) => a.d - b.d || valueRank(b.v) - valueRank(a.v))[0];
        setPick(soonest?.v ?? null);
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  if (!pick) return null;
  const d = daysLeft(pick.expires_at) ?? 0;
  const name = pick.title ?? pick.name ?? "reward";

  const onUse = () => {
    applyWalletVoucherToState(pick);
    router.push("/menu");
  };

  return (
    <button
      onClick={onUse}
      aria-label={`Use your ${name} before it expires`}
      className="mx-4 mt-4 flex items-center gap-3 rounded-2xl active:opacity-90 text-left"
      style={{ width: "calc(100% - 2rem)", backgroundColor: "#1A0200", padding: 14 }}
    >
      <span
        className="flex items-center justify-center rounded-full flex-shrink-0"
        style={{ width: 38, height: 38, backgroundColor: "rgba(251,191,36,0.18)" }}
      >
        <Clock size={20} color="#FBBF24" strokeWidth={2.2} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-peachi font-bold text-[15px] text-white truncate">
          Your {name} expires {expiryPhrase(d)}
        </span>
        <span className="block text-[12px]" style={{ color: "rgba(251,191,36,0.85)" }}>
          {d <= 1 ? "Last chance — order now to use it" : "Order now to use it"}
        </span>
      </span>
      <span
        className="flex items-center justify-center rounded-full flex-shrink-0"
        style={{ width: 28, height: 28, backgroundColor: "#FBBF24" }}
      >
        <ChevronRight size={16} color="#1A0200" />
      </span>
    </button>
  );
}
