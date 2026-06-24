"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ArrowLeft, Star, TrendingUp } from "lucide-react";

type ScoreStatus = "ahead" | "on_track" | "behind" | "no_competitor" | "no_data";
type ScoreRow = {
  outletId: string;
  outletName: string;
  asOf: string | null;
  reviewCount: number | null;
  averageRating: number | null;
  responseRate: number | null;
  velocity7d: number | null;
  velocity30d: number | null;
  competitorName: string | null;
  competitorReviews: number | null;
  gap: number | null;
  targetPerDay: number | null;
  status: ScoreStatus;
};

const STATUS: Record<ScoreStatus, { label: string; bg: string; fg: string }> = {
  ahead: { label: "Ahead", bg: "#15803d", fg: "#fff" },
  on_track: { label: "On track", bg: "#65a30d", fg: "#fff" },
  behind: { label: "Behind", bg: "#dc2626", fg: "#fff" },
  no_competitor: { label: "Leader", bg: "#0891b2", fg: "#fff" },
  no_data: { label: "No data yet", bg: "#9ca3af", fg: "#fff" },
};

const num = (n: number | null, suffix = "") => (n == null ? "n/a" : `${n}${suffix}`);

export default function ScoreboardPage() {
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [placesConfigured, setPlacesConfigured] = useState(true);

  useEffect(() => {
    fetch("/api/reviews/scoreboard")
      .then((r) => r.json())
      .then((d) => {
        setRows(d.rows ?? []);
        setPlacesConfigured(d.placesConfigured ?? true);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <Link href="/reviews/geogrid" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Local Rank Geogrid
      </Link>
      <h1 className="font-heading text-2xl font-bold text-foreground">Daily Rank Scoreboard</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        The daily lever: reviews acquired per day vs the rate needed to out-review the nearest prominent
        competitor. Reviews are the only local-rank input that moves daily. The geogrid confirms the rings
        weekly. Action when an outlet is behind: ask more happy customers to review (in-store QR plus post-order).
      </p>

      {!placesConfigured && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Competitor gaps are inactive until <span className="font-mono">GOOGLE_PLACES_API_KEY</span> is set. Review velocity still tracks.
        </div>
      )}

      {loading ? (
        <div className="mt-8 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Outlet</th>
                <th className="px-3 py-2 font-medium">Reviews</th>
                <th className="px-3 py-2 font-medium">Response</th>
                <th className="px-3 py-2 font-medium">Velocity /day</th>
                <th className="px-3 py-2 font-medium">Chasing</th>
                <th className="px-3 py-2 font-medium">Gap</th>
                <th className="px-3 py-2 font-medium">Need /day</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = STATUS[r.status];
                return (
                  <tr key={r.outletId} className="border-b border-border last:border-0 align-top">
                    <td className="px-3 py-3">
                      <div className="font-medium text-foreground">{r.outletName}</div>
                      {r.asOf && <div className="text-xs text-muted-foreground">as of {r.asOf}</div>}
                    </td>
                    <td className="px-3 py-3 text-foreground">
                      <div>{num(r.reviewCount)}</div>
                      {r.averageRating != null && (
                        <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {r.averageRating.toFixed(1)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-foreground">
                      {r.responseRate == null ? "n/a" : `${Math.round(r.responseRate * 100)}%`}
                    </td>
                    <td className="px-3 py-3 text-foreground">
                      <div className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3 text-muted-foreground" /> {num(r.velocity7d)} <span className="text-xs text-muted-foreground">7d</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{num(r.velocity30d)} 30d</div>
                    </td>
                    <td className="px-3 py-3 text-foreground">
                      {r.competitorName ? (
                        <>
                          <div className="max-w-[10rem] truncate" title={r.competitorName}>{r.competitorName}</div>
                          <div className="text-xs text-muted-foreground">{num(r.competitorReviews)} reviews</div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">n/a</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-foreground">
                      {r.gap == null ? "n/a" : r.gap <= 0 ? <span className="text-emerald-600">+{-r.gap}</span> : <span className="text-red-600">-{r.gap}</span>}
                    </td>
                    <td className="px-3 py-3 font-medium text-foreground">{num(r.targetPerDay)}</td>
                    <td className="px-3 py-3">
                      <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: st.bg, color: st.fg }}>
                        {st.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                    No snapshots yet. The first one runs on the daily cron.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
