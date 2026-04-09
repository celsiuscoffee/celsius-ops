"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Delete } from "lucide-react";
import { getSession, saveSession } from "@/lib/staff-auth";

const PIN_LENGTH = 4;

interface StoreOption { id: string; name: string }

export default function StaffLoginPage() {
  const router = useRouter();
  const [stores,        setStores]        = useState<StoreOption[]>([]);
  const [storesLoading, setStoresLoading] = useState(true);
  const [storeId,       setStoreId]       = useState("");
  const [pin,           setPin]           = useState("");
  const [error,         setError]         = useState("");
  const [loading,       setLoading]       = useState(false);
  const [checking,      setChecking]      = useState(true);

  // Already logged in — skip to orders
  useEffect(() => {
    if (getSession()) {
      router.replace("/staff/kds");
    } else {
      setChecking(false);
    }
  }, [router]);

  // Fetch stores from API
  useEffect(() => {
    if (checking) return;
    fetch("/api/stores")
      .then((r) => r.json() as Promise<StoreOption[]>)
      .then((data) => {
        setStores(data);
        if (data.length > 0) setStoreId(data[0].id);
      })
      .catch(() => setStores([]))
      .finally(() => setStoresLoading(false));
  }, [checking]);

  function pressKey(key: string) {
    if (pin.length >= PIN_LENGTH) return;
    const next = pin + key;
    setPin(next);
    setError("");
    if (next.length === PIN_LENGTH) {
      submit(next);
    }
  }

  function backspace() {
    setPin((p) => p.slice(0, -1));
    setError("");
  }

  async function submit(enteredPin: string) {
    setLoading(true);
    setError("");
    try {
      const res  = await fetch("/api/staff/auth", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ storeId, pin: enteredPin }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; storeName?: string; staffName?: string | null; staffId?: string | null };
      if (data.ok) {
        const store = stores.find((s) => s.id === storeId) ?? { name: storeId };
        const resolvedStoreName = data.storeName ?? store.name;
        saveSession(storeId, resolvedStoreName, data.staffName ?? null, data.staffId ?? null);
        router.replace("/staff/kds");
      } else {
        setError(data.error ?? "Incorrect PIN");
        setPin("");
      }
    } catch {
      setError("Connection error. Try again.");
      setPin("");
    } finally {
      setLoading(false);
    }
  }

  if (checking) return <div className="min-h-dvh bg-[#160800]" />;

  const store = stores.find((s) => s.id === storeId);

  return (
    <div className="min-h-dvh bg-[#160800] flex flex-col items-center justify-between px-6 pt-16 pb-10 select-none">

      {/* Brand */}
      <div className="text-center">
        <p className="text-white/30 text-xs font-bold tracking-[0.3em] uppercase mb-1">Staff Access</p>
        <h1 className="text-white font-black text-3xl tracking-tight">°Celsius Coffee</h1>
      </div>

      {/* Store selector */}
      <div className="w-full">
        <p className="text-white/40 text-xs text-center mb-3 font-semibold uppercase tracking-widest">Select Outlet</p>
        {storesLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 rounded-full border-2 border-white/20 border-t-white/60 animate-spin" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {stores.map((s) => (
              <button
                key={s.id}
                onClick={() => { setStoreId(s.id); setPin(""); setError(""); }}
                className={`w-full py-4 rounded-2xl font-bold text-base transition-all ${
                  s.id === storeId
                    ? "bg-white text-[#160800]"
                    : "bg-white/10 text-white/60 border border-white/10"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* PIN display */}
      <div className="text-center w-full">
        <p className="text-white/40 text-xs mb-4 font-semibold uppercase tracking-widest">
          Enter PIN for {store?.name ?? ""}
        </p>
        <div className="flex items-center justify-center gap-4 mb-2 bg-white/8 border border-white/12 rounded-2xl px-8 py-5 mx-auto w-fit">
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <div
              key={i}
              className={`w-4 h-4 rounded-full transition-all ${
                i < pin.length
                  ? loading ? "bg-amber-400" : "bg-white"
                  : "bg-white/20"
              }`}
            />
          ))}
        </div>
        {error && (
          <p className="text-red-400 text-sm font-semibold mt-2 animate-pulse">{error}</p>
        )}
      </div>

      {/* Numpad */}
      <div className="w-full max-w-xs">
        <div className="grid grid-cols-3 gap-3">
          {["1","2","3","4","5","6","7","8","9"].map((k) => (
            <button
              key={k}
              onClick={() => pressKey(k)}
              disabled={loading}
              className="h-16 rounded-2xl bg-white/10 border border-white/15 text-white font-bold text-2xl active:bg-white/25 transition-colors disabled:opacity-40"
            >
              {k}
            </button>
          ))}
          {/* Bottom row: backspace, 0, clear */}
          <button
            onClick={backspace}
            disabled={loading}
            className="h-16 rounded-2xl bg-white/10 border border-white/15 text-white/60 flex items-center justify-center active:bg-white/25 transition-colors disabled:opacity-40"
          >
            <Delete className="h-6 w-6" />
          </button>
          <button
            onClick={() => pressKey("0")}
            disabled={loading}
            className="h-16 rounded-2xl bg-white/10 border border-white/15 text-white font-bold text-2xl active:bg-white/25 transition-colors disabled:opacity-40"
          >
            0
          </button>
          <button
            onClick={() => { setPin(""); setError(""); }}
            disabled={loading || pin.length === 0}
            className="h-16 rounded-2xl bg-white/10 border border-white/15 text-white/60 font-semibold text-sm active:bg-white/25 transition-colors disabled:opacity-30"
          >
            Clear
          </button>
        </div>
      </div>

    </div>
  );
}
