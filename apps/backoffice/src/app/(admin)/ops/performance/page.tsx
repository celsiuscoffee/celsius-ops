"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, Loader2, ChevronRight } from "lucide-react";
import { KeyNumber } from "@/components/ui/key-number";
import { DateRangePicker } from "@/components/date-range-picker";
import { useFetch } from "@/lib/use-fetch";

type Outlet = { id: string; code: string; name: string };

type PerformanceData = {
  summary: {
    totalChecklists: number;
    completedChecklists: number;
    inProgressChecklists: number;
    pendingChecklists: number;
    completionRate: number;
    totalItems: number;
    itemsWithPhotos: number;
    photoRate: number;
  };
  staffBreakdown: {
    id: string; name: string; role: string;
    total: number; completed: number; completionRate: number;
    items: number; completedItems: number; itemsCompleted: number;
    photos: number; photoRate: number;
    checklistsClaimed: number; checklistsCompleted: number;
  }[];
  outletBreakdown: {
    id: string; name: string; code: string;
    total: number; completed: number; completionRate: number;
  }[];
  dailyTrend: { date: string; total: number; completed: number }[];
  incomplete: {
    id: string; sopTitle: string; category: string; outlet: string;
    assignedTo: string; date: string; shift: string;
    itemsCompleted: number; totalItems: number;
  }[];
};

export default function OpsPerformancePage() {
  const { data: outlets } = useFetch<Outlet[]>("/api/settings/outlets");
  const [outletId, setOutletId] = useState("");
  const [from, setFrom] = useState(() => {
    const d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return d.toISOString().split("T")[0];
  });
  const [to, setTo] = useState(() => new Date().toISOString().split("T")[0]);

  let apiUrl = `/api/ops/performance?from=${from}&to=${to}`;
  if (outletId) apiUrl += `&outletId=${outletId}`;

  const { data, isLoading } = useFetch<PerformanceData>(apiUrl);

  const sm = data?.summary;
  const weakest = data && data.outletBreakdown.length > 1
    ? [...data.outletBreakdown].sort((x, y) => x.completionRate - y.completionRate)[0]
    : null;
  const tone = (rate: number) => (rate >= 80 ? "text-ok-text" : rate >= 50 ? "text-warn-text" : "text-danger-text");
  const bar = (rate: number) => (rate >= 80 ? "bg-ok" : rate >= 50 ? "bg-warn" : "bg-danger");
  const staffRow = (s: PerformanceData["staffBreakdown"][number], low: boolean) => (
    <Link key={s.id} href={`/ops/performance/staff/${s.id}`} className="flex min-h-12 items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-sunken/50">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text">{s.name}</p>
        <p className="text-[12px] text-text-3">{s.role} · {s.completionRate}% of their checklists done · {s.photoRate}% with photos</p>
      </div>
      <p className={`shrink-0 font-mono text-sm font-semibold ${low ? "text-warn-text" : "text-text"}`}>{s.itemsCompleted}<span className="ml-1 font-sans text-[11px] font-normal text-text-3">tasks</span></p>
      <ChevronRight className="h-4 w-4 shrink-0 text-text-3" />
    </Link>
  );

  return (
    <div className="max-w-[1100px] space-y-5 px-4 pt-6 pb-10 md:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Outlet scorecard</h1>
          <p className="mt-0.5 text-sm text-text-2">Whether each outlet does its checklists, with photo proof, and which are left half done.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)} aria-label="Outlet"
            className="h-10 rounded-ctl border border-line bg-surface px-3 text-sm text-text">
            <option value="">All outlets</option>
            {outlets?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <DateRangePicker start={from} end={to} onChange={(s, e) => { setFrom(s); setTo(e); }} />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-text-3" /></div>
      ) : !data || !sm ? (
        <p className="text-sm text-text-2">No checklists in this period.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KeyNumber label="Checklists done" value={`${sm.completionRate}%`} tone={sm.completionRate < 80 ? "warn" : undefined}
              note={<><b className="font-semibold text-text-2">{sm.completedChecklists}</b> of {sm.totalChecklists} finished</>} />
            <KeyNumber label="With photo proof" value={`${sm.photoRate}%`} tone={sm.photoRate < 80 ? "warn" : undefined}
              note={<><b className="font-semibold text-text-2">{sm.itemsWithPhotos}</b> of {sm.totalItems} tasks</>} />
            <KeyNumber label="Left unfinished" value={String(data.incomplete.length)} tone={data.incomplete.length > 0 ? "warn" : undefined}
              note={data.incomplete.length > 0 ? "listed below" : "nothing left half done"} />
            <KeyNumber word label="Weakest outlet" value={weakest ? weakest.name : "–"} tone={weakest && weakest.completionRate < 80 ? "warn" : undefined}
              note={weakest ? <><b className="font-semibold text-text-2">{weakest.completionRate}%</b> of checklists done</> : "needs two or more outlets"} />
          </div>

          {data.incomplete.length > 0 && (
            <section aria-label="Left unfinished" className="overflow-hidden rounded-card border border-line bg-surface">
              <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold text-text">
                <AlertCircle className="h-4 w-4 text-warn-text" />Left unfinished
                <span className="rounded-full bg-warn-soft px-2 text-xs font-medium leading-5 text-warn-text">{data.incomplete.length}</span>
              </h2>
              {data.incomplete.map((item) => (
                <div key={item.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text">{item.sopTitle}</p>
                    <p className="truncate text-[12px] text-text-3">{item.outlet} · {item.assignedTo} · {item.shift}</p>
                  </div>
                  <span className="shrink-0 font-mono text-sm text-warn-text">{item.itemsCompleted}/{item.totalItems}</span>
                </div>
              ))}
            </section>
          )}

          <section aria-label="Outlets" className="overflow-hidden rounded-card border border-line bg-surface">
            <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-text">Outlets, weakest first</h2>
            {data.outletBreakdown.length === 0 ? <p className="px-4 py-6 text-center text-sm text-text-3">No outlet data.</p> :
              [...data.outletBreakdown].sort((x, y) => x.completionRate - y.completionRate).map((o) => (
                <div key={o.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text">{o.name}</p>
                    <p className="text-[12px] text-text-3">{o.completed} of {o.total} checklists done</p>
                  </div>
                  <div className="hidden h-2 w-24 overflow-hidden rounded-full bg-sunken sm:block">
                    <div className={`h-full rounded-full ${bar(o.completionRate)}`} style={{ width: `${o.completionRate}%` }} />
                  </div>
                  <span className={`w-12 shrink-0 text-right font-mono text-sm font-semibold ${tone(o.completionRate)}`}>{o.completionRate}%</span>
                </div>
              ))}
          </section>

          {data.dailyTrend.length > 0 && (
            <section aria-label="Day by day" className="rounded-card border border-line bg-surface px-4 py-3">
              <h2 className="mb-3 text-sm font-semibold text-text">Checklists done, day by day</h2>
              <div className="flex h-28 items-end gap-1">
                {data.dailyTrend.map((d) => {
                  const rate = d.total > 0 ? (d.completed / d.total) * 100 : 0;
                  return (
                    <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                      <span className="font-mono text-[10px] text-text-3">{Math.round(rate)}%</span>
                      <div className="relative w-full rounded-t bg-sunken" style={{ height: "64px" }}>
                        <div className="absolute bottom-0 w-full rounded-t bg-ink" style={{ height: `${rate}%` }} />
                      </div>
                      <span className="text-[10px] text-text-3">{new Date(d.date + "T00:00:00Z").toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short" })}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {data.staffBreakdown.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              <section aria-label="Most tasks done" className="overflow-hidden rounded-card border border-line bg-surface">
                <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-text">Most tasks done</h2>
                {data.staffBreakdown.slice(0, 3).map((s) => staffRow(s, false))}
              </section>
              {data.staffBreakdown.length > 3 && (
                <section aria-label="Fewest tasks done" className="overflow-hidden rounded-card border border-line bg-surface">
                  <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-text">Fewest tasks done</h2>
                  {data.staffBreakdown.slice(-3).reverse().map((s) => staffRow(s, true))}
                </section>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
