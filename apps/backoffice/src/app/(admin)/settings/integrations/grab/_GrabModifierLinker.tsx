"use client";

/**
 * "Unlinked GrabFood add-ons" panel.
 *
 * Grab order modifiers arrive with only an id + price, so add-ons print as
 * "Add-on @ RM 0.97" on the kitchen docket. This panel lists the modifier ids
 * seen in orders that aren't named yet and lets staff give each a label (e.g.
 * "Oat Milk"). Linking backfills past order lines too. Note: only modifiers from
 * orders received AFTER this feature shipped carry an id, so the list fills up
 * as new Grab orders arrive. Data + writes via /api/integrations/grab/modifier-links.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Link2, CheckCircle2, RefreshCw } from "lucide-react";
import { formatGrabItemPrice } from "@/lib/grab-item-links";

type UnlinkedMod = {
  grabModifierId: string;
  timesOrdered: number;
  minPriceRm: number | null;
  maxPriceRm: number | null;
  lastSeen: string;
};
type ModData = { items: UnlinkedMod[]; suggestions: string[]; products: { id: string; name: string }[] };

export function GrabModifierLinker() {
  const [data, setData] = useState<ModData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<Record<string, string>>({});
  const [product, setProduct] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/grab/modifier-links", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as ModData);
      setName({});
      setProduct({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const link = async (grabModifierId: string) => {
    const label = (name[grabModifierId] ?? "").trim();
    if (!label) return;
    setBusy((b) => ({ ...b, [grabModifierId]: true }));
    setMsg(null);
    try {
      const res = await fetch("/api/integrations/grab/modifier-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grabModifierId, name: label, productId: product[grabModifierId] || null }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      setMsg(`Named "${label}" — ${json.backfilledLines ?? 0} past order line(s) updated.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Link failed");
    } finally {
      setBusy((b) => ({ ...b, [grabModifierId]: false }));
    }
  };

  return (
    <section className="rounded-lg border border-neutral-200 bg-white">
      <header className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-3">
        <div>
          <h2 className="text-base font-medium text-neutral-900">Unlinked GrabFood add-ons</h2>
          <p className="mt-0.5 text-sm text-neutral-600">
            Grab sends add-ons with only an id + price, so they print as &ldquo;Add-on @ RM x&rdquo;.
            Give each a name (e.g. &ldquo;Oat Milk&rdquo;) so the kitchen docket reads correctly.
            Fills as new Grab orders arrive.
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

      <datalist id="grab-modifier-suggestions">
        {(data?.suggestions ?? []).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {loading ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="flex items-center justify-center gap-2 px-5 py-8 text-sm text-neutral-500">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" /> No unnamed GrabFood add-ons seen in orders.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-5 py-2">Grab modifier id</th>
              <th className="px-5 py-2 text-right">Price</th>
              <th className="px-5 py-2 text-right">Times</th>
              <th className="px-5 py-2">Name</th>
              <th className="px-5 py-2">Belongs to (optional)</th>
              <th className="px-5 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {data.items.map((it) => (
              <tr key={it.grabModifierId} className="align-middle text-neutral-800">
                <td className="px-5 py-2 font-mono text-xs">{it.grabModifierId}</td>
                <td className="px-5 py-2 text-right font-mono">{formatGrabItemPrice(it.minPriceRm, it.maxPriceRm)}</td>
                <td className="px-5 py-2 text-right">{it.timesOrdered}</td>
                <td className="px-5 py-2">
                  <input
                    type="text"
                    list="grab-modifier-suggestions"
                    value={name[it.grabModifierId] ?? ""}
                    onChange={(e) => setName((n) => ({ ...n, [it.grabModifierId]: e.target.value }))}
                    placeholder="e.g. Oat Milk"
                    className="w-44 rounded border border-neutral-300 px-2 py-1 text-sm focus:border-neutral-500 focus:outline-none"
                  />
                </td>
                <td className="px-5 py-2">
                  <select
                    value={product[it.grabModifierId] ?? ""}
                    onChange={(e) => setProduct((p) => ({ ...p, [it.grabModifierId]: e.target.value }))}
                    className="w-48 rounded border border-neutral-300 px-2 py-1 text-sm focus:border-neutral-500 focus:outline-none"
                  >
                    <option value="">—</option>
                    {data.products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-5 py-2">
                  <button
                    onClick={() => link(it.grabModifierId)}
                    disabled={!((name[it.grabModifierId] ?? "").trim()) || busy[it.grabModifierId]}
                    className="inline-flex items-center gap-1.5 rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy[it.grabModifierId] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                    Save
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
