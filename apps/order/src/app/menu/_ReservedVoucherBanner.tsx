"use client";

import { useEffect, useState } from "react";
import { Gift, X } from "lucide-react";

/**
 * Sticky strip shown above the menu when the customer has "locked in"
 * a voucher from the wallet. Mirrors apps/pickup-native/components/
 * ReservedVoucherBanner.tsx — terracotta-tinted card with title +
 * "Applies at checkout" subtitle + X to clear.
 *
 * Reads the SPA's persisted reservedVoucher state from localStorage
 * so both surfaces stay in sync. Clearing here writes back to the
 * same localStorage so the SPA picks up the dismissal too.
 */
type Reserved = {
  id?: string;
  title?: string;
  category?: string | null;
};

type Persisted = {
  state?: {
    reservedVoucher?: Reserved | null;
    appliedReward?: { voucher_id?: string } | null;
  };
};

function readReserved(): Reserved | null {
  try {
    const raw = window.localStorage.getItem("celsius-pickup");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Persisted;
    return parsed.state?.reservedVoucher ?? null;
  } catch {
    return null;
  }
}

function clearReserved() {
  try {
    const raw = window.localStorage.getItem("celsius-pickup");
    if (!raw) return;
    const parsed = JSON.parse(raw) as Persisted;
    const state = parsed.state ?? {};
    const reservedId = state.reservedVoucher?.id;
    state.reservedVoucher = null;
    // Also clear applied reward if it's THIS reserved voucher, mirroring
    // the SPA's dismiss() logic.
    if (state.appliedReward?.voucher_id && state.appliedReward.voucher_id === reservedId) {
      state.appliedReward = null;
    }
    window.localStorage.setItem("celsius-pickup", JSON.stringify({ ...parsed, state }));
  } catch {
    /* ignore */
  }
}

export function ReservedVoucherBanner() {
  const [reserved, setReserved] = useState<Reserved | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setReserved(readReserved());
    setHydrated(true);
  }, []);

  if (!hydrated || !reserved?.title) return null;

  return (
    <div
      className="flex items-center gap-3 border-b border-[#A2492C]/25 px-4 py-3"
      style={{ backgroundColor: "rgba(162,73,44,0.10)" }}
    >
      <span
        className="flex items-center justify-center flex-shrink-0"
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          backgroundColor: "#A2492C",
        }}
      >
        <Gift size={20} color="#FFFFFF" strokeWidth={2} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-peachi font-bold text-[14px] truncate">
          {reserved.title} locked in
        </p>
        <p
          className="text-[11px] mt-0.5"
          style={{ color: "rgba(22,8,0,0.65)" }}
        >
          Add items — applies at checkout
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          clearReserved();
          setReserved(null);
        }}
        aria-label="Remove reserved voucher"
        className="h-[30px] w-[30px] rounded-full flex items-center justify-center active:opacity-60 flex-shrink-0"
        style={{ backgroundColor: "#A2492C" }}
      >
        <X size={14} color="#FFFFFF" strokeWidth={2.4} />
      </button>
    </div>
  );
}
