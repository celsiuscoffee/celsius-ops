"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, AlertTriangle } from "lucide-react";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { toast } from "@celsius/ui";

// Admin-side per-outlet availability — writes to the same
// outlet_product_availability table the POS /oos screen uses. Semantics
// match the customer-facing menu loader:
//   - products.is_available === false      → globally off (greyed)
//   - override row is_available === false  → off at that outlet
//   - no override OR override is_available === true → available
// So a "true" override is harmless when global is on, and an admin
// can't override a globally-off product to on from this page (that
// would mask a real disablement). Edit the product on /pickup/menu to
// flip the global switch.

type Product = {
  id: string;
  name: string;
  category: string | null;
  is_available: boolean | null;
};

type Override = {
  outlet_id: string;
  product_id: string;
  is_available: boolean;
  reason: string | null;
  updated_at: string;
};

type Outlet = {
  store_id: string;
  display_name?: string | null;
  is_open?: boolean | null;
};

const OUTLET_LABELS: Record<string, string> = {
  conezion:    "Putrajaya",
  "shah-alam": "Shah Alam",
  tamarind:    "Tamarind",
  nilai:       "Nilai",
};

function overrideKey(outletId: string, productId: string): string {
  return `${outletId}:${productId}`;
}

export default function PickupMenuAvailabilityPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [overrides, setOverrides] = useState<Map<string, Override>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [savingCell, setSavingCell] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [availRes, outletsRes] = await Promise.all([
          adminFetch("/api/pickup/menu/availability").then((r) => r.json()),
          adminFetch("/api/pickup/integrations/outlets").then((r) => r.json()),
        ]);
        if (cancelled) return;
        const list = (availRes?.products ?? []) as Product[];
        const overs = (availRes?.overrides ?? []) as Override[];
        const map = new Map<string, Override>();
        for (const o of overs) map.set(overrideKey(o.outlet_id, o.product_id), o);
        setProducts(list);
        setOverrides(map);
        if (Array.isArray(outletsRes)) {
          setOutlets(outletsRes as Outlet[]);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Couldn't load availability";
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q),
    );
  }, [products, search]);

  // Effective availability at an outlet, mirroring the customer menu
  // loader: global off OR explicit override-off → unavailable.
  const isAvailableAt = (p: Product, outletId: string): boolean => {
    if (p.is_available === false) return false;
    const ov = overrides.get(overrideKey(outletId, p.id));
    if (ov && ov.is_available === false) return false;
    return true;
  };

  const toggleCell = async (p: Product, outletId: string) => {
    if (p.is_available === false) return; // can't override globally off
    const cellKey = overrideKey(outletId, p.id);
    setSavingCell(cellKey);
    const wasAvailable = isAvailableAt(p, outletId);
    const nextAvailable = !wasAvailable;
    try {
      const res = await adminFetch("/api/pickup/menu/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outlet_id:    outletId,
          product_id:   p.id,
          is_available: nextAvailable,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setOverrides((prev) => {
        const next = new Map(prev);
        next.set(cellKey, {
          outlet_id:    outletId,
          product_id:   p.id,
          is_available: nextAvailable,
          reason:       prev.get(cellKey)?.reason ?? null,
          updated_at:   new Date().toISOString(),
        });
        return next;
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Save failed";
      toast.error(msg);
    } finally {
      setSavingCell(null);
    }
  };

  // Sort outlets so the column order is stable (alphabetical by
  // display label). Drops any outlets the integrations API didn't
  // return so we don't end up with phantom columns.
  const sortedOutlets = useMemo(() => {
    return [...outlets].sort((a, b) => {
      const la = OUTLET_LABELS[a.store_id] ?? a.store_id;
      const lb = OUTLET_LABELS[b.store_id] ?? b.store_id;
      return la.localeCompare(lb);
    });
  }, [outlets]);

  const offCount = useMemo(() => {
    let n = 0;
    for (const ov of overrides.values()) if (!ov.is_available) n += 1;
    return n;
  }, [overrides]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="px-6 py-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-[#160800]">Menu availability</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Mark items unavailable at specific outlets. Customers picking that
          outlet won&apos;t see them. Globally-disabled items (greyed) are
          managed on <a className="text-indigo-600 hover:underline" href="/pickup/menu">Pickup → Menu</a>.
        </p>
        {offCount > 0 && (
          <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" />
            {offCount} outlet override{offCount === 1 ? "" : "s"} active
          </p>
        )}
      </div>

      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products or categories"
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-gray-400 focus:outline-none"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-gray-50">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium text-gray-700">
                Product
              </th>
              {sortedOutlets.map((o) => (
                <th
                  key={o.store_id}
                  className="px-3 py-2.5 text-center font-medium text-gray-700 whitespace-nowrap"
                >
                  {OUTLET_LABELS[o.store_id] ?? o.store_id}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((p) => {
              const globallyOff = p.is_available === false;
              return (
                <tr key={p.id} className={globallyOff ? "bg-gray-50" : ""}>
                  <td className="px-4 py-2.5">
                    <div className={`font-medium ${globallyOff ? "text-gray-400" : "text-gray-900"}`}>
                      {p.name}
                      {globallyOff && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                          globally off
                        </span>
                      )}
                    </div>
                    {p.category && (
                      <div className="text-xs text-gray-500">{p.category}</div>
                    )}
                  </td>
                  {sortedOutlets.map((o) => {
                    const cellKey = overrideKey(o.store_id, p.id);
                    const available = isAvailableAt(p, o.store_id);
                    const isSaving = savingCell === cellKey;
                    return (
                      <td key={o.store_id} className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => toggleCell(p, o.store_id)}
                          disabled={globallyOff || isSaving}
                          className={[
                            "inline-flex h-6 w-11 items-center rounded-full transition-colors",
                            globallyOff
                              ? "bg-gray-200 cursor-not-allowed"
                              : available
                                ? "bg-emerald-500"
                                : "bg-rose-500",
                            isSaving ? "opacity-50" : "",
                          ].join(" ")}
                          aria-label={`${available ? "Available" : "Unavailable"} at ${OUTLET_LABELS[o.store_id] ?? o.store_id}`}
                        >
                          <span
                            className={[
                              "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
                              available ? "translate-x-5" : "translate-x-0.5",
                            ].join(" ")}
                          />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={sortedOutlets.length + 1} className="px-4 py-10 text-center text-sm text-gray-500">
                  No products match &ldquo;{search}&rdquo;.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
