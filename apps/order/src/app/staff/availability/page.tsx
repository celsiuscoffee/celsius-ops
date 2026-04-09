"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, ToggleLeft, ToggleRight } from "lucide-react";
import { getSession } from "@/lib/staff-auth";
import { StaffNav } from "@/components/staff-nav";

interface Product {
  id:           string;
  name:         string;
  category:     string;
  price:        number;   // in RM
  is_available: boolean;  // from product_overrides (default true)
}

export default function StaffAvailabilityPage() {
  const router  = useRouter();
  const [session, setSession] = useState<ReturnType<typeof getSession>>(null);
  const [mounted, setMounted] = useState(false);

  const [products,  setProducts]  = useState<Product[]>([]);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [loading,   setLoading]   = useState(true);
  const [toggling,  setToggling]  = useState<string | null>(null);
  const [query,     setQuery]     = useState("");

  useEffect(() => {
    const s = getSession();
    if (!s) { router.replace("/staff/login"); return; }
    setSession(s);
    setMounted(true);
  }, [router]);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const [prodRes, ovRes] = await Promise.all([
      fetch("/api/staff/products"),
      fetch(`/api/staff/availability?store=${session.storeId}`),
    ]);
    const prods = (await prodRes.json() as { id: string; name: string; category: string; price: number }[]).map((p) => ({ ...p, is_available: true }));
    const ovs   = await ovRes.json()  as { product_id: string; is_available: boolean }[];

    const map: Record<string, boolean> = {};
    for (const o of ovs) map[o.product_id] = o.is_available;
    setOverrides(map);
    setProducts(prods ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, session]);

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
      // Revert on error
      setOverrides((prev) => ({ ...prev, [productId]: current }));
    } finally {
      setToggling(null);
    }
  }

  if (!mounted || !session) return null;

  // Group products by category
  const filtered = products.filter((p) =>
    query ? p.name.toLowerCase().includes(query.toLowerCase()) : true
  );
  const categories = [...new Set(filtered.map((p) => p.category))].filter(Boolean);
  const grouped = categories.map((cat) => ({
    cat,
    items: filtered.filter((p) => p.category === cat),
  }));
  // Products without category
  const uncategorised = filtered.filter((p) => !p.category);
  if (uncategorised.length) grouped.push({ cat: "Other", items: uncategorised });

  const unavailableCount = products.filter((p) => overrides[p.id] === false).length;

  return (
    <div className="min-h-dvh bg-[#f0f0f0] flex flex-col pb-20">
      {/* Header */}
      <header className="bg-[#160800] text-white px-4 pt-12 pb-4 shrink-0">
        <h1 className="font-black text-xl">Availability</h1>
        <p className="text-white/50 text-xs mt-0.5">
          {session.storeName} &bull; {unavailableCount > 0 ? `${unavailableCount} item${unavailableCount > 1 ? "s" : ""} unavailable` : "All items available"}
        </p>
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
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : grouped.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-20">No items found</p>
        ) : (
          grouped.map(({ cat, items }) => (
            <div key={cat}>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 px-1">{cat}</p>
              <div className="bg-white rounded-2xl overflow-hidden divide-y divide-border/50">
                {items.map((item) => {
                  const available = overrides[item.id] !== false;
                  return (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-3.5">
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold truncate ${!available ? "text-muted-foreground line-through" : "text-[#160800]"}`}>
                          {item.name}
                        </p>
                        {!available && (
                          <p className="text-xs text-red-500 font-medium mt-0.5">Unavailable</p>
                        )}
                      </div>
                      <button
                        onClick={() => toggle(item.id)}
                        disabled={toggling === item.id}
                        className="shrink-0 transition-opacity disabled:opacity-50"
                      >
                        {available
                          ? <ToggleRight className="h-8 w-8 text-green-500" />
                          : <ToggleLeft  className="h-8 w-8 text-muted-foreground/40" />
                        }
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <StaffNav active="availability" />
    </div>
  );
}
