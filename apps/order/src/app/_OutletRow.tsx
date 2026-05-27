"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MapPin, ChevronRight } from "lucide-react";

/**
 * Outlet picker chip below the hero. Reads the chosen outlet from the
 * SPA's localStorage (key 'celsius-pickup'). Shows the actual outlet
 * name + status dot/label when one is selected — mirrors
 * apps/pickup-native/app/index.tsx:535-584.
 */
type Persisted = {
  state?: {
    outletName?: string | null;
    outletIsOpen?: boolean;
    outletIsBusy?: boolean;
    outletPickupTimeMins?: number | null;
  };
};

export function OutletRow() {
  const [name, setName] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState<boolean | null>(null);
  const [isBusy, setIsBusy] = useState<boolean | null>(null);
  const [pickupMins, setPickupMins] = useState<number | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (!raw) return;
      const parsed = JSON.parse(raw) as Persisted;
      setName(parsed.state?.outletName ?? null);
      setIsOpen(parsed.state?.outletIsOpen ?? null);
      setIsBusy(parsed.state?.outletIsBusy ?? null);
      setPickupMins(parsed.state?.outletPickupTimeMins ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  const dot =
    isOpen === false
      ? { bg: "#EF4444", label: "Closed" }
      : isBusy
      ? { bg: "#F59E0B", label: "Busy" }
      : isOpen === true
      ? { bg: "#22C55E", label: pickupMins ? `~${pickupMins} min` : "Open" }
      : null;

  return (
    <Link
      href="/store"
      className="flex items-center self-start active:opacity-75"
      style={{ marginLeft: 20, marginTop: 14, marginBottom: 4, gap: 6 }}
    >
      <MapPin size={14} color="#8E8E93" />
      <span
        className="font-peachi font-bold truncate"
        style={{ color: "#160800", fontSize: 14 }}
      >
        {name ?? "Select pickup outlet"}
      </span>
      {dot ? (
        <>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: dot.bg,
              marginLeft: 4,
            }}
          />
          <span style={{ color: "#8E8E93", fontSize: 12, fontWeight: 500 }}>
            {dot.label}
          </span>
        </>
      ) : null}
      <ChevronRight size={13} color="#8E8E93" />
    </Link>
  );
}
