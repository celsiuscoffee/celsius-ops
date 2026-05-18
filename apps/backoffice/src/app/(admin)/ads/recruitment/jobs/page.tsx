"use client";

import { useState } from "react";
import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";
import { Card } from "@/components/ui/card";
import { Loader2, BarChart3, Star } from "lucide-react";

type JobRow = {
  id:            string;
  indeedJobId:   string;
  title:         string;
  campaignName:  string | null;
  locationCity:  string | null;
  locationState: string | null;
  status:        string | null;
  premium:       boolean;
  outletId:      string | null;
  outletName:    string | null;
  lastSyncedAt:  string;
  impressions:   number;
  clicks:        number;
  applyStarts:   number;
  applies:       number;
  spendUsd:      number;
};

function fmtUSD(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
}
function fmtInt(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

export default function RecruitmentJobsPage() {
  const { data, isLoading } = useFetch<{ jobs: JobRow[] }>("/api/ads/indeed/jobs");
  const [search, setSearch] = useState("");

  const jobs = data?.jobs ?? [];
  const filtered = search
    ? jobs.filter(j =>
        j.title.toLowerCase().includes(search.toLowerCase()) ||
        (j.locationCity ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (j.campaignName ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : jobs;

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          <Link href="/ads/recruitment" className="hover:underline">Recruitment</Link>
          <span>/</span>
          <span>Jobs</span>
        </div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-terracotta" /> Sponsored Jobs
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every Indeed sponsored job pulled from your account. Spend is lifetime total across all dates synced.
        </p>
      </div>

      <Card className="p-4">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by title, city, or campaign…"
          className="w-full border rounded px-3 py-2 text-sm bg-background"
        />
      </Card>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          No sponsored jobs found. Run a sync from <Link href="/ads/recruitment/settings" className="text-terracotta underline">Settings</Link>.
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-900 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-normal">Title</th>
                <th className="px-4 py-2 text-left font-normal">Campaign</th>
                <th className="px-4 py-2 text-left font-normal">Location</th>
                <th className="px-4 py-2 text-left font-normal">Outlet</th>
                <th className="px-4 py-2 text-left font-normal">Status</th>
                <th className="px-4 py-2 text-right font-normal">Spend</th>
                <th className="px-4 py-2 text-right font-normal">Impressions</th>
                <th className="px-4 py-2 text-right font-normal">Clicks</th>
                <th className="px-4 py-2 text-right font-normal">Applies</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(j => (
                <tr key={j.id} className="border-t">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      {j.premium && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
                      {j.title}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{j.campaignName ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {j.locationCity ? `${j.locationCity}${j.locationState ? `, ${j.locationState}` : ""}` : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {j.outletName ?? <span className="text-amber-600">Unmapped</span>}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <span className={`inline-flex rounded px-1.5 py-0.5 ${
                      j.status === "OPEN"   ? "bg-emerald-50 text-emerald-700"
                      : j.status === "PAUSED" ? "bg-amber-50 text-amber-700"
                      : "bg-neutral-100 text-neutral-700"
                    }`}>
                      {j.status ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{fmtUSD(j.spendUsd)}</td>
                  <td className="px-4 py-2 text-right text-muted-foreground tabular-nums">{fmtInt(j.impressions)}</td>
                  <td className="px-4 py-2 text-right text-muted-foreground tabular-nums">{fmtInt(j.clicks)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtInt(j.applies)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
