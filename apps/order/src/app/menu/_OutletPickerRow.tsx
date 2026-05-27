"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MapPin, ChevronDown } from "lucide-react";

/**
 * Outlet picker row at the top of /menu. Shows the actual selected
 * outlet name from localStorage; same visual as apps/pickup-native
 * /app/menu.tsx:460-473 (MapPin terracotta + Peachi/sans bold name +
 * ChevronDown).
 */
type Persisted = {
  state?: {
    outletName?: string | null;
  };
};

export function OutletPickerRow() {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        setName(parsed.state?.outletName ?? null);
      }
    } catch {
      /* ignore */
    }
  }, []);

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
