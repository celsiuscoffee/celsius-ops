"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, MapPin, CheckCircle2, Clock, Users } from "lucide-react";

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
          return (
            <li key={o.store_id}>
              <button
                type="button"
                onClick={() => choose(o)}
                disabled={!o.is_open}
                className="w-full text-left bg-white rounded-2xl active:opacity-70 flex items-start"
                style={{
                  border: active ? "2px solid #160800" : "1px solid rgba(26,2,0,0.10)",
                  padding: 16,
                  gap: 14,
                  opacity: !o.is_open ? 0.5 : 1,
                  boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                }}
              >
                <span
                  className="flex items-center justify-center flex-shrink-0"
                  style={{
                    marginTop: 2,
                    padding: 10,
                    borderRadius: 16,
                    backgroundColor: active ? "rgba(162,73,44,0.15)" : "rgba(162,73,44,0.10)",
                  }}
                >
                  <MapPin size={20} color="#A2492C" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span
                      className="font-bold"
                      style={{ color: "#1A0200", fontSize: 15 }}
                    >
                      {o.name}
                    </span>
                    {o.is_busy && o.is_open ? (
                      <span
                        className="flex items-center gap-1 rounded"
                        style={{
                          backgroundColor: "#FEF3C7",
                          paddingLeft: 6,
                          paddingRight: 6,
                          paddingTop: 2,
                          paddingBottom: 2,
                        }}
                      >
                        <Users size={10} color="#B45309" />
                        <span style={{ fontSize: 10, color: "#F59E0B", fontWeight: 500 }}>Busy</span>
                      </span>
                    ) : null}
                    {!o.is_open ? (
                      <span
                        className="rounded"
                        style={{
                          backgroundColor: "#FFFFFF",
                          paddingLeft: 6,
                          paddingRight: 6,
                          paddingTop: 2,
                          paddingBottom: 2,
                          border: "1px solid rgba(26,2,0,0.10)",
                        }}
                      >
                        <span style={{ fontSize: 10, color: "#6B6B6B", fontWeight: 500 }}>Closed</span>
                      </span>
                    ) : null}
                  </span>
                  <span
                    className="block leading-relaxed line-clamp-2"
                    style={{ color: "#6B6B6B", fontSize: 12, marginTop: 4 }}
                  >
                    {o.address}
                  </span>
                  {o.pickup_time_mins ? (
                    <span className="mt-2 flex items-center gap-1">
                      <Clock size={12} color="#6E6E73" />
                      <span style={{ color: "#6B6B6B", fontSize: 12 }}>
                        ~{o.pickup_time_mins} min
                      </span>
                    </span>
                  ) : null}
                </span>
                {active ? <CheckCircle2 size={20} color="#160800" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
