"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Card } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Loader2, Megaphone } from "lucide-react";
import Link from "next/link";
import { KeyNumber } from "@/components/ui/key-number";

type OverviewData = {
  mtd: { impressions: number; clicks: number; conversions: number; costMYR: number };
  prev: { impressions: number; clicks: number; conversions: number; costMYR: number };
  trend: Array<{ date: string; costMYR: number; clicks: number; impressions: number; conversions: number }>;
  topCampaigns: Array<{ id: string; name: string; costMYR: number; clicks: number; conversions: number }>;
};

type ConversionData = {
  byCategory: Array<{ category: string; conversions: number; value: number }>;
  byAction: Array<{ name: string; category: string; conversions: number; value: number }>;
};

const CATEGORY_LABELS: Record<string, string> = {
  GET_DIRECTIONS: "Directions requested",
  PHONE_CALL_LEAD: "Phone calls",
  STORE_VISIT: "Store visits",
  SUBMIT_LEAD_FORM: "Lead forms",
  OUTBOUND_CLICK: "Outbound clicks",
  PAGE_VIEW: "Page views",
  CONTACT: "Contact actions",
  BOOK_APPOINTMENT: "Bookings",
  PURCHASE: "Purchases",
  ENGAGEMENT: "Engagement",
  LEAD: "Leads",
  DEFAULT: "Other conversions",
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

type Preset = "7d" | "30d" | "90d" | "mtd" | "last_month" | "ytd" | "custom";

function presetRange(p: Preset): { from: string; to: string } {
  const today = new Date();
  const y = today.getUTCFullYear(); const m = today.getUTCMonth(); const d = today.getUTCDate();
  const iso = (dt: Date) => dt.toISOString().slice(0, 10);
  const addDays = (dt: Date, n: number) => { const x = new Date(dt); x.setUTCDate(x.getUTCDate() + n); return x; };
  if (p === "7d") return { from: iso(addDays(today, -6)), to: iso(today) };
  if (p === "30d") return { from: iso(addDays(today, -29)), to: iso(today) };
  if (p === "90d") return { from: iso(addDays(today, -89)), to: iso(today) };
  if (p === "mtd") return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(today) };
  if (p === "last_month") {
    const s = new Date(Date.UTC(y, m - 1, 1));
    const e = new Date(Date.UTC(y, m, 0));
    return { from: iso(s), to: iso(e) };
  }
  // ytd
  return { from: iso(new Date(Date.UTC(y, 0, 1))), to: iso(today) };
}

export default function AdsOverviewPage() {
  const [outletId, setOutletId] = useState<string>("all");
  const [campaignId, setCampaignId] = useState<string>("all");
  const [preset, setPreset] = useState<Preset>("mtd");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");

  const range = preset === "custom"
    ? { from: customFrom, to: customTo }
    : presetRange(preset);

  const qs = new URLSearchParams();
  if (outletId !== "all") qs.set("outletId", outletId);
  if (campaignId !== "all") qs.set("campaignId", campaignId);
  if (range.from) qs.set("from", range.from);
  if (range.to) qs.set("to", range.to);
  const qsStr = qs.toString();

  const { data, isLoading, error } = useFetch<OverviewData>(`/api/ads/overview${qsStr ? `?${qsStr}` : ""}`);
  const { data: convData } = useFetch<ConversionData>(`/api/ads/conversions${qsStr ? `?${qsStr}` : ""}`);
  const { data: outletList } = useFetch<Array<{ id: string; name: string }>>("/api/ops/outlets");
  const { data: campaignData } = useFetch<{ campaigns: Array<{ id: string; name: string; outletId: string | null }> }>("/api/ads/campaigns?days=365");

  const campaignOptions = (campaignData?.campaigns ?? []).filter((c) => {
    if (outletId === "all") return true;
    if (outletId === "unlinked") return c.outletId == null;
    return c.outletId === outletId;
  });

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-text-3" /></div>;
  }
  if (error || !data) {
    return (
      <div className="px-4 pt-6 pb-10 md:px-8">
        <Card className="p-6 text-center text-sm text-text-2">
          <Megaphone className="mx-auto mb-3 h-8 w-8 text-text-3" />
          No ads data yet. Go to <Link href="/ads/settings" className="text-brand-text underline">Settings</Link> and run a manual sync.
        </Card>
      </div>
    );
  }

  const costDelta = pctDelta(data.mtd.costMYR, data.prev.costMYR);
  const clickDelta = pctDelta(data.mtd.clicks, data.prev.clicks);
  const convDelta = pctDelta(data.mtd.conversions, data.prev.conversions);

  return (
    <div className="space-y-4 px-4 pt-6 pb-10 md:px-8">
      <div>
        <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Ads</h1>
        <p className="mt-0.5 text-sm text-text-2">What Google Ads cost, what came back, and what each result costs us.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            value={outletId}
            onChange={(e) => { setOutletId(e.target.value); setCampaignId("all"); }}
            className="h-10 rounded-ctl border border-line bg-surface px-3 text-sm text-text"
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
            className="h-10 rounded-ctl border border-line bg-surface px-3 text-sm text-text"
          >
            <option value="all">All campaigns</option>
            {campaignOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as Preset)}
            className="h-10 rounded-ctl border border-line bg-surface px-3 text-sm text-text"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="mtd">Month to date</option>
            <option value="last_month">Last month</option>
            <option value="ytd">Year to date</option>
            <option value="custom">Custom</option>
          </select>
          {preset === "custom" && (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-10 rounded-ctl border border-line bg-surface px-2 text-sm text-text"
              />
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-10 rounded-ctl border border-line bg-surface px-2 text-sm text-text"
              />
            </>
          )}
        </div>
      </div>

      {/* Key numbers */}
      {(() => {
        const vs = (d: { pct: number; dir: string }) => d.dir === "flat" ? "same as the period before" : `${d.pct > 0 ? "+" : ""}${d.pct.toFixed(0)}% vs the period before`;
        const cpa = data.mtd.conversions > 0 ? data.mtd.costMYR / data.mtd.conversions : null;
        const prevCpa = data.prev.conversions > 0 ? data.prev.costMYR / data.prev.conversions : null;
        const cpc = data.mtd.clicks > 0 ? data.mtd.costMYR / data.mtd.clicks : null;
        return (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KeyNumber label="Spend" value={fmtMYR(data.mtd.costMYR)} note={vs(costDelta)} />
            <KeyNumber label="Conversions" value={fmtInt(data.mtd.conversions)} tone={convDelta.dir === "down" ? "warn" : undefined} note={vs(convDelta)} />
            <KeyNumber label="Cost per conversion" value={cpa == null ? "–" : `RM${cpa.toFixed(2)}`}
              tone={cpa != null && prevCpa != null && cpa > prevCpa * 1.1 ? "warn" : undefined}
              note={prevCpa == null ? "no conversions before" : <>was <b className="font-semibold text-text-2">RM{prevCpa.toFixed(2)}</b></>} />
            <KeyNumber label="Clicks" value={fmtInt(data.mtd.clicks)} note={cpc == null ? vs(clickDelta) : <>RM{cpc.toFixed(2)} a click · {fmtInt(data.mtd.impressions)} views</>} />
          </div>
        );
      })()}

      {/* Trend chart */}
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-text">Spend, last 90 days</h2>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--color-text-3)" }} />
              <YAxis tick={{ fontSize: 10, fill: "var(--color-text-3)" }} tickFormatter={(v) => `RM${Math.round(v)}`} />
              <Tooltip formatter={(v: number) => fmtMYR(v)} labelStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="costMYR" stroke="var(--color-brand)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Conversion breakdown */}
      {convData && convData.byCategory.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-text">What people did</h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 lg:grid-cols-3">
            {convData.byCategory.map((c) => (
              <div key={c.category} className="flex items-center justify-between border-b border-line py-2">
                <div>
                  <div className="text-sm text-text-2">{CATEGORY_LABELS[c.category] ?? c.category}</div>
                                  </div>
                <div className="text-lg font-semibold tabular-nums">{fmtInt(c.conversions)}</div>
              </div>
            ))}
          </div>
          {convData.byAction.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-text-2">View by individual action ({convData.byAction.length})</summary>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-text-2">
                    <th className="pb-1 font-normal">Action</th>
                    <th className="pb-1 font-normal">Category</th>
                    <th className="pb-1 text-right font-normal">Conversions</th>
                  </tr>
                </thead>
                <tbody>
                  {convData.byAction.map((a) => (
                    <tr key={`${a.name}-${a.category}`} className="border-t border-line">
                      <td className="py-1.5">{a.name}</td>
                      <td className="py-1.5 text-xs text-text-2">{a.category}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtInt(a.conversions)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </Card>
      )}

      {/* Top campaigns */}
      <div className="overflow-hidden rounded-card border border-line bg-surface">
        <p className="border-b border-line px-4 py-3 text-sm font-semibold text-text">Campaigns, by spend</p>
        {data.topCampaigns.length === 0 && <p className="px-4 py-8 text-center text-sm text-text-3">No campaign data yet.</p>}
        {data.topCampaigns.map((c) => (
          <div key={c.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text">{c.name}</p>
              <p className="mt-0.5 text-[12px] text-text-3">{fmtInt(c.clicks)} clicks · {fmtInt(c.conversions)} conversions{c.conversions > 0 ? ` · RM${(c.costMYR / c.conversions).toFixed(2)} each` : ""}</p>
            </div>
            <p className="shrink-0 font-mono text-sm font-semibold text-text">{fmtMYR(c.costMYR)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
