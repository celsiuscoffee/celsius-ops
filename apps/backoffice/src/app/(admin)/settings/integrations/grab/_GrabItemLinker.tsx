"use client";

/**
 * "Unlinked GrabFood items" panel.
 *
 * GrabFood order webhooks carry only Grab's own item id (e.g. "MYITE2026...").
 * Until a catalogue product claims that id (products.grab_item_id), the line
 * prints as "Item @ RM x" and outbound price/availability pushes don't reach
 * Grab. This panel lists the ids seen in real orders that aren't linked yet and
 * lets staff point each at the right catalogue product. Linking also backfills
 * past order lines' names. Data + writes via /api/integrations/grab/links.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Link2, CheckCircle2, RefreshCw } from "lucide-react";
import { formatGrabItemPrice } from "@/lib/grab-item-links";

type UnlinkedItem = {
  grabItemId: string;
  timesOrdered: number;
  minPriceRm: number | null;
  maxPriceRm: number | null;
  lastSeen: string;
};
type PickerProduct = { id: string; name: string; category: string | null; grabPriceRm: number | null };
type LinksData = { items: UnlinkedItem[]; products: PickerProduct[] };

export function GrabItemLinker() {
  const [data, setData] = useState<LinksData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/grab/links", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as LinksData);
      setPicked({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const link = async (grabItemId: string) => {
    const productId = picked[grabItemId];
    if (!productId) return;
    setBusy((b) => ({ ...b, [grabItemId]: true }));
    setMsg(null);
    try {
      const res = await fetch("/api/integrations/grab/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grabItemId, productId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      const name = data?.products.find((p) => p.id === productId)?.name ?? productId;
      setMsg(`Linked to "${name}" — ${json.backfilledLines ?? 0} past order line(s) updated.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Link failed");
    } finally {
      setBusy((b) => ({ ...b, [grabItemId]: false }));
    }
  };

  return (
    <section className="rounded-lg border border-neutral-200 bg-white">
      <header className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-3">
        <div>
          <h2 className="text-base font-medium text-neutral-900">Unlinked GrabFood items</h2>
          <p className="mt-0.5 text-sm text-neutral-600">
            Grab orders arrive with Grab&rsquo;s own item id. Point each at a catalogue product so
            orders show the real name + route to the right kitchen station, and price/availability
            sync to Grab. Tip: match by the order price &amp; how recently it sold.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex shrink-0 items-center gap-2 rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </header>

      {msg ? (
        <div className="border-b border-emerald-100 bg-emerald-50 px-5 py-2 text-sm text-emerald-700">{msg}</div>
      ) : null}
      {error ? (
        <div className="border-b border-red-100 bg-red-50 px-5 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      {loading ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="flex items-center justify-center gap-2 px-5 py-8 text-sm text-neutral-500">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Every GrabFood item seen in orders is linked.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-5 py-2">Grab item id</th>
              <th className="px-5 py-2 text-right">Order price</th>
              <th className="px-5 py-2 text-right">Times</th>
              <th className="px-5 py-2 text-right">Last seen</th>
              <th className="px-5 py-2">Link to product</th>
              <th className="px-5 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {data.items.map((it) => (
              <tr key={it.grabItemId} className="align-middle text-neutral-800">
                <td className="px-5 py-2 font-mono text-xs">{it.grabItemId}</td>
                <td className="px-5 py-2 text-right font-mono">{formatGrabItemPrice(it.minPriceRm, it.maxPriceRm)}</td>
                <td className="px-5 py-2 text-right">{it.timesOrdered}</td>
                <td className="px-5 py-2 text-right text-xs text-neutral-500">
                  {new Date(it.lastSeen).toLocaleString("en-MY", { dateStyle: "short", timeStyle: "short" })}
                </td>
                <td className="px-5 py-2">
                  <select
                    value={picked[it.grabItemId] ?? ""}
                    onChange={(e) => setPicked((p) => ({ ...p, [it.grabItemId]: e.target.value }))}
                    className="w-64 rounded border border-neutral-300 px-2 py-1 text-sm focus:border-neutral-500 focus:outline-none"
                  >
                    <option value="">Select a product…</option>
                    {data.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.grabPriceRm != null ? ` — RM ${p.grabPriceRm.toFixed(2)}` : ""}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-5 py-2">
                  <button
                    onClick={() => link(it.grabItemId)}
                    disabled={!picked[it.grabItemId] || busy[it.grabItemId]}
                    className="inline-flex items-center gap-1.5 rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy[it.grabItemId] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                    Link
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
