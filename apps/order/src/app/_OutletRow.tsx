"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { QrCode, UtensilsCrossed } from "lucide-react";

/**
 * Home order-entry line below the hero. This app is QR-table ordering: a
 * customer starts by scanning the physical table QR (their phone camera opens
 * order.celsiuscoffee.com/table/{outletId}/{tableId}, which _TableEntry turns
 * into a dine-in session). So the home no longer offers a pickup outlet picker
 * — instead it tells the customer to scan.
 *
 * Two states, both read from the persisted "celsius-pickup" blob:
 *   dine-in already set (came back to home after scanning) → "Table N · Outlet",
 *     tappable straight back to the menu.
 *   otherwise → a plain "Scan the QR on your table to order" instruction. The
 *     scan happens with the phone camera on the physical table code, so this
 *     line is guidance, not a button.
 */
type Persisted = {
  state?: {
    outletName?: string | null;
    orderType?: "pickup" | "dine_in" | null;
    tableNumber?: string | null;
  };
};

export function OutletRow() {
  const [dineIn, setDineIn] = useState(false);
  const [table, setTable] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        setDineIn(parsed.state?.orderType === "dine_in");
        setTable(parsed.state?.tableNumber ?? null);
        setName(parsed.state?.outletName ?? null);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Returning to home mid-session — show the locked table + a tap back to the
  // menu, never a pickup picker.
  if (dineIn && table) {
    return (
      <Link
        href="/menu"
        className="flex items-center self-start active:opacity-75"
        style={{ marginLeft: 20, marginTop: 14, marginBottom: 4, gap: 6 }}
      >
        <UtensilsCrossed size={14} color="#8E8E93" />
        <span
          className="font-peachi font-bold truncate"
          style={{ color: "#160800", fontSize: 14 }}
        >
          Table {table}
          {name ? ` · ${name}` : ""}
        </span>
      </Link>
    );
  }

  // Default — no pickup. Tell them to scan the table QR to order.
  return (
    <div
      className="flex items-center self-start"
      style={{ marginLeft: 20, marginTop: 14, marginBottom: 4, gap: 6 }}
    >
      <QrCode size={14} color="#8E8E93" />
      <span
        className="font-peachi font-bold"
        style={{ color: "#160800", fontSize: 14 }}
      >
        Scan the QR on your table to order
      </span>
    </div>
  );
}
