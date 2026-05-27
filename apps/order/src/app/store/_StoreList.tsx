"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, MapPin, Check } from "lucide-react";

type Outlet = {
  store_id: string;
  name: string;
  address: string;
  is_open: boolean;
  is_busy: boolean;
  pickup_time_mins: number | null;
};

type Persisted = { state?: { outletId?: string | null; outletName?: string | null } };

export function StoreList({ outlets }: { outlets: Outlet[] }) {
  const router = useRouter();
  const search = useSearchParams();
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        setSelected(parsed.state?.outletId ?? null);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const choose = (o: Outlet) => {
    try {
      const raw = window.localStorage.getItem("celsius-pickup");
      const parsed = raw ? (JSON.parse(raw) as Persisted) : { state: {} };
      const state = parsed.state ?? {};
      state.outletId = o.store_id;
      state.outletName = o.name;
      window.localStorage.setItem("celsius-pickup", JSON.stringify({ ...parsed, state }));
    } catch {
      /* ignore */
    }
    setSelected(o.store_id);
    const next = search.get("next");
    if (next === "menu") {
      router.push("/menu");
    } else {
      router.push("/");
    }
  };

  return (
    <>
      <header
        className="bg-[#160800] text-white px-4 pb-3 flex items-center gap-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <Link href="/" className="-ml-1 p-1 active:opacity-60" aria-label="Back">
          <ArrowLeft size={20} color="#FFFFFF" />
        </Link>
        <h1 className="font-peachi font-bold text-[22px]">Pickup outlet</h1>
      </header>

      <ul className="px-4 py-4 flex flex-col gap-3">
        {outlets.map((o) => {
          const active = selected === o.store_id;
          const dot = !o.is_open
            ? { bg: "#EF4444", label: "Closed" }
            : o.is_busy
            ? { bg: "#F59E0B", label: "Busy" }
            : { bg: "#22C55E", label: o.pickup_time_mins ? `~${o.pickup_time_mins} min` : "Open" };
          return (
            <li key={o.store_id}>
              <button
                type="button"
                onClick={() => choose(o)}
                className={`w-full text-left rounded-2xl border p-4 active:opacity-80 ${
                  active ? "border-[#160800] bg-[#F7F4F0]" : "border-[#EBE5DE] bg-white"
                }`}
                style={{ boxShadow: "0 2px 6px rgba(0,0,0,0.04)" }}
              >
                <div className="flex items-start gap-3">
                  <MapPin size={18} color="#A2492C" className="mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-peachi font-bold text-base truncate">{o.name}</p>
                    <p className="text-[12px] text-[#6E6E73] mt-0.5 truncate">{o.address}</p>
                    <div className="mt-2 flex items-center gap-1.5">
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: dot.bg }}
                      />
                      <span className="text-[11px] font-bold" style={{ color: dot.bg }}>
                        {dot.label}
                      </span>
                    </div>
                  </div>
                  {active ? <Check size={18} color="#160800" /> : null}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
