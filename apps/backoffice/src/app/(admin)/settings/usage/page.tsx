"use client";

// Settings › Office Usage (declutter, 17 Nov 2026; ported from Gosamē Office):
// which pages people open, how many people open each, and on which device.
// Views are counted inside the back office only (components/usage-tracker.tsx →
// /api/usage → ActivityLog). After 30 days, menu pages nobody opened are the
// candidates to remove (docs/design/backoffice-structure.md §2c).

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, EyeOff, Loader2, RefreshCw } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";
import type { UsageSummary } from "@/lib/usage";

const n = (v: number) => v.toLocaleString("en-MY");
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const dayMonth = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-MY", { day: "numeric", month: "short", timeZone: "UTC" });
const lastSeen = (iso: string) =>
  new Date(iso).toLocaleString("en-MY", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kuala_Lumpur" }).replace("am", "AM").replace("pm", "PM");

function delta(cur: number, prev: number): { text: string; cls: string } | null {
  if (!prev) return null;
  const d = Math.round(((cur - prev) / prev) * 100);
  return { text: `${d > 0 ? "+" : ""}${d}%`, cls: d >= 0 ? "text-ok-text" : "text-danger-text" };
}

function Kpi({ label, value, note, change }: { label: string; value: string; note: React.ReactNode; change?: { text: string; cls: string } | null }) {
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <p className="text-[12px] font-medium text-text-2">{label}</p>
      <p className="mt-1 flex items-baseline gap-2 font-mono text-[26px] font-semibold leading-8 text-text">
        {value}
        {change && <span className={`text-[12px] font-semibold ${change.cls}`}>{change.text}</span>}
      </p>
      <p className="mt-1 text-[12px] text-text-3">{note}</p>
    </div>
  );
}

type View = "pages" | "people";

export default function OfficeUsagePage() {
  const { data, error, isLoading, mutate } = useFetch<UsageSummary>("/api/usage?days=30");
  const [view, setView] = useState<View>("pages");

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">
          {data ? `Last 30 days · ${dayMonth(data.from)} – ${dayMonth(data.to)}` : "Last 30 days"}
        </p>
        <h1 className="mt-1 text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Office usage</h1>
        <p className="mt-1.5 max-w-[640px] text-sm text-text-2">
          Which pages people open, how many people open each, and on which device. Counted inside the back office only; nothing is sent anywhere else.
        </p>
      </div>
      <button type="button" onClick={() => mutate()} className="inline-flex h-8 items-center gap-1.5 rounded-ctl border border-line-2 px-3 text-[13px] font-medium text-text hover:bg-sunken">
        <RefreshCw className="size-3.5" /> Refresh
      </button>
    </div>
  );

  if (error && !data) {
    return (
      <div className="mx-auto max-w-[1240px] space-y-4 px-4 pt-6 pb-10 md:px-8">
        {header}
        <p className="rounded-card border border-danger-soft bg-danger-soft px-4 py-3 text-sm text-danger-text">
          {String((error as Error).message).includes("403")
            ? "Only owners, admins and managers with Staff & Access can see Office usage."
            : "Office usage did not load. Try again in a moment."}
        </p>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-[1240px] space-y-4 px-4 pt-6 pb-10 md:px-8">
        {header}
        <div className="flex items-center gap-2 text-sm text-text-2"><Loader2 className="size-4 animate-spin" /> Loading usage…</div>
      </div>
    );
  }

  const t = data.totals;
  const menuCount = data.unopened.length + data.pages.filter((p) => p.where !== "Off the menu").length;

  return (
    <div className="mx-auto max-w-[1240px] space-y-4 px-4 pt-6 pb-10 md:px-8">
      {header}

      {t.views === 0 ? (
        <div className="rounded-card border border-line bg-surface px-5 py-8 text-center">
          <p className="text-[15px] font-semibold text-text">No page views yet</p>
          <p className="mt-1 text-sm text-text-2">Views land here as people open back-office pages, from the day this page went live. Check back tomorrow.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Page views" value={n(t.views)} change={delta(t.views, data.previous.views)} note={<>{n(Math.round(t.views / data.days))} a day; the 30 days before: {n(data.previous.views)}</>} />
            <Kpi label="People" value={n(t.people)} change={delta(t.people, data.previous.people)} note={<>opened the back office; the 30 days before: {n(data.previous.people)}</>} />
            <Kpi label="On a phone" value={`${pct(t.phoneViews, t.views)}%`} note={<>{n(t.phoneViews)} on a phone, {n(t.desktopViews)} on a computer</>} />
            <Kpi label="Pages nobody opened" value={n(data.unopened.length)} note={<>of {n(menuCount)} pages in the menu</>} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <section className="overflow-clip rounded-card border border-line bg-surface">
              <div className="flex gap-1 border-b border-line px-3" role="tablist" aria-label="Rank by">
                {([["pages", "Pages"], ["people", "Who uses it"]] as [View, string][]).map(([v, label]) => (
                  <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
                    className={"-mb-px h-10 border-b-2 px-3 text-[13px] " + (view === v ? "border-text font-semibold text-text" : "border-transparent text-text-2 hover:text-text")}>
                    {label}
                  </button>
                ))}
              </div>
              {view === "pages" ? (
                <ul>
                  {data.pages.map((p) => (
                    <li key={p.page} className="border-t border-line first:border-t-0">
                      <Link href={p.page.includes(":id") ? "#" : p.page} className="flex min-h-12 items-center gap-3 px-4 py-2 hover:bg-raised">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium text-text">{p.label}</span>
                          {p.where !== p.label && <span className="block truncate text-[12px] text-text-3">{p.where}</span>}
                        </span>
                        <span className="hidden w-24 text-right text-[12px] text-text-2 sm:block">{n(p.people)} {p.people === 1 ? "person" : "people"}</span>
                        <span className="hidden w-20 text-right text-[12px] text-text-2 sm:block">{pct(p.phoneViews, p.views)}% phone</span>
                        <span className="w-14 text-right font-mono text-[14px] font-semibold tabular-nums text-text">{n(p.views)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul>
                  {data.people.map((p) => (
                    <li key={p.userId} className="flex min-h-12 items-center gap-3 border-t border-line px-4 py-2 first:border-t-0">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium text-text">{p.name}</span>
                        <span className="block truncate text-[12px] text-text-3">{n(p.pages)} pages · last {lastSeen(p.lastAt)}</span>
                      </span>
                      <span className="font-mono text-[14px] font-semibold tabular-nums text-text">{n(p.views)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="overflow-clip rounded-card border border-line bg-surface lg:self-start">
              <div className="px-4 pt-4 pb-3">
                <h2 className="text-[15px] font-semibold text-text">
                  {data.unopened.length ? `${n(data.unopened.length)} ${data.unopened.length === 1 ? "page" : "pages"} nobody opened` : "Every page was opened"}
                </h2>
                <p className="mt-0.5 text-[12px] text-text-3">
                  {data.unopened.length ? "Candidates to move, merge or remove from the menu" : "Each menu page had at least one view in these 30 days"}
                </p>
              </div>
              {data.unopened.length > 0 && (
                <ul className="max-h-[420px] overflow-y-auto border-t border-line">
                  {data.unopened.map((p) => (
                    <li key={p.page} className="border-t border-line first:border-t-0">
                      <Link href={p.page} className="flex min-h-11 items-center gap-3 px-4 hover:bg-raised">
                        <EyeOff className="size-4 shrink-0 text-text-3" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-text">{p.label}</span>
                        <span className="shrink-0 text-[12px] text-text-3">{p.where}</span>
                        <ChevronRight className="size-4 shrink-0 text-text-3" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
