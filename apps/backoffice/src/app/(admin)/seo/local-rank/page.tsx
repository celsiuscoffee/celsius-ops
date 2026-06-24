"use client";

import { useState, type ReactNode } from "react";
import { MapPin, Target, Layers, TrendingUp, Loader2, Info } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

// ─── Types ─────────────────────────────────────────────────

type Outlet = { id: string; name: string };
type Keyword = { text: string; kind: string };
type Cell = { row: number; col: number; lat: number; lng: number; rank: number | null };
type Snapshot = {
  keyword: string;
  keywordKind: string;
  gridSize: number;
  spacingKm: number;
  cells: Cell[];
  atrp: number;
  solv: number;
  oneReachKm: number;
  foundCells: number;
  totalCells: number;
  capturedAt: string;
};
type HistoryPoint = { capturedAt: string; atrp: number; solv: number; oneReachKm: number };
type Goal = { innerTop3Pct: number; solvTarget: number; oneReachTargetKm: number };
type GeogridData = {
  outlets: Outlet[];
  keywords: Keyword[];
  selectedKeyword?: string;
  latest: Snapshot | null;
  history: HistoryPoint[];
  goal: Goal | null;
};

// Inner 3×3 (the doorstep) — % of those cells that are top-3. The "floor" goal.
function innerTop3Pct(cells: Cell[], size: number): number {
  const c = (size - 1) / 2;
  const inner = cells.filter((x) => Math.abs(x.row - c) <= 1 && Math.abs(x.col - c) <= 1);
  if (inner.length === 0) return 0;
  const top3 = inner.filter((x) => x.rank != null && x.rank <= 3).length;
  return (top3 / inner.length) * 100;
}

// ─── Rank → colour (mirrors the geogrid heatmap) ───────────

function rankColor(rank: number | null): string {
  if (rank == null) return "#7f1d1d"; // not in top 20 — darkest red
  if (rank === 1) return "#166534"; // dark green
  if (rank <= 3) return "#22c55e"; // green
  if (rank <= 6) return "#84cc16"; // lime
  if (rank <= 10) return "#eab308"; // yellow
  if (rank <= 15) return "#f97316"; // orange
  return "#ef4444"; // red
}

function rankLabel(rank: number | null): string {
  if (rank == null) return "–";
  if (rank >= 21) return "20+";
  return String(rank);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short" });
}

// ─── Metric card with WoW delta ────────────────────────────

function MetricCard({
  icon,
  label,
  value,
  unit,
  delta,
  goodWhenUp,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  unit?: string;
  delta?: number | null;
  goodWhenUp: boolean;
  hint: string;
}) {
  const improved = delta != null && delta !== 0 && (goodWhenUp ? delta > 0 : delta < 0);
  const worsened = delta != null && delta !== 0 && (goodWhenUp ? delta < 0 : delta > 0);
  const deltaColor = improved ? "text-green-600" : worsened ? "text-red-600" : "text-gray-400";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 text-gray-500">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-semibold text-gray-900">{value}</span>
        {unit && <span className="text-sm text-gray-400">{unit}</span>}
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {delta != null && (
          <span className={deltaColor}>
            {delta > 0 ? "▲" : delta < 0 ? "▼" : "—"} {Math.abs(delta).toFixed(2)} vs last
          </span>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-gray-400">{hint}</p>
    </div>
  );
}

// ─── Goal progress (floor / committed / stretch) ───────────

function GoalRow({
  tier,
  label,
  current,
  target,
  unit,
  met,
}: {
  tier: string;
  label: string;
  current: number;
  target: number;
  unit: string;
  met: boolean;
}) {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-gray-700">
          <span className="mr-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-500">
            {tier}
          </span>
          {label}
        </span>
        <span className={met ? "text-green-600" : "text-gray-500"}>
          {met ? "✓ " : ""}
          {current.toFixed(unit === "km" ? 2 : 0)} / {target.toFixed(unit === "km" ? 1 : 0)} {unit}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full rounded-full ${met ? "bg-green-500" : "bg-gray-400"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────

export default function LocalRankPage() {
  // Honour ?outletId= from the dashboard drill-down link.
  const initialOutlet = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("outletId") : null;
  const [outletId, setOutletId] = useState<string | null>(initialOutlet);
  const [keyword, setKeyword] = useState<string | null>(null);

  const qs = new URLSearchParams();
  if (outletId) qs.set("outletId", outletId);
  if (keyword) qs.set("keyword", keyword);
  const { data, isLoading } = useFetch<GeogridData>(`/api/seo/geogrid?${qs.toString()}`);

  const outlets = data?.outlets ?? [];
  const keywords = data?.keywords ?? [];
  const latest = data?.latest ?? null;
  const history = data?.history ?? [];
  const prev = history.length >= 2 ? history[history.length - 2] : null;

  const goal = data?.goal ?? null;
  const grid = latest?.cells ?? [];
  const size = latest?.gridSize ?? 0;
  const floorPct = latest ? innerTop3Pct(grid, size) : 0;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-1 flex items-center gap-2">
        <MapPin className="h-5 w-5 text-gray-700" />
        <h1 className="text-xl font-semibold text-gray-900">Local Rank (Geogrid)</h1>
      </div>
      <p className="mb-5 text-sm text-gray-500">
        Where each outlet ranks in the Google map pack, point by point. The objective is to grow the
        green (#1) zone outward — track <strong>#1-reach</strong> week over week.
      </p>

      {/* Outlet selector */}
      <div className="mb-3 flex flex-wrap gap-2">
        {outlets.map((o) => {
          const active = (outletId ?? outlets[0]?.id) === o.id;
          return (
            <button
              key={o.id}
              onClick={() => {
                setOutletId(o.id);
                setKeyword(null); // reset keyword when switching outlet
              }}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                active ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {o.name}
            </button>
          );
        })}
      </div>

      {/* Keyword selector */}
      {keywords.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {keywords.map((k) => {
            const active = (keyword ?? data?.selectedKeyword) === k.text;
            return (
              <button
                key={k.text}
                onClick={() => setKeyword(k.text)}
                className={`rounded-md border px-2.5 py-1 text-xs transition ${
                  active
                    ? "border-gray-900 bg-gray-900 text-white"
                    : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                }`}
                title={k.kind === "generic" ? "near-me term (radius game)" : "locale term (relevance)"}
              >
                {k.text}
                {k.kind === "locale" && <span className="ml-1 opacity-50">◦</span>}
              </button>
            );
          })}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 py-16 text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}

      {/* Empty state — no snapshots yet */}
      {!isLoading && !latest && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
          <Info className="mx-auto mb-2 h-6 w-6 text-gray-400" />
          <p className="text-sm font-medium text-gray-700">No geogrid yet for this outlet.</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-gray-500">
            Set <code className="rounded bg-gray-200 px-1">GOOGLE_PLACES_API_KEY</code> and run the sweep
            (<code className="rounded bg-gray-200 px-1">/api/cron/geogrid-sweep</code>, weekly Mon 02:00, or
            trigger manually with the cron bearer). The first sweep fills this in.
          </p>
        </div>
      )}

      {!isLoading && latest && (
        <>
          {/* Metrics */}
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetricCard
              icon={<Target className="h-4 w-4" />}
              label="#1-reach"
              value={latest.oneReachKm.toFixed(2)}
              unit="km"
              delta={prev ? latest.oneReachKm - prev.oneReachKm : null}
              goodWhenUp
              hint="Radius of the largest ring where the median rank is #1. The objective — grow this."
            />
            <MetricCard
              icon={<Layers className="h-4 w-4" />}
              label="Share of Voice"
              value={latest.solv.toFixed(0)}
              unit="% top-3"
              delta={prev ? latest.solv - prev.solv : null}
              goodWhenUp
              hint="% of grid cells where we land in the top 3. How much of the map we own."
            />
            <MetricCard
              icon={<TrendingUp className="h-4 w-4" />}
              label="Avg rank (ATRP)"
              value={latest.atrp.toFixed(1)}
              delta={prev ? latest.atrp - prev.atrp : null}
              goodWhenUp={false}
              hint="Average rank across every cell (lower is better). Not-in-top-20 counts as 21."
            />
          </div>

          {/* Progress to goal */}
          {goal && (
            <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-1 flex items-center gap-2 text-gray-700">
                <Target className="h-4 w-4" />
                <span className="text-sm font-medium">Progress to goal</span>
                <span className="text-[11px] text-gray-400">(targets calibrate after baseline — see geogrid-goals.ts)</span>
              </div>
              <GoalRow tier="Floor" label="Doorstep top-3 (inner 3×3)" current={floorPct} target={goal.innerTop3Pct} unit="%" met={floorPct >= goal.innerTop3Pct} />
              <GoalRow tier="Committed" label="Share of Voice (top-3 coverage)" current={latest.solv} target={goal.solvTarget} unit="%" met={latest.solv >= goal.solvTarget} />
              <GoalRow tier="Stretch" label="#1-reach" current={latest.oneReachKm} target={goal.oneReachTargetKm} unit="km" met={latest.oneReachKm >= goal.oneReachTargetKm} />
            </div>
          )}

          {/* Heatmap grid */}
          <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                {size}×{size} grid · {latest.spacingKm} km spacing · captured {fmtDate(latest.capturedAt)}
              </span>
              <span className="text-xs text-gray-400">
                {latest.foundCells}/{latest.totalCells} cells in top 20
              </span>
            </div>
            <div
              className="mx-auto grid w-fit gap-1"
              style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
            >
              {[...grid]
                .sort((a, b) => a.row - b.row || a.col - b.col)
                .map((cell) => {
                  const isCenter = cell.row === (size - 1) / 2 && cell.col === (size - 1) / 2;
                  return (
                    <div
                      key={`${cell.row}-${cell.col}`}
                      className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white ${
                        isCenter ? "ring-2 ring-gray-900 ring-offset-1" : ""
                      }`}
                      style={{ backgroundColor: rankColor(cell.rank) }}
                      title={`(${cell.row},${cell.col}) — rank ${rankLabel(cell.rank)}`}
                    >
                      {rankLabel(cell.rank)}
                    </div>
                  );
                })}
            </div>
            <p className="mt-3 text-center text-[11px] text-gray-400">
              Centre ring = the outlet. Dark green = #1. The further out the green reaches, the wider your #1
              radius.
            </p>
          </div>

          {/* #1-reach trend */}
          {history.length > 1 && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <span className="text-sm font-medium text-gray-700">#1-reach trend (km)</span>
              <div className="mt-3 flex items-end gap-2" style={{ height: 80 }}>
                {(() => {
                  const max = Math.max(...history.map((h) => h.oneReachKm), 0.5);
                  return history.map((h, i) => (
                    <div key={i} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t bg-green-500"
                        style={{ height: `${(h.oneReachKm / max) * 64 + 2}px` }}
                        title={`${h.oneReachKm.toFixed(2)} km`}
                      />
                      <span className="text-[10px] text-gray-400">{fmtDate(h.capturedAt)}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
