"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Card } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { TrendingUp, TrendingDown, MousePointerClick, Eye, Target, Coins, Loader2, Megaphone } from "lucide-react";
import Link from "next/link";

type OverviewData = {
  mtd: { impressions: number; clicks: number; conversions: number; costMYR: number };
  prev: { impressions: number; clicks: number; conversions: number; costMYR: number };
  trend: Array<{ date: string; costMYR: number; clicks: number; impressions: number; conversions: number }>;
  topCampaigns: Array<{ id: string; name: string; costMYR: number; clicks: number; conversions: number }>;
};

function fmtMYR(n: number): string {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR", maximumFractionDigits: 0 }).format(n);
}
function fmtInt(n: number): string { return new Intl.NumberFormat("en-MY").format(Math.round(n)); }
function pctDelta(curr: number, prev: number): { pct: number; dir: "up" | "down" | "flat" } {
  if (prev === 0) return { pct: 0, dir: "flat" };
  const d = (curr - prev) / prev;
  return { pct: d * 100, dir: d > 0.001 ? "up" : d < -0.001 ? "down" : "flat" };
}

function KpiCard({ label, value, prev, icon: Icon }: { label: string; value: string; prev: { pct: number; dir: "up" | "down" | "flat" }; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      <div className={`mt-1 flex items-center gap-1 text-xs ${
        prev.dir === "up" ? "text-emerald-600" : prev.dir === "down" ? "text-rose-600" : "text-neutral-400"
      }`}>
        {prev.dir === "up" && <TrendingUp className="h-3 w-3" />}
        {prev.dir === "down" && <TrendingDown className="h-3 w-3" />}
        {prev.pct.toFixed(1)}% vs prev month
      </div>
    </Card>
  );
}

export default function AdsOverviewPage() {
  const [outletId, setOutletId] = useState<string>("all");
  const [campaignId, setCampaignId] = useState<string>("all");

  const qs = new URLSearchParams();
  if (outletId !== "all") qs.set("outletId", outletId);
  if (campaignId !== "all") qs.set("campaignId", campaignId);
  const qsStr = qs.toString();

  const { data, isLoading, error } = useFetch<OverviewData>(`/api/ads/overview${qsStr ? `?${qsStr}` : ""}`);
  const { data: outletList } = useFetch<Array<{ id: string; name: string }>>("/api/ops/outlets");
  const { data: campaignData } = useFetch<{ campaigns: Array<{ id: string; name: string; outletId: string | null }> }>("/api/ads/campaigns?days=365");

  const campaignOptions = (campaignData?.campaigns ?? []).filter((c) => {
    if (outletId === "all") return true;
    if (outletId === "unlinked") return c.outletId == null;
    return c.outletId === outletId;
  });

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-neutral-400" /></div>;
  }
  if (error || !data) {
    return (
      <div className="p-6">
        <Card className="p-6 text-center text-sm text-neutral-500">
          <Megaphone className="mx-auto mb-3 h-8 w-8 text-neutral-300" />
          No ads data yet. Go to <Link href="/ads/settings" className="text-terracotta underline">Settings</Link> and run a manual sync.
        </Card>
      </div>
    );
  }

  const costDelta = pctDelta(data.mtd.costMYR, data.prev.costMYR);
  const clickDelta = pctDelta(data.mtd.clicks, data.prev.clicks);
  const impDelta = pctDelta(data.mtd.impressions, data.prev.impressions);
  const convDelta = pctDelta(data.mtd.conversions, data.prev.conversions);

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Ads Overview</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={outletId}
            onChange={(e) => { setOutletId(e.target.value); setCampaignId("all"); }}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm"
          >
            <option value="all">All outlets</option>
            <option value="unlinked">Unlinked</option>
            {outletList?.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm"
          >
            <option value="all">All campaigns</option>
            {campaignOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <div className="flex gap-2 text-xs">
            <Link href="/ads/campaigns" className="rounded-md border px-3 py-1.5 hover:bg-neutral-50">Campaigns</Link>
            <Link href="/ads/invoices" className="rounded-md border px-3 py-1.5 hover:bg-neutral-50">Invoices</Link>
            <Link href="/ads/settings" className="rounded-md border px-3 py-1.5 hover:bg-neutral-50">Settings</Link>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Spend MTD" value={fmtMYR(data.mtd.costMYR)} prev={costDelta} icon={Coins} />
        <KpiCard label="Clicks MTD" value={fmtInt(data.mtd.clicks)} prev={clickDelta} icon={MousePointerClick} />
        <KpiCard label="Impressions MTD" value={fmtInt(data.mtd.impressions)} prev={impDelta} icon={Eye} />
        <KpiCard label="Conversions MTD" value={fmtInt(data.mtd.conversions)} prev={convDelta} icon={Target} />
      </div>

      {/* Trend chart */}
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-medium">Spend (last 90 days)</h2>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `RM${Math.round(v)}`} />
              <Tooltip formatter={(v: number) => fmtMYR(v)} labelStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="costMYR" stroke="#c55b3c" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Top campaigns */}
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-medium">Top Campaigns (MTD by spend)</h2>
        {data.topCampaigns.length === 0 ? (
          <p className="py-4 text-center text-xs text-neutral-400">No campaign data yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500">
                <th className="pb-2 font-normal">Campaign</th>
                <th className="pb-2 text-right font-normal">Spend</th>
                <th className="pb-2 text-right font-normal">Clicks</th>
                <th className="pb-2 text-right font-normal">Conv.</th>
              </tr>
            </thead>
            <tbody>
              {data.topCampaigns.map((c) => (
                <tr key={c.id} className="border-t border-neutral-100">
                  <td className="py-2 text-neutral-700">{c.name}</td>
                  <td className="py-2 text-right">{fmtMYR(c.costMYR)}</td>
                  <td className="py-2 text-right">{fmtInt(c.clicks)}</td>
                  <td className="py-2 text-right">{fmtInt(c.conversions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
