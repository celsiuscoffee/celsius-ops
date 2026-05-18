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

type JobRow = {
  id:           string;
  title:        string;
  campaignName: string | null;
  locationCity: string | null;
  outletId:     string | null;
  outletName:   string | null;
};

type Outlet = { id: string; code: string; name: string };

export default function RecruitmentSettingsPage() {
  const [busy, setBusy] = useState<number | null>(null);
  const [toast, setToast] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [savingJobId, setSavingJobId] = useState<string | null>(null);

  const { data: logsData, mutate: mutateLogs } = useFetch<{ logs: SyncLog[] }>("/api/ads/indeed/settings");
  const { data: jobsData, mutate: mutateJobs } = useFetch<{ jobs: JobRow[] }>("/api/ads/indeed/jobs");
  const { data: outletsData } = useFetch<{ outlets: Outlet[] }>("/api/settings/outlets?status=ACTIVE");

  const outlets = outletsData?.outlets ?? [];
  const jobs    = jobsData?.jobs ?? [];

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
        mutateLogs();
        mutateJobs();
      }
    } catch (err) {
      setToast({ type: "err", msg: err instanceof Error ? err.message : "Network error" });
    } finally {
      setBusy(null);
    }
  }

  async function setOutlet(jobId: string, outletId: string | null): Promise<void> {
    setSavingJobId(jobId);
    try {
      const res = await fetch(`/api/ads/indeed/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outletId }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Save failed");
      }
      mutateJobs();
    } catch (err) {
      setToast({ type: "err", msg: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setSavingJobId(null);
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
          Pulls postings and per-day metrics from Indeed. Run after first setup or to refresh recent data.
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

      <Card className="overflow-hidden">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-medium">Posting → Outlet Attachment</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Each Indeed posting is auto-attached to an outlet using the city in the listing. Override the attachment here for postings the auto-map got wrong (or didn&apos;t recognise).
          </p>
        </div>
        {jobs.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No postings yet. Run a sync above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 dark:bg-neutral-900 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-normal">Posting</th>
                  <th className="px-3 py-2 text-left font-normal">Campaign</th>
                  <th className="px-3 py-2 text-left font-normal">City</th>
                  <th className="px-3 py-2 text-left font-normal">Attached to</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(j => (
                  <tr key={j.id} className="border-t">
                    <td className="px-3 py-2">{j.title}</td>
                    <td className="px-3 py-2 text-muted-foreground">{j.campaignName ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{j.locationCity ?? "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <select
                          value={j.outletId ?? ""}
                          disabled={savingJobId === j.id}
                          onChange={e => setOutlet(j.id, e.target.value || null)}
                          className="border rounded px-2 py-1 text-sm bg-background min-w-[160px]"
                        >
                          <option value="">— Unmapped —</option>
                          {outlets.map(o => (
                            <option key={o.id} value={o.id}>{o.name}</option>
                          ))}
                        </select>
                        {savingJobId === j.id && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b px-4 py-2 text-sm font-medium">Recent Syncs</div>
        {!logsData?.logs || logsData.logs.length === 0 ? (
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
                {logsData.logs.map(log => (
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
