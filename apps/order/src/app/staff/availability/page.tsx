"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, ToggleLeft, ToggleRight, RotateCcw } from "lucide-react";
import { getSession } from "@/lib/staff-auth";
import { StaffNav } from "@/components/staff-nav";

interface Product {
  id:           string;
  name:         string;
  category:     string;
  price:        number;
  is_available: boolean;
}

export default function StaffAvailabilityPage() {
  const router  = useRouter();
  const [session, setSession] = useState<ReturnType<typeof getSession>>(null);
  const [mounted, setMounted] = useState(false);

  const [products,  setProducts]  = useState<Product[]>([]);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [loading,   setLoading]   = useState(true);
  const [toggling,  setToggling]  = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [query,     setQuery]     = useState("");

  useEffect(() => {
    const s = getSession();
    if (!s) { router.replace("/staff/login"); return; }
    setSession(s);
    setMounted(true);
  }, [router]);

  const load = useCallback(async (storeIdArg: string) => {
    setLoading(true);
    const [prodRes, ovRes] = await Promise.all([
      fetch("/api/staff/products"),
      fetch(`/api/staff/availability?store=${storeIdArg}`),
    ]);
    const prods = (await prodRes.json() as { id: string; name: string; category: string; price: number }[]).map((p) => ({ ...p, is_available: true }));
    const ovs   = await ovRes.json()  as { product_id: string; is_available: boolean }[];

    const map: Record<string, boolean> = {};
    for (const o of ovs) map[o.product_id] = o.is_available;
    setOverrides(map);
    setProducts(prods ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!session) return;
    load(session.storeId);
  }, [load, session]);

  async function toggle(productId: string) {
    if (!session) return;
    const current = overrides[productId] !== false; // default true
    setToggling(productId);
    setOverrides((prev) => ({ ...prev, [productId]: !current }));
    try {
      await fetch("/api/staff/availability", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ productId, storeId: session.storeId, isAvailable: !current }),
      });
    } catch {
      setOverrides((prev) => ({ ...prev, [productId]: current }));
    } finally {
      setToggling(null);
    }
  }

  async function markAllAvailable() {
    if (!session) return;
    const unavailable = products.filter((p) => overrides[p.id] === false);
    if (unavailable.length === 0) return;
    setResetting(true);
    setOverrides((prev) => {
      const next = { ...prev };
      for (const p of unavailable) next[p.id] = true;
      return next;
    });
    try {
      await Promise.all(
        unavailable.map((p) =>
          fetch("/api/staff/availability", {
            method:  "PUT",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ productId: p.id, storeId: session.storeId, isAvailable: true }),
          }),
        ),
      );
    } catch {
      await load(session.storeId);
    } finally {
      setResetting(false);
    }
  }

  if (!mounted || !session) return null;

  const filtered = products.filter((p) =>
    query ? p.name.toLowerCase().includes(query.toLowerCase()) : true,
  );

  const unavailableItems = filtered.filter((p) => overrides[p.id] === false);
  const availableItems   = filtered.filter((p) => overrides[p.id] !== false);
  const categories       = [...new Set(availableItems.map((p) => p.category))].filter(Boolean);
  const grouped          = categories.map((cat) => ({
    cat,
    items: availableItems.filter((p) => p.category === cat),
  }));
  const uncategorised    = availableItems.filter((p) => !p.category);
  if (uncategorised.length) grouped.push({ cat: "Other", items: uncategorised });

  const unavailableCount = products.filter((p) => overrides[p.id] === false).length;

  return (
    <div className="min-h-dvh bg-[#f0f0f0] flex flex-col pb-20">
      {/* Header */}
      <header className="bg-[#160800] text-white px-4 pt-12 pb-4 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-black text-xl">Availability</h1>
            <p className="text-white/50 text-xs mt-0.5 truncate">
              {session.storeName} · {unavailableCount > 0 ? `${unavailableCount} unavailable` : "All items available"}
            </p>
          </div>
          {unavailableCount > 0 && (
            <button
              onClick={markAllAvailable}
              disabled={resetting}
              className="flex items-center gap-1.5 text-xs font-bold bg-white/10 border border-white/15 text-white rounded-full px-3 py-2 active:bg-white/20 disabled:opacity-50 shrink-0"
            >
              {resetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              All in
            </button>
          )}
        </div>
      </header>

      {/* Search */}
      <div className="px-4 py-3 bg-white border-b shrink-0">
        <div className="flex items-center gap-2 bg-[#f0f0f0] rounded-xl px-3 py-2.5">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items..."
            className="flex-1 bg-transparent text-sm outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-xs text-muted-foreground font-semibold px-1.5 py-0.5 active:opacity-60"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-20">No items found</p>
        ) : (
          <>
            {/* Unavailable pinned to top */}
            {unavailableItems.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-red-500 mb-2 px-1 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  Unavailable ({unavailableItems.length})
                </p>
                <div className="bg-white rounded-2xl overflow-hidden divide-y divide-border/50 ring-1 ring-red-200">
                  {unavailableItems.map((item) => (
                    <AvailabilityRow
                      key={item.id}
                      item={item}
                      available={false}
                      busy={toggling === item.id}
                      onToggle={() => toggle(item.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Available, by category */}
            {grouped.map(({ cat, items }) => (
              <div key={cat}>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 px-1">{cat}</p>
                <div className="bg-white rounded-2xl overflow-hidden divide-y divide-border/50">
                  {items.map((item) => (
                    <AvailabilityRow
                      key={item.id}
                      item={item}
                      available
                      busy={toggling === item.id}
                      onToggle={() => toggle(item.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <StaffNav active="availability" />
    </div>
  );
}

function AvailabilityRow({
  item,
  available,
  busy,
  onToggle,
}: {
  item: { id: string; name: string; price: number };
  available: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={busy}
      className="w-full flex items-center gap-3 px-4 py-4 text-left active:bg-[#f8f8f8] disabled:opacity-60 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold truncate ${!available ? "text-muted-foreground line-through" : "text-[#160800]"}`}>
          {item.name}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          RM {item.price.toFixed(2)}
          {!available && <span className="ml-2 text-red-500 font-medium">· Unavailable</span>}
        </p>
      </div>
      <span className="shrink-0">
        {available
          ? <ToggleRight className="h-9 w-9 text-green-500" />
          : <ToggleLeft  className="h-9 w-9 text-muted-foreground/40" />
        }
      </span>
    </button>
  );
}
