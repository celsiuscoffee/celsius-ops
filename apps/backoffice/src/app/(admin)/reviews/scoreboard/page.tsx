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
  ahead: { label: "Ahead", bg: "var(--color-ok)", fg: "var(--color-on-ink)" },
  on_track: { label: "On track", bg: "var(--color-ok-soft)", fg: "var(--color-ok-text)" },
  behind: { label: "Behind", bg: "var(--color-danger)", fg: "var(--color-on-ink)" },
  no_competitor: { label: "Leader", bg: "var(--color-info)", fg: "var(--color-on-ink)" },
  no_data: { label: "No data yet", bg: "var(--color-sunken)", fg: "var(--color-text-3)" },
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
    <div className="mx-auto max-w-6xl px-4 pt-6 pb-10 md:px-8">
      <Link href="/reviews/geogrid" className="mb-3 inline-flex items-center gap-1 text-sm text-text-2 hover:text-text">
        <ArrowLeft className="h-4 w-4" /> Local rank
      </Link>
      <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Rank scoreboard</h1>
      <p className="mt-0.5 max-w-3xl text-sm text-text-2">
        Is each outlet getting enough new reviews a day to overtake the nearest competitor? When an outlet
        is behind, ask more happy customers to review (in-store QR and after an order).
      </p>

      {!placesConfigured && (
        <div className="mt-3 rounded-lg border border-warn/30 bg-warn-soft p-3 text-sm text-warn-text">
          Competitor gaps are inactive until <span className="font-mono">GOOGLE_PLACES_API_KEY</span> is set. Review velocity still tracks.
        </div>
      )}

      {loading ? (
        <div className="mt-8 flex items-center gap-2 text-text-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-text-2">
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
                  <tr key={r.outletId} className="border-b border-line last:border-0 align-top">
                    <td className="px-3 py-3">
                      <div className="font-medium text-text">{r.outletName}</div>
                      {r.asOf && <div className="text-xs text-text-2">as of {new Date(r.asOf).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}</div>}
                    </td>
                    <td className="px-3 py-3 text-text">
                      <div>{num(r.reviewCount)}</div>
                      {r.averageRating != null && (
                        <div className="flex items-center gap-0.5 text-xs text-text-2">
                          <Star className="h-3 w-3 fill-warn text-warn-text" /> {r.averageRating.toFixed(1)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-text">
                      {r.responseRate == null ? "n/a" : `${Math.round(r.responseRate * 100)}%`}
                    </td>
                    <td className="px-3 py-3 text-text">
                      <div className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3 text-text-2" /> {num(r.velocity7d)} <span className="text-xs text-text-2">7d</span>
                      </div>
                      <div className="text-xs text-text-2">{num(r.velocity30d)} 30d</div>
                    </td>
                    <td className="px-3 py-3 text-text">
                      {r.competitorName ? (
                        <>
                          <div className="max-w-[10rem] truncate" title={r.competitorName}>{r.competitorName}</div>
                          <div className="text-xs text-text-2">{num(r.competitorReviews)} reviews</div>
                        </>
                      ) : (
                        <span className="text-text-2">n/a</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-text">
                      {r.gap == null ? "n/a" : r.gap <= 0 ? <span className="text-ok-text">+{-r.gap}</span> : <span className="text-danger-text">-{r.gap}</span>}
                    </td>
                    <td className="px-3 py-3 font-medium text-text">{num(r.targetPerDay)}</td>
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
                  <td colSpan={8} className="px-3 py-8 text-center text-text-2">
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
