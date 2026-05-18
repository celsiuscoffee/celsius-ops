"use client";

import { useState } from "react";
import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Briefcase, MapPin, Megaphone, TrendingUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

type OverviewData = {
  window: { from: string; to: string };
  byOutlet: Array<{
    outletId:    string | null;
    outletName:  string;
    spendUsd:    number;
    impressions: number;
    clicks:      number;
    applies:     number;
  }>;
  byJob: Array<{
    jobId:       string;
    title:       string;
    city:        string | null;
    outletName:  string | null;
    spendUsd:    number;
    impressions: number;
    clicks:      number;
    applies:     number;
  }>;
  trend: Array<{ date: string; spendUsd: number; applies: number; clicks: number }>;
  lastSync: { kind: string; status: string; at: string } | null;
};

function fmtUSD(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
}
function fmtInt(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

export default function RecruitmentPage() {
  const today = new Date();
  const yearStart = new Date(today.getFullYear(), 0, 1).toISOString().slice(0, 10);
  const toDate = today.toISOString().slice(0, 10);

  const [from, setFrom] = useState(yearStart);
  const [to,   setTo]   = useState(toDate);
  const [syncing, setSyncing] = useState(false);

  const { data, isLoading, mutate } = useFetch<OverviewData>(
    `/api/ads/indeed/overview?from=${from}&to=${to}`,
  );

  async function runSync(): Promise<void> {
    setSyncing(true);
    try {
      const res = await fetch("/api/ads/indeed/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 30 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Sync failed: ${res.status}`);
      await mutate();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  const totalSpend = data?.byOutlet.reduce((s, r) => s + r.spendUsd, 0) ?? 0;
  const totalApplies = data?.byOutlet.reduce((s, r) => s + r.applies, 0) ?? 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Link href="/ads" className="hover:underline">Ads</Link>
            <span>/</span>
            <span>Recruitment</span>
          </div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Briefcase className="h-6 w-6 text-terracotta" /> Recruitment Ads (Indeed)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Per-outlet recruitment spend on Indeed Sponsored Jobs. Data is pulled via the Sponsored Jobs API and rolled up by outlet via city mapping.
          </p>
        </div>
        <Button onClick={runSync} disabled={syncing} className="gap-2">
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Sync now
        </Button>
      </div>

      <Card className="p-4 flex flex-wrap items-center gap-4">
        <label className="text-sm">From <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="ml-2 border rounded px-2 py-1 text-sm bg-background" /></label>
        <label className="text-sm">To <input type="date" value={to} onChange={e => setTo(e.target.value)} className="ml-2 border rounded px-2 py-1 text-sm bg-background" /></label>
        {data?.lastSync && (
          <div className="ml-auto text-xs text-muted-foreground">
            Last sync: {new Date(data.lastSync.at).toLocaleString()} ({data.lastSync.status})
          </div>
        )}
      </Card>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : !data || data.byOutlet.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          <Megaphone className="h-8 w-8 mx-auto mb-2 opacity-50" />
          No recruitment ad data yet. Click <span className="font-medium">Sync now</span> to pull from Indeed.
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Total spend</div>
              <div className="text-2xl font-semibold mt-1">{fmtUSD(totalSpend)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Applies received</div>
              <div className="text-2xl font-semibold mt-1">{fmtInt(totalApplies)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Cost per apply</div>
              <div className="text-2xl font-semibold mt-1">{totalApplies > 0 ? fmtUSD(totalSpend / totalApplies) : "—"}</div>
            </Card>
          </div>

          {data.trend && data.trend.length > 0 && (
            <Card className="p-4">
              <h2 className="font-medium mb-3 flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Daily spend & applies</h2>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data.trend} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left"  tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value: number, key) => key === "spendUsd" ? fmtUSD(value) : fmtInt(value)}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Line yAxisId="left"  type="monotone" dataKey="spendUsd" stroke="#c4642d" name="Spend"   strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="applies"  stroke="#3b82f6" name="Applies" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          )}

          <Card className="p-4">
            <h2 className="font-medium mb-3 flex items-center gap-2"><MapPin className="h-4 w-4" /> Spend by outlet</h2>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="py-2">Outlet</th>
                  <th className="py-2 text-right">Spend</th>
                  <th className="py-2 text-right">Impressions</th>
                  <th className="py-2 text-right">Clicks</th>
                  <th className="py-2 text-right">Applies</th>
                  <th className="py-2 text-right">Cost/apply</th>
                </tr>
              </thead>
              <tbody>
                {data.byOutlet.map(row => (
                  <tr key={row.outletId ?? "unassigned"} className="border-t">
                    <td className="py-2">{row.outletName}</td>
                    <td className="py-2 text-right font-medium">{fmtUSD(row.spendUsd)}</td>
                    <td className="py-2 text-right">{fmtInt(row.impressions)}</td>
                    <td className="py-2 text-right">{fmtInt(row.clicks)}</td>
                    <td className="py-2 text-right">{fmtInt(row.applies)}</td>
                    <td className="py-2 text-right">{row.applies > 0 ? fmtUSD(row.spendUsd / row.applies) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="p-4">
            <h2 className="font-medium mb-3 flex items-center gap-2"><Briefcase className="h-4 w-4" /> Jobs</h2>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="py-2">Title</th>
                  <th className="py-2">Location</th>
                  <th className="py-2">Outlet</th>
                  <th className="py-2 text-right">Spend</th>
                  <th className="py-2 text-right">Applies</th>
                </tr>
              </thead>
              <tbody>
                {data.byJob.map(j => (
                  <tr key={j.jobId} className="border-t">
                    <td className="py-2">{j.title}</td>
                    <td className="py-2 text-muted-foreground">{j.city ?? "—"}</td>
                    <td className="py-2">{j.outletName ?? <span className="text-amber-600">Unmapped</span>}</td>
                    <td className="py-2 text-right font-medium">{fmtUSD(j.spendUsd)}</td>
                    <td className="py-2 text-right">{fmtInt(j.applies)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
