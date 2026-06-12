"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Delete, ChevronDown, X, Check } from "lucide-react";
import { getSession, saveSession } from "@/lib/staff-auth";

// 6-digit PIN matches backoffice staff records (Prisma User.pin).
// Set staff PINs in Backoffice → Settings → Staff; KDS auth verifies via @celsius/auth.
const PIN_LENGTH = 6;
const LAST_STORE_KEY = "kds-store";

interface StoreOption { id: string; name: string }

function shortStoreName(name: string): string {
  return name.replace(/^Celsius Coffee\s+/i, "") || name;
}

export default function StaffLoginPage() {
  const router = useRouter();
  const [stores,        setStores]        = useState<StoreOption[]>([]);
  const [storesLoading, setStoresLoading] = useState(true);
  const [storeId,       setStoreId]       = useState("");
  const [pin,           setPin]           = useState("");
  const [error,         setError]         = useState("");
  const [loading,       setLoading]       = useState(false);
  const [checking,      setChecking]      = useState(true);
  const [sheetOpen,     setSheetOpen]     = useState(false);

  useEffect(() => {
    if (getSession()) {
      router.replace("/staff/availability");
    } else {
      setChecking(false);
    }
  }, [router]);

  useEffect(() => {
    if (checking) return;
    fetch("/api/stores")
      .then((r) => r.json() as Promise<StoreOption[]>)
      .then((data) => {
        setStores(data);
        const last = typeof window !== "undefined" ? localStorage.getItem(LAST_STORE_KEY) : null;
        const preferred = data.find((s) => s.id === last) ?? data[0];
        if (preferred) setStoreId(preferred.id);
      })
      .catch(() => setStores([]))
      .finally(() => setStoresLoading(false));
  }, [checking]);

  function pressKey(key: string) {
    if (loading || pin.length >= PIN_LENGTH) return;
    const next = pin + key;
    setPin(next);
    setError("");
    if (next.length === PIN_LENGTH) submit(next);
  }

  function backspace() {
    if (loading) return;
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
        router.replace("/staff/availability");
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
  const canSwitch = stores.length > 1;

  return (
    <div className="min-h-dvh bg-[#160800] flex flex-col select-none">
      {/* Top bar — wordmark + outlet chip on one row */}
      <div className="px-5 pt-8 pb-2 flex items-center justify-between gap-3 shrink-0">
        <div className="flex flex-col gap-1.5 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/celsius-wordmark-white.png"
            alt="Celsius Coffee"
            className="h-6 w-auto"
          />
          <p className="text-white/30 text-[10px] font-bold tracking-[0.25em] uppercase">Staff Login</p>
        </div>
        <button
          onClick={() => canSwitch && setSheetOpen(true)}
          disabled={storesLoading || !canSwitch}
          className="flex items-center gap-1.5 bg-white/8 border border-white/10 rounded-full px-3.5 py-2 text-white disabled:opacity-60 active:bg-white/15 shrink-0"
        >
          <span className="text-xs font-bold max-w-[160px] truncate">
            {storesLoading ? "Loading…" : shortStoreName(store?.name ?? "—")}
          </span>
          {canSwitch && <ChevronDown className="h-3.5 w-3.5 text-white/50" />}
        </button>
      </div>

      {/* Center — PIN dots */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 min-h-[180px]">
        <p className="text-white/40 text-[10px] font-bold uppercase tracking-[0.25em] mb-5">
          Enter PIN
        </p>
        <div className="flex items-center justify-center gap-3">
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <div
              key={i}
              className={`w-3 h-3 rounded-full transition-all duration-150 ${
                i < pin.length
                  ? loading ? "bg-amber-400 scale-110" : "bg-white scale-110"
                  : "bg-white/15"
              }`}
            />
          ))}
        </div>
        <p
          className={`mt-4 h-4 text-sm font-semibold transition-opacity ${
            error ? "text-red-400 opacity-100 animate-pulse" : "opacity-0"
          }`}
        >
          {error || "·"}
        </p>
      </div>

      {/* Numpad — thumb zone */}
      <div className="px-5 pb-8 shrink-0">
        <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto">
          {["1","2","3","4","5","6","7","8","9"].map((k) => (
            <button
              key={k}
              onClick={() => pressKey(k)}
              disabled={loading}
              className="h-16 rounded-2xl bg-white/8 border border-white/10 text-white font-bold text-2xl active:bg-white/20 transition-colors disabled:opacity-40"
            >
              {k}
            </button>
          ))}
          <div /> {/* empty slot keeps 0 centered */}
          <button
            onClick={() => pressKey("0")}
            disabled={loading}
            className="h-16 rounded-2xl bg-white/8 border border-white/10 text-white font-bold text-2xl active:bg-white/20 transition-colors disabled:opacity-40"
          >
            0
          </button>
          <button
            onClick={backspace}
            disabled={loading || pin.length === 0}
            className="h-16 rounded-2xl bg-white/8 border border-white/10 text-white/70 flex items-center justify-center active:bg-white/20 transition-colors disabled:opacity-30"
            aria-label="Backspace"
          >
            <Delete className="h-6 w-6" />
          </button>
        </div>
      </div>

      {/* Outlet bottom sheet */}
      {sheetOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-end animate-in fade-in duration-150"
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="w-full bg-[#1f1208] rounded-t-3xl pb-8 max-h-[80dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <p className="text-white font-bold">Select outlet</p>
              <button
                onClick={() => setSheetOpen(false)}
                className="text-white/50 active:text-white p-1"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-3 space-y-2">
              {stores.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setStoreId(s.id);
                    setPin("");
                    setError("");
                    setSheetOpen(false);
                  }}
                  className={`w-full flex items-center justify-between text-left px-4 py-4 rounded-xl transition-colors ${
                    s.id === storeId
                      ? "bg-white text-[#160800]"
                      : "bg-white/5 text-white/85 active:bg-white/10"
                  }`}
                >
                  <span className="font-bold text-sm">{s.name}</span>
                  {s.id === storeId && <Check className="h-4 w-4" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
