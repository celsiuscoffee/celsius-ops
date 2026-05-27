"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MapPin, ChevronRight } from "lucide-react";

/**
 * Outlet picker chip below the hero. Reads the chosen outlet from the
 * SPA's localStorage (key 'celsius-pickup'). Shows the actual outlet
 * name when one is selected — same visual treatment as the SPA's
 * apps/pickup-native/app/index.tsx:535-580 row.
 */
type Persisted = {
  state?: {
    outletName?: string | null;
  };
};

export function OutletRow() {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (!raw) return;
      const parsed = JSON.parse(raw) as Persisted;
      setName(parsed.state?.outletName ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <Link
      href="/store"
      className="flex items-center self-start active:opacity-70"
      style={{ marginLeft: 20, marginTop: 14, marginBottom: 4, gap: 6 }}
    >
      <MapPin size={14} color="#8E8E93" />
      <span className="font-peachi font-bold text-sm">
        {name ?? "Select pickup outlet"}
      </span>
      <ChevronRight size={14} color="#8E8E93" />
    </Link>
  );
}
