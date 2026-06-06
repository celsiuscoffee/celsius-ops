"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MapPin, ChevronRight } from "lucide-react";

/**
 * Outlet picker chip below the hero. Resolves the chosen outlet from the
 * SPA's localStorage (key 'celsius-pickup'). Shows the name + status of the
 * outlet matching the stored outletId — NOT the stored outletName string,
 * which can lag behind outletId (e.g. after a table-QR scan) and make the
 * tile claim one outlet while orders actually route to another. Mirrors the
 * native home's reconcile (apps/pickup-native/app/index.tsx).
 */
type Persisted = {
  state?: {
    outletId?: string | null;
    outletName?: string | null;
    outletIsOpen?: boolean;
    outletIsBusy?: boolean;
    outletPickupTimeMins?: number | null;
  };
};

type Store = { id: string; name: string; isOpen: boolean; isBusy: boolean; pickupTime: string };

export function OutletRow() {
  const [name, setName] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState<boolean | null>(null);
  const [isBusy, setIsBusy] = useState<boolean | null>(null);
  const [pickupLabel, setPickupLabel] = useState<string | null>(null);

  useEffect(() => {
    let outletId: string | null = null;
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        outletId = parsed.state?.outletId ?? null;
        // Instant paint from the stored values; reconciled below against the
        // authoritative outlet for outletId.
        setName(parsed.state?.outletName ?? null);
        setIsOpen(parsed.state?.outletIsOpen ?? null);
        setIsBusy(parsed.state?.outletIsBusy ?? null);
        const mins = parsed.state?.outletPickupTimeMins ?? null;
        setPickupLabel(mins ? `~${mins} min` : null);
      }
    } catch {
      /* ignore */
    }
    if (!outletId) return;

    let cancelled = false;
    fetch("/api/stores")
      .then((r) => (r.ok ? r.json() : []))
      .then((stores: Store[]) => {
        if (cancelled) return;
        const match = Array.isArray(stores) ? stores.find((s) => s.id === outletId) : null;
        if (!match) return;
        // Truthful to outletId — the outlet the order will actually go to.
        setName(match.name);
        setIsOpen(match.isOpen);
        setIsBusy(match.isBusy);
        setPickupLabel(match.pickupTime && !match.pickupTime.includes("null") ? match.pickupTime : null);
        // Self-heal the stored name so every other reader converges too.
        try {
          const raw = window.localStorage.getItem("celsius-pickup");
          if (raw) {
            const parsed = JSON.parse(raw) as Persisted;
            if (parsed.state && parsed.state.outletName !== match.name) {
              parsed.state.outletName = match.name;
              window.localStorage.setItem("celsius-pickup", JSON.stringify(parsed));
            }
          }
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        /* keep the stored fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dot =
    isOpen === false
      ? { bg: "#EF4444", label: "Closed" }
      : isBusy
      ? { bg: "#F59E0B", label: "Busy" }
      : isOpen === true
      ? { bg: "#22C55E", label: pickupLabel ?? "Open" }
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
