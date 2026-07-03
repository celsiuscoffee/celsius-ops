"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, Crown, Loader2, Search, Sparkles, Target, TrendingDown, TrendingUp, Minus } from "lucide-react";

type Bucket = "own" | "focus" | "prominence" | "retire";
type Trend = "improving" | "flat" | "declining" | "unknown";
type Verdict = {
  keyword: string;
  demand: number;
  avgRank: number | null;
  pctTop3: number | null;
  coveragePct: number;
  bucket: Bucket;
  trend: Trend;
  priority: number;
  action: string;
  autoRetire: boolean;
};
type OutletStrategy = {
  outletId: string;
  outletName: string;
  keywords: Verdict[];
  counts: Record<Bucket, number>;
};
type Report = {
  windowScans: number;
  outlets: OutletStrategy[];
  summary: Record<Bucket, number> & { tracked: number; autoRetire: number };
};

const BUCKET_META: Record<Bucket, { label: string; cls: string; icon: React.ReactNode; hint: string }> = {
  own: {
    label: "Owned",
    cls: "border-emerald-200 bg-emerald-50 text-emerald-700",
    icon: <Crown className="h-3.5 w-3.5" />,
    hint: "Top-3 across the catchment — stop paying for it, defend with reviews",
  },
  focus: {
    label: "Focus",
    cls: "border-blue-200 bg-blue-50 text-blue-700",
    icon: <Target className="h-3.5 w-3.5" />,
    hint: "Winnable (#4–10) — where the relevance levers + reviews pay off",
  },
  prominence: {
    label: "Prominence-bound",
    cls: "border-amber-200 bg-amber-50 text-amber-700",
    icon: <Sparkles className="h-3.5 w-3.5" />,
    hint: "Appears everywhere but low — needs review velocity, not profile edits",
  },
  retire: {
    label: "Retire",
    cls: "border-border bg-muted/40 text-muted-foreground",
    icon: <Ban className="h-3.5 w-3.5" />,
    hint: "Not ranking anywhere — drop it (no demand) or wait for presence + reviews",
  },
};

const TREND_ICON: Record<Trend, React.ReactNode> = {
  improving: <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />,
  declining: <TrendingDown className="h-3.5 w-3.5 text-red-500" />,
  flat: <Minus className="h-3.5 w-3.5 text-muted-foreground" />,
  unknown: <Minus className="h-3.5 w-3.5 text-muted-foreground/40" />,
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone ?? "text-foreground"}`}>{value}</p>
    </div>
  );
}

export default function KeywordStrategyPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const load = () => {
    setLoading(true);
    fetch("/api/geogrid/keyword-strategy")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setReport(d)))
      .catch(() => setError("Network error"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const outlets = report?.outlets ?? [];
  const summary = report?.summary;

  const toggle = async (outletId: string, v: Verdict, action: "retire" | "reactivate") => {
    const key = `${outletId} ${v.keyword}`;
    if (
      action === "retire" &&
      !window.confirm(
        `Stop tracking "${v.keyword}" for this outlet?\n\nThe geogrid will no longer scan it (saves scan budget). You can reactivate it any time.`,
      )
    ) {
      return;
    }
    setBusy(key);
    setRowError((p) => ({ ...p, [key]: "" }));
    try {
      const res = await fetch("/api/geogrid/keyword-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outletId, keyword: v.keyword, action }),
      });
      const d = await res.json();
      if (!res.ok) setRowError((p) => ({ ...p, [key]: d.error || "Failed" }));
      else load();
    } catch {
      setRowError((p) => ({ ...p, [key]: "Network error" }));
    } finally {
      setBusy(null);
    }
  };

  const autoRetireCount = summary?.autoRetire ?? 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <Link href="/reviews/geogrid" className="mb-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Geogrid
      </Link>
      <h1 className="font-heading text-2xl font-bold text-foreground">Keyword Strategy</h1>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Seeding picks target keywords by ad demand; this tunes that set by what the scans have since measured. Each tracked
        term is bucketed by where the ROI is — <b>own</b> (stop paying), <b>focus</b> (winnable, push relevance + reviews),
        <b> prominence-bound</b> (needs reviews, not edits), or <b>retire</b> — sorted by opportunity so effort lands where it
        pays.
      </p>

      {loading ? (
        <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading keyword strategy…
        </p>
      ) : error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>
      ) : !report || outlets.length === 0 ? (
        <div className="mt-6 rounded-xl border border-border bg-white p-10 text-center">
          <Search className="mx-auto h-10 w-10 text-muted-foreground/30" />
          <p className="mt-3 text-sm text-muted-foreground">
            No scan data yet. The strategy needs at least one geogrid scan per keyword — it fills in as the weekly scan runs.
          </p>
        </div>
      ) : (
        <>
          {summary && (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label="Tracked" value={String(summary.tracked)} />
              <Stat label="Owned" value={String(summary.own)} tone="text-emerald-700" />
              <Stat label="Focus (winnable)" value={String(summary.focus)} tone="text-blue-700" />
              <Stat label="Prominence-bound" value={String(summary.prominence)} tone="text-amber-700" />
              <Stat label="Retire" value={String(summary.retire)} />
            </div>
          )}

          {autoRetireCount > 0 && (
            <div className="mt-4 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              {autoRetireCount} keyword{autoRetireCount === 1 ? "" : "s"} with no demand and no ranking anywhere — safe to
              retire and reclaim scan budget (marked below).
            </div>
          )}

          <div className="mt-5 space-y-6">
            {outlets.map((o) => (
              <div key={o.outletId} className="rounded-xl border border-border bg-white p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h2 className="font-heading text-lg font-semibold text-foreground">{o.outletName}</h2>
                  <span className="text-xs text-muted-foreground">
                    {o.counts.own} owned · {o.counts.focus} focus · {o.counts.prominence} prominence · {o.counts.retire} retire
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1 pr-2">Keyword</th>
                      <th className="pr-2">Rank</th>
                      <th className="pr-2">Grid</th>
                      <th className="pr-2">Bucket</th>
                      <th className="pr-2">Next action</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody className="[&_td]:align-top">
                    {o.keywords.map((v) => {
                      const key = `${o.outletId} ${v.keyword}`;
                      const b = BUCKET_META[v.bucket];
                      return (
                        <tr key={key} className="border-t border-border">
                          <td className="py-2 pr-2">
                            <span className="inline-flex items-center gap-1 font-medium text-foreground">
                              {TREND_ICON[v.trend]} {v.keyword}
                            </span>
                            <span className="block text-[11px] text-muted-foreground">
                              {v.demand > 0 ? `${v.demand.toLocaleString()} ad clicks/mo demand` : "no ad demand"}
                            </span>
                          </td>
                          <td className="pr-2 tabular-nums">
                            {v.avgRank != null ? (
                              <>
                                <span className="font-medium text-foreground">#{v.avgRank.toFixed(1)}</span>
                                {v.pctTop3 != null && <span className="block text-[11px] text-muted-foreground">{Math.round(v.pctTop3)}% top-3</span>}
                              </>
                            ) : (
                              <span className="text-xs text-muted-foreground">unranked</span>
                            )}
                          </td>
                          <td className="pr-2 tabular-nums text-muted-foreground">{v.coveragePct}%</td>
                          <td className="pr-2">
                            <span title={b.hint} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${b.cls}`}>
                              {b.icon} {b.label}
                            </span>
                          </td>
                          <td className="max-w-md pr-2 text-[13px] text-muted-foreground">{v.action}</td>
                          <td className="whitespace-nowrap">
                            {v.bucket === "retire" ? (
                              <button
                                onClick={() => toggle(o.outletId, v, "retire")}
                                disabled={busy === key}
                                className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted/50 disabled:opacity-50"
                              >
                                {busy === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                                Stop tracking
                              </button>
                            ) : null}
                            {rowError[key] && <span className="block text-[11px] text-red-600">{rowError[key]}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <p className="mt-4 text-[11px] text-muted-foreground">
            Buckets from the latest scan per keyword (window {report.windowScans} scans for the trend arrow). &ldquo;Owned&rdquo; =
            avg rank ≤3 with ≥70% of grid points in the top 3 — the same test the Paid × Organic page uses to flag ad spend you
            can cut. Retiring a keyword only stops the scan from tracking it; it never touches Google Ads or your profile.
          </p>
        </>
      )}
    </div>
  );
}
