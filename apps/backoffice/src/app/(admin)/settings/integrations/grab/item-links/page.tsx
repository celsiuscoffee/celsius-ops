"use client";

/**
 * GrabFood item linking.
 *
 * Grab order webhooks carry Grab's OWN item id (e.g. "MYITE2026…"), which never
 * matches our products.id — so unlinked lines reach the kitchen as
 * "Item @ RM x [MYITE..]" with no station routing. This page lets staff map
 * each Grab item id seen on recent orders to the real POS product. Linking
 * backfills the recent orders and fixes every future one (see
 * /api/integrations/grab/item-links + the order webhook).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, Link2, Unlink, ArrowLeft, CheckCircle2 } from "lucide-react";

type Product = { id: string; name: string; category: string | null; priceRM: number };
type LinkItem = {
  grabItemId: string;
  productId: string;
  productName: string | null;
  label: string | null;
  lastPriceRM: number | null;
  updatedAt: string;
};
type Unlinked = {
  grabItemId: string;
  sampleName: string | null;
  lastPriceRM: number | null;
  seen: number;
  lastSeen: string;
};
type Data = { products: Product[]; links: LinkItem[]; unlinked: Unlinked[] };

export default function GrabItemLinksPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Per-row selected product id (keyed by grab item id) + busy flags.
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/grab/item-links", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as Data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const productLabel = useCallback(
    (p: Product) => `${p.name}${p.priceRM ? ` · RM ${p.priceRM.toFixed(2)}` : ""}${p.category ? ` (${p.category})` : ""}`,
    [],
  );

  const sortedProducts = useMemo(
    () => (data?.products ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [data?.products],
  );

  const link = async (grabItemId: string, lastPriceRM: number | null, sampleName: string | null) => {
    const productId = picks[grabItemId];
    if (!productId) return;
    setBusy((s) => ({ ...s, [grabItemId]: true }));
    try {
      const res = await fetch("/api/integrations/grab/item-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grabItemId,
          productId,
          label: sampleName,
          lastPrice: lastPriceRM != null ? Math.round(lastPriceRM * 100) : null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      setFlash(`Linked ${grabItemId} → ${json.productName}${json.backfilled ? ` · fixed ${json.backfilled} order line(s)` : ""}`);
      setPicks((s) => {
        const next = { ...s };
        delete next[grabItemId];
        return next;
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Link failed");
    } finally {
      setBusy((s) => ({ ...s, [grabItemId]: false }));
    }
  };

  const unlink = async (grabItemId: string) => {
    setBusy((s) => ({ ...s, [grabItemId]: true }));
    try {
      const res = await fetch("/api/integrations/grab/item-links", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grabItemId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unlink failed");
    } finally {
      setBusy((s) => ({ ...s, [grabItemId]: false }));
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/settings/integrations/grab"
            className="mb-1 inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700"
          >
            <ArrowLeft className="h-3 w-3" /> Back to GrabFood integration
          </Link>
          <h1 className="text-2xl font-semibold text-neutral-900">GrabFood item linking</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-600">
            Grab sends its own item ids on orders, which don&apos;t match our menu. Unlinked items reach the
            kitchen as a bare &quot;Item&quot; with no station routing. Map each Grab item to the right product —
            linking fixes recent orders and every future one.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {flash ? (
        <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> {flash}
        </div>
      ) : null}
      {error ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : null}

      {/* Unlinked items */}
      <section className="rounded-lg border border-neutral-200 bg-white">
        <header className="border-b border-neutral-200 px-5 py-3">
          <h2 className="text-base font-medium text-neutral-900">
            Unlinked Grab items{data ? ` (${data.unlinked.length})` : ""}
          </h2>
          <p className="mt-0.5 text-sm text-neutral-600">
            Distinct Grab item ids seen on orders in the last 45 days that aren&apos;t mapped to a product yet.
          </p>
        </header>
        {!data || data.unlinked.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-neutral-500">
            Nothing unlinked — every recent Grab item maps to a product. 🎉
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-5 py-2">Grab item id</th>
                <th className="px-5 py-2 text-right">Price</th>
                <th className="px-5 py-2 text-right">Seen</th>
                <th className="px-5 py-2">Link to product</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {data.unlinked.map((u) => (
                <tr key={u.grabItemId} className="text-neutral-800">
                  <td className="px-5 py-2">
                    <code className="text-xs">{u.grabItemId}</code>
                    <div className="text-xs text-neutral-400">
                      last seen {new Date(u.lastSeen).toLocaleString("en-MY", { dateStyle: "short", timeStyle: "short" })}
                    </div>
                  </td>
                  <td className="px-5 py-2 text-right font-mono text-xs">
                    {u.lastPriceRM != null ? `RM ${u.lastPriceRM.toFixed(2)}` : "—"}
                  </td>
                  <td className="px-5 py-2 text-right text-xs text-neutral-500">{u.seen}×</td>
                  <td className="px-5 py-2">
                    <select
                      value={picks[u.grabItemId] ?? ""}
                      onChange={(e) => setPicks((s) => ({ ...s, [u.grabItemId]: e.target.value }))}
                      className="w-72 rounded border border-neutral-300 px-2 py-1 text-sm focus:border-neutral-500 focus:outline-none"
                    >
                      <option value="">Select product…</option>
                      {sortedProducts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {productLabel(p)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-5 py-2 text-right">
                    <button
                      onClick={() => link(u.grabItemId, u.lastPriceRM, u.sampleName)}
                      disabled={!picks[u.grabItemId] || busy[u.grabItemId]}
                      className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-2.5 py-1 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {busy[u.grabItemId] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                      Link
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Existing links */}
      <section className="rounded-lg border border-neutral-200 bg-white">
        <header className="border-b border-neutral-200 px-5 py-3">
          <h2 className="text-base font-medium text-neutral-900">
            Linked items{data ? ` (${data.links.length})` : ""}
          </h2>
        </header>
        {!data || data.links.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-neutral-500">No links yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-5 py-2">Grab item id</th>
                <th className="px-5 py-2">Product</th>
                <th className="px-5 py-2 text-right">Price seen</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {data.links.map((l) => (
                <tr key={l.grabItemId} className="text-neutral-800">
                  <td className="px-5 py-2">
                    <code className="text-xs">{l.grabItemId}</code>
                  </td>
                  <td className="px-5 py-2">
                    {l.productName ?? <span className="text-red-600">missing ({l.productId})</span>}
                  </td>
                  <td className="px-5 py-2 text-right font-mono text-xs">
                    {l.lastPriceRM != null ? `RM ${l.lastPriceRM.toFixed(2)}` : "—"}
                  </td>
                  <td className="px-5 py-2 text-right">
                    <button
                      onClick={() => unlink(l.grabItemId)}
                      disabled={busy[l.grabItemId]}
                      className="inline-flex items-center gap-1.5 rounded border border-neutral-300 bg-white px-2.5 py-1 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
                    >
                      {busy[l.grabItemId] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
                      Unlink
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
