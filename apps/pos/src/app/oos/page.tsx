"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";

// Hardcoded outlet roster — matches the pickup app's outlet_settings.
// Staff at the KDS pick their outlet here, then flip individual
// products on/off. We use the pickup store_id (text) directly because
// it's the key on outlet_product_availability.
const OUTLETS: Array<{ store_id: string; label: string }> = [
  { store_id: "conezion",  label: "Putrajaya (Conezion)" },
  { store_id: "shah-alam", label: "Shah Alam" },
  { store_id: "tamarind",  label: "Tamarind Square" },
];

type Product = {
  id: string;
  name: string;
  category: string | null;
  is_available: boolean | null;
};

type Override = {
  product_id: string;
  is_available: boolean;
  reason: string | null;
  updated_at: string;
  updated_by: string | null;
};

/**
 * "86" / Out-of-stock toggle screen for the kitchen.
 *
 * Lives at /oos, linked from the KDS header. The barista who notices
 * they've run out of mango syrup taps the product → product flips off
 * for THIS outlet only (other outlets keep selling it). The pickup app
 * filters this list out at menu-fetch time.
 *
 * Sparse table: a row in outlet_product_availability is only written
 * when an explicit toggle has happened. Absence = use the product's
 * global is_available.
 */
export default function OutOfStockPage() {
  const supabase = createClient();
  const [outletId, setOutletId] = useState<string>(OUTLETS[0]!.store_id);
  const [products, setProducts] = useState<Product[]>([]);
  const [overrides, setOverrides] = useState<Map<string, Override>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [reasonInput, setReasonInput] = useState<{ id: string; value: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Pickup app's products live on the same Supabase project, just
      // a different table namespace.
      const [{ data: prods }, { data: ovs }] = await Promise.all([
        supabase
          .from("products")
          .select("id, name, category, is_available")
          .eq("brand_id", "brand-celsius")
          .order("name"),
        supabase
          .from("outlet_product_availability")
          .select("product_id, is_available, reason, updated_at, updated_by")
          .eq("outlet_id", outletId),
      ]);
      if (cancelled) return;
      setProducts((prods ?? []) as Product[]);
      const next = new Map<string, Override>();
      for (const o of (ovs ?? []) as Override[]) {
        next.set(o.product_id, o);
      }
      setOverrides(next);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, outletId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q),
    );
  }, [products, search]);

  // Effective availability = global AND no per-outlet OFF override.
  const isAvailable = (p: Product): boolean => {
    if (p.is_available === false) return false;
    const ov = overrides.get(p.id);
    if (ov && ov.is_available === false) return false;
    return true;
  };

  const toggle = async (p: Product, reason?: string) => {
    setSavingId(p.id);
    try {
      const cur = overrides.get(p.id);
      const nextAvailable = cur ? !cur.is_available : false; // first toggle = mark unavailable
      const row: Override = {
        product_id: p.id,
        is_available: nextAvailable,
        reason: reason ?? cur?.reason ?? null,
        updated_at: new Date().toISOString(),
        updated_by: null, // TODO: capture staff user id when KDS auth lands
      };
      const { error } = await supabase
        .from("outlet_product_availability")
        .upsert(
          {
            outlet_id: outletId,
            product_id: p.id,
            is_available: nextAvailable,
            reason: row.reason,
            updated_at: row.updated_at,
          },
          { onConflict: "outlet_id,product_id" },
        );
      if (error) {
        console.error("[oos] toggle error:", error.message);
        return;
      }
      setOverrides((prev) => {
        const next = new Map(prev);
        next.set(p.id, row);
        return next;
      });
    } finally {
      setSavingId(null);
    }
  };

  const offCount = useMemo(() => {
    let n = 0;
    for (const ov of overrides.values()) if (!ov.is_available) n += 1;
    return n;
  }, [overrides]);

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-neutral-800 bg-neutral-900 px-4 py-3">
        <Link
          href="/kds"
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-800 hover:bg-neutral-700"
          title="Back to KDS"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Out of Stock</h1>
          <p className="text-xs text-neutral-400">
            Tap a product to mark it unavailable at this outlet only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {offCount > 0 && (
            <span className="rounded-full bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-300">
              <AlertTriangle className="mr-1 inline h-3 w-3" />
              {offCount} off
            </span>
          )}
          <select
            value={outletId}
            onChange={(e) => setOutletId(e.target.value)}
            className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
          >
            {OUTLETS.map((o) => (
              <option key={o.store_id} value={o.store_id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Search */}
      <div className="border-b border-neutral-800 bg-neutral-900 px-4 py-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products…"
          className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
        />
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-500" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 p-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => {
            const available = isAvailable(p);
            const isSaving = savingId === p.id;
            const ov = overrides.get(p.id);
            return (
              <button
                key={p.id}
                onClick={() => toggle(p)}
                disabled={isSaving || p.is_available === false}
                className={`flex items-start justify-between gap-3 rounded-xl border p-4 text-left transition-colors ${
                  available
                    ? "border-neutral-800 bg-neutral-900 hover:bg-neutral-800"
                    : "border-amber-700 bg-amber-950/40 hover:bg-amber-950/60"
                } ${p.is_available === false ? "opacity-40" : ""}`}
                title={
                  p.is_available === false
                    ? "Globally disabled by backoffice"
                    : available
                      ? "Tap to mark out of stock"
                      : "Tap to mark back in stock"
                }
              >
                <div className="flex-1">
                  <p className="font-semibold">{p.name}</p>
                  {p.category && (
                    <p className="mt-0.5 text-xs text-neutral-400">{p.category}</p>
                  )}
                  {ov && !ov.is_available && ov.reason && (
                    <p className="mt-2 text-xs italic text-amber-300">"{ov.reason}"</p>
                  )}
                </div>
                <div className="text-right">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                      available
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-amber-500/30 text-amber-200"
                    }`}
                  >
                    {p.is_available === false
                      ? "Disabled"
                      : available
                        ? "Available"
                        : "Out of stock"}
                  </span>
                  {isSaving && (
                    <Loader2 className="mt-1 ml-auto h-3 w-3 animate-spin text-neutral-500" />
                  )}
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="col-span-full py-12 text-center text-sm text-neutral-500">
              No products match.
            </p>
          )}
        </div>
      )}

      {/* Reason dialog */}
      {reasonInput && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center bg-black/60"
          onClick={() => setReasonInput(null)}
        >
          <div
            className="w-80 rounded-2xl bg-neutral-900 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-base font-semibold">Reason (optional)</h3>
            <input
              autoFocus
              value={reasonInput.value}
              onChange={(e) => setReasonInput({ id: reasonInput.id, value: e.target.value })}
              placeholder="e.g. out of mango syrup"
              className="mb-4 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-amber-500"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setReasonInput(null)}
                className="flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700"
              >
                Skip
              </button>
              <button
                onClick={() => {
                  const p = products.find((x) => x.id === reasonInput.id);
                  if (p) toggle(p, reasonInput.value || undefined);
                  setReasonInput(null);
                }}
                className="flex-1 rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-amber-950 hover:bg-amber-400"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
