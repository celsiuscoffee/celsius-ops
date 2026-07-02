"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Loader2, Minus, Sparkles, TrendingUp } from "lucide-react";

type ProgressScan = { date: string; avgRank: number | null; pctTop3: number | null; greenRadiusM: number | null };
type Verdict = "improved" | "dropped" | "mixed" | "flat" | "first_scan";
type ProgressRow = {
  outletId: string;
  outletName: string;
  keyword: string;
  scans: ProgressScan[];
  latest: ProgressScan;
  prev: ProgressScan | null;
  avgRankDelta: number | null; // positive = climbed toward #1
  pctTop3Delta: number | null;
  greenRadiusDelta: number | null;
  verdict: Verdict;
};
type Summary = { improved: number; dropped: number; mixed: number; flat: number; firstScan: number; tracked: number };

const VERDICT_META: Record<Verdict, { label: string; cls: string }> = {
  improved: { label: "Improved", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  dropped: { label: "Dropped", cls: "border-red-200 bg-red-50 text-red-700" },
  mixed: { label: "Mixed", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  flat: { label: "No change", cls: "border-border bg-muted/40 text-muted-foreground" },
  first_scan: { label: "First scan", cls: "border-border bg-muted/40 text-muted-foreground" },
};

const fmtRank = (r: number | null) => (r == null ? ">20" : r.toFixed(1));
const fmtKm = (m: number | null) => (m == null ? "–" : `${(m / 1000).toFixed(2)} km`);
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString();

// Signed movement chip. The API normalizes every delta to positive = better,
// so direction is carried by text + arrow, with color as reinforcement only.
function Delta({ value, unit }: { value: number | null; unit: string }) {
  if (value == null) return <span className="text-[11px] text-muted-foreground">–</span>;
  if (value === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
        <Minus className="h-3 w-3" /> no change
      </span>
    );
  }
  const good = value > 0;
  const Icon = value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 whitespace-nowrap text-[11px] font-medium ${good ? "text-emerald-700" : "text-red-700"}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(value).toLocaleString()}
      {unit} {good ? "better" : "worse"}
    </span>
  );
}

// Rank history sparkline. Y is INVERTED (toward #1 = up), unranked plotted at
// the >20 floor. De-emphasis gray line, accent end-dot with a surface ring;
// each point carries a hover title with the scan date + rank.
function RankSparkline({ scans }: { scans: ProgressScan[] }) {
  const W = 120;
  const H = 32;
  const PAD = 5;
  const FLOOR = 21; // "not in top 20"
  const ranks = scans.map((s) => s.avgRank ?? FLOOR);
  const min = Math.min(...ranks);
  const max = Math.max(...ranks);
  const span = max - min || 1;
  const x = (i: number) => (scans.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (scans.length - 1));
  const y = (r: number) => PAD + ((r - min) / span) * (H - 2 * PAD); // low rank (good) → top
  const path = ranks.map((r, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(r).toFixed(1)}`).join(" ");
  const last = ranks.length - 1;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Average rank per scan, higher is closer to #1" className="shrink-0">
      {scans.length > 1 && <path d={path} fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
      {ranks.map((r, i) => (
        <circle key={i} cx={x(i)} cy={y(r)} r={i === last ? 4 : 6} fill={i === last ? "#166534" : "transparent"} stroke={i === last ? "#ffffff" : "none"} strokeWidth={i === last ? 2 : 0}>
          <title>{`${fmtDate(scans[i].date)} — avg rank ${fmtRank(scans[i].avgRank)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone ?? "text-foreground"}`}>{value}</p>
    </div>
  );
}

export default function GeogridProgressPage() {
  const [rows, setRows] = useState<ProgressRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [outletFilter, setOutletFilter] = useState("");
  const [keywordFilter, setKeywordFilter] = useState("");

  useEffect(() => {
    fetch("/api/geogrid/progress")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else {
          setRows(d.rows ?? []);
          setSummary(d.summary ?? null);
        }
      })
      .catch(() => setError("Network error"))
      .finally(() => setLoading(false));
  }, []);

  const outlets = useMemo(() => [...new Set(rows.map((r) => r.outletName))].sort(), [rows]);
  const keywords = useMemo(
    () => [...new Set(rows.filter((r) => !outletFilter || r.outletName === outletFilter).map((r) => r.keyword))].sort(),
    [rows, outletFilter],
  );
  const visible = rows.filter(
    (r) => (!outletFilter || r.outletName === outletFilter) && (!keywordFilter || r.keyword === keywordFilter),
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <Link href="/reviews/geogrid" className="mb-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Geogrid
      </Link>
      <h1 className="font-heading text-2xl font-bold text-foreground">Local Rank Progress</h1>
      <p className="text-sm text-muted-foreground">
        Movement after each scan, per keyword: did the rank climb toward #1, and did the top-3 radius grow?
      </p>

      {loading ? (
        <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading scan history…
        </p>
      ) : error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-xl border border-border bg-white p-10 text-center">
          <TrendingUp className="mx-auto h-10 w-10 text-muted-foreground/30" />
          <p className="mt-3 text-sm text-muted-foreground">
            No scans recorded yet. Progress appears here once the geogrid runs — each keyword needs two scans before movement can show.
          </p>
        </div>
      ) : (
        <>
          {/* The headline: what moved since each keyword's previous scan */}
          {summary && (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label="Improved" value={summary.improved} tone="text-emerald-700" />
              <Stat label="Dropped" value={summary.dropped} tone="text-red-700" />
              <Stat label="Mixed" value={summary.mixed} tone="text-amber-700" />
              <Stat label="No change" value={summary.flat} />
              <Stat label="Tracked keywords" value={summary.tracked} />
            </div>
          )}

          {/* Filters — one row above the table */}
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Outlet</label>
              <select
                value={outletFilter}
                onChange={(e) => {
                  setOutletFilter(e.target.value);
                  setKeywordFilter("");
                }}
                className="mt-1 rounded-lg border border-border bg-white px-3 py-2 text-sm"
              >
                <option value="">All outlets</option>
                {outlets.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Keyword</label>
              <select value={keywordFilter} onChange={(e) => setKeywordFilter(e.target.value)} className="mt-1 rounded-lg border border-border bg-white px-3 py-2 text-sm">
                <option value="">All keywords</option>
                {keywords.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Per-keyword movement — biggest movers first */}
          <div className="mt-4 rounded-xl border border-border bg-white p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-2">Keyword</th>
                  <th className="pr-2">Verdict</th>
                  <th className="pr-2">Avg rank</th>
                  <th className="pr-2">% top 3</th>
                  <th className="pr-2">Green radius</th>
                  <th className="pr-2">
                    Trend <span className="font-normal">(up = toward #1)</span>
                  </th>
                  <th>Last scan</th>
                </tr>
              </thead>
              <tbody className="[&_td]:align-middle">
                {visible.map((r) => {
                  const v = VERDICT_META[r.verdict];
                  return (
                    <tr key={`${r.outletId} ${r.keyword}`} className="border-t border-border">
                      <td className="py-2 pr-2">
                        <span className="font-medium text-foreground">{r.keyword}</span>
                        <span className="block text-[11px] text-muted-foreground">{r.outletName}</span>
                      </td>
                      <td className="pr-2">
                        <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${v.cls}`}>{v.label}</span>
                      </td>
                      <td className="pr-2 tabular-nums">
                        <span className="font-medium text-foreground">{fmtRank(r.latest.avgRank)}</span>
                        <span className="block">
                          <Delta value={r.avgRankDelta} unit="" />
                        </span>
                      </td>
                      <td className="pr-2 tabular-nums">
                        <span className="font-medium text-foreground">{Math.round(r.latest.pctTop3 ?? 0)}%</span>
                        <span className="block">
                          <Delta value={r.pctTop3Delta} unit="pp" />
                        </span>
                      </td>
                      <td className="pr-2 tabular-nums">
                        <span className="font-medium text-foreground">{fmtKm(r.latest.greenRadiusM)}</span>
                        <span className="block">
                          <Delta value={r.greenRadiusDelta} unit="m" />
                        </span>
                      </td>
                      <td className="pr-2">
                        <RankSparkline scans={r.scans} />
                      </td>
                      <td className="whitespace-nowrap text-xs text-muted-foreground">
                        {fmtDate(r.latest.date)}
                        <span className="block">{r.scans.length} scan{r.scans.length === 1 ? "" : "s"}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
              Deltas compare each keyword&apos;s latest scan to its previous one; moves under the noise floor (±0.2 rank, ±2pp, ±50m)
              count as no change. Hover a trend point for that scan&apos;s date and rank. Sorted by biggest movement first.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
