"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MapPin, ChevronDown } from "lucide-react";
import { getDineInContext } from "@/lib/checkout-session";

/**
 * Outlet picker row at the top of /menu. Shows the actual selected
 * outlet name from localStorage; same visual as apps/pickup-native
 * /app/menu.tsx:460-473 (MapPin terracotta + bold name + ChevronDown).
 *
 * In dine-in (table-QR) mode it shows "Table N · {outlet}" and is NOT a
 * link — the customer is seated, so there's no outlet to change, and
 * routing them into /store would clear their dine-in context (the
 * silent-pickup bug). Dine-in is read from the authoritative
 * "celsius-dinein" key (via getDineInContext), NOT the shared
 * "celsius-pickup" blob — the blob's orderType/tableNumber get stripped
 * by the Expo store partialize, which used to flip this row back into a
 * tappable pickup link mid-session.
 */
type Persisted = {
  state?: {
    outletName?: string | null;
  };
};

export function OutletPickerRow() {
  const [name, setName] = useState<string | null>(null);
  const [dineIn, setDineIn] = useState(false);
  const [table, setTable] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        setName(parsed.state?.outletName ?? null);
      }
      const dine = getDineInContext();
      if (dine) {
        setDineIn(true);
        setTable(dine.tableNumber);
      }
    } catch {
      /* ignore */
    }
  }, []);

  if (dineIn) {
    return (
      <div className="flex items-center gap-2 bg-white border-b border-[rgba(26,2,0,0.10)] px-4 py-2">
        <MapPin size={14} color="#A2492C" />
        <span className="font-bold flex-1 truncate" style={{ color: "#1A0200", fontSize: 14 }}>
          Table {table} · {name ?? "Dine-in"}
        </span>
      </div>
    );
  }

  return (
    <Link
      href="/store"
      className="flex items-center gap-2 bg-white border-b border-[rgba(26,2,0,0.10)] px-4 py-2 active:opacity-70"
    >
      <MapPin size={14} color="#A2492C" />
      <span
        className="font-bold flex-1 truncate"
        style={{ color: "#1A0200", fontSize: 14 }}
      >
        {name ?? "Select outlet"}
      </span>
      <ChevronDown size={14} color="#8E8E93" />
    </Link>
  );
}
