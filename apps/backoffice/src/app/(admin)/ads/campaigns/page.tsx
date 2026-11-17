"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

type Campaign = {
  id: string;
  name: string;
  status: string;
  channelType: string;
  outletId: string | null;
  outletName: string | null;
  accountName: string;
  costMYR: number;
  clicks: number;
  impressions: number;
  conversions: number;
  ctr: number;
  cpaMYR: number | null;
};

function fmtMYR(n: number): string {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR", maximumFractionDigits: 2 }).format(n);
}
function fmtInt(n: number): string { return new Intl.NumberFormat("en-MY").format(Math.round(n)); }

export default function CampaignsPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading, mutate } = useFetch<{ campaigns: Campaign[]; days: number }>(`/api/ads/campaigns?days=${days}`);
  const { data: outletData } = useFetch<Array<{ id: string; name: string }>>("/api/ops/outlets");

  if (isLoading || !data) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-text-3" /></div>;
  }

  async function updateOutlet(campaignId: string, outletId: string | null) {
    await fetch("/api/ads/campaigns", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId, outletId }),
    });
    mutate();
  }

  return (
    <div className="space-y-4 px-4 pt-6 pb-10 md:px-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Google campaigns</h1>
          <p className="mt-0.5 text-sm text-text-2">Each Google Ads campaign: spend, clicks and conversions, and which outlet it belongs to.</p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="h-10 rounded-ctl border border-line bg-surface px-3 text-sm text-text"
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      <Card className="overflow-hidden">
        {data.campaigns.length === 0 ? (
          <p className="p-8 text-center text-sm text-text-2">No campaigns yet. Run a sync from Settings.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-sunken text-xs text-text-2">
                <tr>
                  <th className="px-3 py-2 text-left font-normal">Campaign</th>
                  <th className="px-3 py-2 text-left font-normal">Status</th>
                  <th className="px-3 py-2 text-left font-normal">Outlet</th>
                  <th className="px-3 py-2 text-right font-normal">Spend</th>
                  <th className="px-3 py-2 text-right font-normal">Clicks</th>
                  <th className="px-3 py-2 text-right font-normal">CTR</th>
                  <th className="px-3 py-2 text-right font-normal">Conv.</th>
                  <th className="px-3 py-2 text-right font-normal">CPA</th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((c) => (
                  <tr key={c.id} className="border-t border-line hover:bg-sunken">
                    <td className="px-3 py-2">
                      <div className="text-text-2">{c.name}</div>
                      <div className="text-[11px] text-text-3">{c.channelType}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] ${
                        c.status === "ENABLED" ? "bg-ok-soft text-ok-text"
                        : c.status === "PAUSED" ? "bg-warn-soft text-warn-text"
                        : "bg-sunken text-text-2"
                      }`}>{c.status}</span>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={c.outletId ?? ""}
                        onChange={(e) => updateOutlet(c.id, e.target.value || null)}
                        className="rounded border border-line bg-surface px-2 py-1 text-xs"
                      >
                        <option value="">— none —</option>
                        {outletData?.map((o) => (
                          <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMYR(c.costMYR)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(c.clicks)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{(c.ctr * 100).toFixed(2)}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(c.conversions)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.cpaMYR != null ? fmtMYR(c.cpaMYR) : "—"}</td>
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
