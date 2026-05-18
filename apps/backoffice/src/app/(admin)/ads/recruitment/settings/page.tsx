"use client";

import { useState } from "react";
import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";
import { Card } from "@/components/ui/card";
import { Loader2, RefreshCw, CheckCircle2, XCircle, AlertCircle, SlidersHorizontal } from "lucide-react";

type SyncLog = {
  id:           string;
  kind:         string;
  status:       string;
  startedAt:    string;
  finishedAt:   string | null;
  rowsUpserted: number | null;
  errorMessage: string | null;
};

export default function RecruitmentSettingsPage() {
  const [busy, setBusy] = useState<number | null>(null);
  const [toast, setToast] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const { data, mutate } = useFetch<{ logs: SyncLog[] }>("/api/ads/indeed/settings");

  async function runSync(days: number): Promise<void> {
    setBusy(days);
    setToast(null);
    try {
      const res = await fetch("/api/ads/indeed/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setToast({ type: "err", msg: json.error ?? "Sync failed" });
      } else {
        setToast({ type: "ok", msg: `Sync complete: ${json.jobsUpserted} jobs, ${json.metricsUpserted} daily rows` });
        mutate();
      }
    } catch (err) {
      setToast({ type: "err", msg: err instanceof Error ? err.message : "Network error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          <Link href="/ads/recruitment" className="hover:underline">Recruitment</Link>
          <span>/</span>
          <span>Settings</span>
        </div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <SlidersHorizontal className="h-6 w-6 text-terracotta" /> Recruitment Ads Settings
        </h1>
      </div>

      {toast && (
        <Card className={`flex items-center gap-2 p-3 text-sm ${
          toast.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                              : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"
        }`}>
          {toast.type === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {toast.msg}
        </Card>
      )}

      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-medium">Manual Sync</h2>
        <p className="text-xs text-muted-foreground">
          Pulls campaigns, jobs, and per-day metrics from Indeed. Run after first setup or to refresh recent data.
        </p>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button
            onClick={() => runSync(7)}
            disabled={!!busy}
            className="flex items-center justify-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-700 px-4 py-2.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-50"
          >
            {busy === 7 ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync Last 7 Days
          </button>
          <button
            onClick={() => runSync(30)}
            disabled={!!busy}
            className="flex items-center justify-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-700 px-4 py-2.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-50"
          >
            {busy === 30 ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync Last 30 Days
          </button>
          <button
            onClick={() => runSync(180)}
            disabled={!!busy}
            className="flex items-center justify-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-700 px-4 py-2.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-50"
          >
            {busy === 180 ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Backfill 180 Days
          </button>
        </div>
      </Card>

      <Card className="space-y-2 p-4">
        <h2 className="text-sm font-medium">City → Outlet Mapping</h2>
        <p className="text-xs text-muted-foreground">
          Indeed reports job locations by city, not by outlet name. The sync resolves each city to one of your outlets via{" "}
          <code className="px-1 rounded bg-neutral-100 dark:bg-neutral-800">src/lib/indeed/outlet-map.ts</code>.
        </p>
        <table className="text-xs w-full max-w-md">
          <thead className="text-muted-foreground">
            <tr><th className="text-left py-1 font-normal">Indeed city</th><th className="text-left py-1 font-normal">Outlet</th></tr>
          </thead>
          <tbody>
            <tr><td className="py-0.5">Shah Alam</td><td>Shah Alam</td></tr>
            <tr><td className="py-0.5">Putrajaya</td><td>Conezion</td></tr>
            <tr><td className="py-0.5">Cyberjaya</td><td>Tamarind</td></tr>
            <tr><td className="py-0.5">Nilai</td>    <td>Nilai</td></tr>
          </tbody>
        </table>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b px-4 py-2 text-sm font-medium">Recent Syncs</div>
        {!data?.logs || data.logs.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No sync history yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 dark:bg-neutral-900 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-normal">Kind</th>
                  <th className="px-3 py-2 text-left font-normal">Started</th>
                  <th className="px-3 py-2 text-left font-normal">Status</th>
                  <th className="px-3 py-2 text-right font-normal">Rows</th>
                  <th className="px-3 py-2 text-left font-normal">Error</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map(log => (
                  <tr key={log.id} className="border-t">
                    <td className="px-3 py-2 text-xs">{log.kind}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(log.startedAt).toLocaleString("en-MY")}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${
                        log.status === "ok"      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        : log.status === "running" ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                        : "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                      }`}>
                        {log.status === "ok" ? <CheckCircle2 className="h-3 w-3" /> :
                         log.status === "running" ? <Loader2 className="h-3 w-3 animate-spin" /> :
                         <AlertCircle className="h-3 w-3" />}
                        {log.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">{log.rowsUpserted ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-rose-600 truncate max-w-md">{log.errorMessage ?? "—"}</td>
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
