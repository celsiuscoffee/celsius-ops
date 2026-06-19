"use client";

import { useMemo, useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Card } from "@/components/ui/card";
import { Loader2, RefreshCw, Trash2, Megaphone } from "lucide-react";

/* ─── types ─── */
type OverviewRow = {
  outletId: string; name: string; orders: number;
  revenueMYR: number; promoMYR: number; adSpendMYR: number;
  totalMYR: number; marketingPctOfRevenue: number | null;
};
type Overview = {
  range: { from: string; to: string };
  totals: { revenueMYR: number; promoMYR: number; adSpendMYR: number; totalMYR: number; orders: number; marketingPctOfRevenue: number | null };
  byOutlet: OverviewRow[];
};
type Campaign = {
  id: string; outletId: string; outletName: string; grabCampaignId: string;
  name: string | null; createdBy: string | null; status: string | null;
  discountSummary: string | null; syncedAt: string;
};
type AdSpend = {
  id: string; outletId: string; outletName: string;
  periodStart: string; periodEnd: string; amountMYR: number; note: string | null; createdBy: string | null;
};
// Minimal shape of a useFetch() result, for typing the section sub-components.
type Q<T> = { data: T | undefined; isLoading: boolean; mutate: () => void };

/* ─── helpers ─── */
const fmtMYR = (n: number) => new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(n || 0);
const fmtPct = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);
function monthToDate(): { from: string; to: string } {
  const t = new Date();
  return { from: `${t.toISOString().slice(0, 8)}01`, to: t.toISOString().slice(0, 10) };
}

type Tab = "overview" | "campaigns" | "spend";

export default function GrabMarketingPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const def = useMemo(monthToDate, []);
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [outletId, setOutletId] = useState("all");

  const { data: outlets } = useFetch<Array<{ id: string; name: string }>>("/api/ops/outlets");
  const q = `from=${from}&to=${to}&outletId=${outletId}`;
  const overview = useFetch<Overview>(`/api/ads/grab/overview?${q}`);
  const campaigns = useFetch<{ campaigns: Campaign[] }>(`/api/ads/grab/campaigns?outletId=${outletId}`);
  const spend = useFetch<{ entries: AdSpend[] }>(`/api/ads/grab/ad-spend?${q}`);

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  async function syncCampaigns() {
    setSyncing(true); setSyncMsg(null);
    try {
      const res = await fetch("/api/ads/grab/campaigns", { method: "POST" });
      const j = await res.json();
      setSyncMsg(res.ok ? `Synced ${j.upserted} campaign(s) across ${j.outlets} outlet(s).${j.errors?.length ? ` ${j.errors.length} error(s).` : ""}` : (j.errors?.[0] ?? "Sync failed"));
      campaigns.mutate();
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-emerald-600" />
          <h1 className="text-xl font-semibold">GrabFood Marketing</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm">
            <option value="all">All outlets</option>
            {(outlets ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm" />
          <span className="text-neutral-400">→</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm" />
        </div>
      </div>

      {/* tabs */}
      <div className="flex gap-1 border-b border-neutral-200">
        {([["overview", "Overview"], ["campaigns", "Campaigns"], ["spend", "Ad Spend"]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === k ? "border-emerald-600 text-emerald-700" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab q={overview} />}
      {tab === "campaigns" && <CampaignsTab q={campaigns} onSync={syncCampaigns} syncing={syncing} syncMsg={syncMsg} />}
      {tab === "spend" && <SpendTab q={spend} outlets={outlets ?? []} defaults={{ from, to }} />}
    </div>
  );
}

/* ─── Overview ─── */
function OverviewTab({ q }: { q: Q<Overview> }) {
  if (q.isLoading || !q.data) return <Spinner />;
  const { totals, byOutlet } = q.data;
  const stats = [
    { label: "GrabFood revenue", value: fmtMYR(totals.revenueMYR) },
    { label: "Promo cost (merchant-funded)", value: fmtMYR(totals.promoMYR) },
    { label: "GrabAds spend", value: fmtMYR(totals.adSpendMYR) },
    { label: "Total marketing", value: fmtMYR(totals.totalMYR), accent: true },
    { label: "% of revenue", value: fmtPct(totals.marketingPctOfRevenue) },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">{s.label}</div>
            <div className={`mt-1 text-lg font-semibold ${s.accent ? "text-emerald-700" : "text-neutral-900"}`}>{s.value}</div>
          </Card>
        ))}
      </div>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs text-neutral-500">
              <tr>
                <th className="px-3 py-2 text-left font-normal">Outlet</th>
                <th className="px-3 py-2 text-right font-normal">Orders</th>
                <th className="px-3 py-2 text-right font-normal">Revenue</th>
                <th className="px-3 py-2 text-right font-normal">Promo cost</th>
                <th className="px-3 py-2 text-right font-normal">Ad spend</th>
                <th className="px-3 py-2 text-right font-normal">Total mktg</th>
                <th className="px-3 py-2 text-right font-normal">% of rev</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {byOutlet.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-neutral-500">No GrabFood activity in this range.</td></tr>
              ) : byOutlet.map((r) => (
                <tr key={r.outletId}>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-right">{r.orders}</td>
                  <td className="px-3 py-2 text-right">{fmtMYR(r.revenueMYR)}</td>
                  <td className="px-3 py-2 text-right">{fmtMYR(r.promoMYR)}</td>
                  <td className="px-3 py-2 text-right">{fmtMYR(r.adSpendMYR)}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtMYR(r.totalMYR)}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(r.marketingPctOfRevenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-xs text-neutral-400">
        Promo cost = merchant-funded discounts on GrabFood orders (Grab-funded promos excluded). GrabAds spend is entered
        manually on the Ad Spend tab — GrabAds paid advertising isn&apos;t exposed by the GrabFood Partner API.
      </p>
    </div>
  );
}

/* ─── Campaigns ─── */
function CampaignsTab({ q, onSync, syncing, syncMsg }: {
  q: Q<{ campaigns: Campaign[] }>; onSync: () => void; syncing: boolean; syncMsg: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-neutral-500">Promotions mirrored from GrabFood (read-only).</p>
        <button onClick={onSync} disabled={syncing}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sync from Grab
        </button>
      </div>
      {syncMsg && <p className="text-xs text-neutral-500">{syncMsg}</p>}
      <Card className="overflow-hidden">
        {q.isLoading || !q.data ? <Spinner /> : q.data.campaigns.length === 0 ? (
          <p className="p-8 text-center text-sm text-neutral-500">No campaigns synced yet — hit &ldquo;Sync from Grab&rdquo;.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-left font-normal">Campaign</th>
                  <th className="px-3 py-2 text-left font-normal">Outlet</th>
                  <th className="px-3 py-2 text-left font-normal">Discount</th>
                  <th className="px-3 py-2 text-left font-normal">Funded by</th>
                  <th className="px-3 py-2 text-left font-normal">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {q.data.campaigns.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2">{c.name ?? c.grabCampaignId}</td>
                    <td className="px-3 py-2">{c.outletName}</td>
                    <td className="px-3 py-2">{c.discountSummary ?? "—"}</td>
                    <td className="px-3 py-2">{c.createdBy ?? "—"}</td>
                    <td className="px-3 py-2">{c.status ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ─── Ad Spend (manual) ─── */
function SpendTab({ q, outlets, defaults }: {
  q: Q<{ entries: AdSpend[] }>; outlets: Array<{ id: string; name: string }>; defaults: { from: string; to: string };
}) {
  const [outletId, setOutletId] = useState("");
  const [periodStart, setPeriodStart] = useState(defaults.from);
  const [periodEnd, setPeriodEnd] = useState(defaults.to);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setErr(null);
    const amountMYR = Number(amount);
    if (!outletId || !Number.isFinite(amountMYR) || amountMYR < 0) { setErr("Pick an outlet and enter a valid amount."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/ads/grab/ad-spend", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outletId, periodStart, periodEnd, amountMYR, note: note || undefined }),
      });
      if (!res.ok) { setErr((await res.json()).error ?? "Failed to add"); return; }
      setAmount(""); setNote(""); q.mutate();
    } finally {
      setBusy(false);
    }
  }
  async function del(id: string) {
    await fetch(`/api/ads/grab/ad-spend?id=${id}`, { method: "DELETE" });
    q.mutate();
  }

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="text-sm font-medium text-neutral-800">Add GrabAds spend</div>
        <p className="mt-0.5 text-xs text-neutral-500">From your Grab merchant billing/payout statement (GrabAds isn&apos;t in the API).</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm lg:col-span-2">
            <option value="">Select outlet…</option>
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm" />
          <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm" />
          <input type="number" min="0" step="0.01" placeholder="Amount (RM)" value={amount} onChange={(e) => setAmount(e.target.value)} className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm" />
          <button onClick={add} disabled={busy} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
        <input type="text" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="mt-2 w-full rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm" />
        {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      </Card>

      <Card className="overflow-hidden">
        {q.isLoading || !q.data ? <Spinner /> : q.data.entries.length === 0 ? (
          <p className="p-8 text-center text-sm text-neutral-500">No ad spend entered for this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-left font-normal">Outlet</th>
                  <th className="px-3 py-2 text-left font-normal">Period</th>
                  <th className="px-3 py-2 text-right font-normal">Amount</th>
                  <th className="px-3 py-2 text-left font-normal">Note</th>
                  <th className="px-3 py-2 text-right font-normal"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {q.data.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-2">{e.outletName}</td>
                    <td className="px-3 py-2">{e.periodStart} → {e.periodEnd}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmtMYR(e.amountMYR)}</td>
                    <td className="px-3 py-2 text-neutral-500">{e.note ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => del(e.id)} className="text-neutral-400 hover:text-red-600" title="Delete"><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Spinner() {
  return <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-neutral-400" /></div>;
}
