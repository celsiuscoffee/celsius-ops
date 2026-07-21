"use client";

import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { getDineInContext } from "@/lib/checkout-session";

/**
 * Outlet/table row at the top of /menu. The app is table-QR ordering ONLY, so
 * this row always shows the seated context — "Table N · {outlet}" — and is
 * never a link: the customer can't change outlet, and the pickup outlet picker
 * has been retired. Dine-in is read from the authoritative "celsius-dinein"
 * key (via getDineInContext), NOT the shared "celsius-pickup" blob — the blob's
 * orderType/tableNumber get stripped by the Expo store partialize.
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

  // No dine-in context. The menu is table-QR only now, so the OutletGate has
  // already redirected this visitor to /scan — there is no pickup outlet to
  // pick or change. Render nothing rather than the retired /store link.
  return null;
}
