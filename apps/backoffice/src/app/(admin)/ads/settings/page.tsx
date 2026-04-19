"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Card } from "@/components/ui/card";
import { Loader2, RefreshCw, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

type SyncLog = {
  id: string;
  kind: string;
  accountId: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  rowsInserted: number | null;
  rowsUpdated: number | null;
  errorMessage: string | null;
};

export default function AdsSettingsPage() {
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const { data, mutate } = useFetch<{ logs: SyncLog[] }>("/api/ads/sync");

  async function runSync(kind: string, days?: number) {
    setBusy(kind);
    setToast(null);
    try {
      const res = await fetch("/api/ads/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, days }),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast({ type: "err", msg: json.error ?? "Sync failed" });
      } else {
        setToast({ type: "ok", msg: `Sync complete (${kind})` });
        mutate();
      }
    } catch (err) {
      setToast({ type: "err", msg: err instanceof Error ? err.message : "Network error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <h1 className="text-xl font-semibold">Ads Settings</h1>

      {toast && (
        <Card className={`flex items-center gap-2 p-3 text-sm ${
          toast.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"
        }`}>
          {toast.type === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {toast.msg}
        </Card>
      )}

      {/* Manual sync buttons */}
      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-medium">Manual Sync</h2>
        <p className="text-xs text-neutral-500">
          Normally the daily cron handles this. Use these buttons after first setup, or if you need a fresh pull.
        </p>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            onClick={() => runSync("accounts")}
            disabled={!!busy}
            className="flex items-center justify-center gap-2 rounded-md border border-neutral-200 px-4 py-2.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
          >
            {busy === "accounts" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync Accounts
          </button>
          <button
            onClick={() => runSync("metrics", 7)}
            disabled={!!busy}
            className="flex items-center justify-center gap-2 rounded-md border border-neutral-200 px-4 py-2.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
          >
            {busy === "metrics" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync Last 7 Days
          </button>
          <button
            onClick={() => runSync("metrics", 90)}
            disabled={!!busy}
            className="flex items-center justify-center gap-2 rounded-md border border-neutral-200 px-4 py-2.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
          >
            {busy === "metrics" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Backfill 90 Days
          </button>
          <button
            onClick={() => runSync("invoices")}
            disabled={!!busy}
            className="flex items-center justify-center gap-2 rounded-md border border-neutral-200 px-4 py-2.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
          >
            {busy === "invoices" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync Invoices (YTD)
          </button>
        </div>
      </Card>

      {/* Campaign→Outlet links */}
      <Card className="space-y-2 p-4">
        <h2 className="text-sm font-medium">Campaign → Outlet Links</h2>
        <p className="text-xs text-neutral-500">
          Link each campaign to an outlet on the <a href="/ads/campaigns" className="text-terracotta underline">Campaigns page</a> using the Outlet dropdown per row.
        </p>
      </Card>

      {/* Sync log */}
      <Card className="overflow-hidden">
        <div className="border-b border-neutral-100 px-4 py-2 text-sm font-medium">Recent Syncs</div>
        {!data?.logs || data.logs.length === 0 ? (
          <p className="p-6 text-center text-sm text-neutral-500">No sync history yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-left font-normal">Kind</th>
                  <th className="px-3 py-2 text-left font-normal">Started</th>
                  <th className="px-3 py-2 text-left font-normal">Status</th>
                  <th className="px-3 py-2 text-right font-normal">Inserted</th>
                  <th className="px-3 py-2 text-right font-normal">Updated</th>
                  <th className="px-3 py-2 text-left font-normal">Error</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map((log) => (
                  <tr key={log.id} className="border-t border-neutral-100">
                    <td className="px-3 py-2 text-xs">{log.kind}</td>
                    <td className="px-3 py-2 text-xs text-neutral-500">{new Date(log.startedAt).toLocaleString("en-MY")}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${
                        log.status === "OK" ? "bg-emerald-50 text-emerald-700"
                        : log.status === "RUNNING" ? "bg-amber-50 text-amber-700"
                        : "bg-rose-50 text-rose-700"
                      }`}>
                        {log.status === "OK" ? <CheckCircle2 className="h-3 w-3" /> :
                         log.status === "RUNNING" ? <Loader2 className="h-3 w-3 animate-spin" /> :
                         <AlertCircle className="h-3 w-3" />}
                        {log.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">{log.rowsInserted ?? "—"}</td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">{log.rowsUpdated ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-rose-600 truncate max-w-xs">{log.errorMessage ?? "—"}</td>
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
