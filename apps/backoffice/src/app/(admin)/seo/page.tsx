"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { Target, Layers, TrendingUp, MapPin, Loader2, Info, ChevronRight } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type Goal = { innerTop3Pct: number; solvTarget: number; oneReachTargetKm: number };
type Row = {
  outletId: string;
  name: string;
  hasData: boolean;
  keywordCount?: number;
  sweptAt?: string;
  oneReachKm?: number;
  solv?: number;
  atrp?: number;
  oneReachDelta?: number | null;
  solvDelta?: number | null;
  goal: Goal;
  metCommitted?: boolean;
  metStretch?: boolean;
};
type Summary = { outlets: number; withData: number; metCommitted: number; metStretch: number };
type DashboardData = { rows: Row[]; summary: Summary };

function fmtDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short" });
}

function Delta({ value, goodWhenUp = true }: { value?: number | null; goodWhenUp?: boolean }) {
  if (value == null || value === 0) return <span className="text-gray-300">—</span>;
  const improved = goodWhenUp ? value > 0 : value < 0;
  return (
    <span className={improved ? "text-green-600" : "text-red-600"}>
      {value > 0 ? "▲" : "▼"} {Math.abs(value).toFixed(2)}
    </span>
  );
}

function GoalPill({ met, label }: { met?: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        met ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
      }`}
    >
      {met ? "✓ " : ""}
      {label}
    </span>
  );
}

function SummaryCard({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 text-gray-500">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-gray-900">{value}</div>
      <p className="mt-1 text-[11px] text-gray-400">{sub}</p>
    </div>
  );
}

export default function SeoDashboardPage() {
  const { data, isLoading } = useFetch<DashboardData>("/api/seo/dashboard");
  const rows = data?.rows ?? [];
  const summary = data?.summary;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-1 flex items-center gap-2">
        <Target className="h-5 w-5 text-gray-700" />
        <h1 className="text-xl font-semibold text-gray-900">Local SEO Dashboard</h1>
      </div>
      <p className="mb-5 text-sm text-gray-500">
        Map-pack rank across all outlets at a glance. The loop&apos;s goal: grow each outlet&apos;s{" "}
        <strong>#1-reach</strong> and top-3 coverage. Click an outlet for its geogrid.
      </p>

      {isLoading && (
        <div className="flex items-center gap-2 py-16 text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}

      {!isLoading && summary && (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryCard
            icon={<MapPin className="h-4 w-4" />}
            label="Outlets tracked"
            value={`${summary.withData}/${summary.outlets}`}
            sub="have geogrid data"
          />
          <SummaryCard
            icon={<Layers className="h-4 w-4" />}
            label="Meeting coverage goal"
            value={`${summary.metCommitted}/${summary.withData}`}
            sub="SoLV ≥ target (the committed goal)"
          />
          <SummaryCard
            icon={<Target className="h-4 w-4" />}
            label="Meeting #1-reach goal"
            value={`${summary.metStretch}/${summary.withData}`}
            sub="#1-reach ≥ target (the stretch goal)"
          />
        </div>
      )}

      {!isLoading && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
          <Info className="mx-auto mb-2 h-6 w-6 text-gray-400" />
          <p className="text-sm font-medium text-gray-700">No active outlets.</p>
        </div>
      )}

      {/* Per-outlet rows */}
      <div className="space-y-3">
        {rows.map((r) => (
          <Link
            key={r.outletId}
            href={`/seo/local-rank?outletId=${r.outletId}`}
            className="block rounded-xl border border-gray-200 bg-white p-4 transition hover:border-gray-300 hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">{r.name}</span>
                {r.hasData ? (
                  <>
                    <GoalPill met={r.metCommitted} label="coverage" />
                    <GoalPill met={r.metStretch} label="#1-reach" />
                  </>
                ) : (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-400">no data yet</span>
                )}
              </div>
              <ChevronRight className="h-4 w-4 text-gray-300" />
            </div>

            {r.hasData ? (
              <div className="mt-3 grid grid-cols-3 gap-4">
                <div>
                  <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-gray-400">
                    <Target className="h-3 w-3" /> #1-reach
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-2">
                    <span className="text-lg font-semibold text-gray-900">{r.oneReachKm?.toFixed(2)}</span>
                    <span className="text-xs text-gray-400">/ {r.goal.oneReachTargetKm} km</span>
                    <Delta value={r.oneReachDelta} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-gray-400">
                    <Layers className="h-3 w-3" /> Share of Voice
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-2">
                    <span className="text-lg font-semibold text-gray-900">{r.solv?.toFixed(0)}%</span>
                    <span className="text-xs text-gray-400">/ {r.goal.solvTarget}%</span>
                    <Delta value={r.solvDelta} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-gray-400">
                    <TrendingUp className="h-3 w-3" /> Avg rank
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-2">
                    <span className="text-lg font-semibold text-gray-900">{r.atrp?.toFixed(1)}</span>
                    <span className="text-xs text-gray-400">· {r.keywordCount} kw · {fmtDate(r.sweptAt)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-gray-400">Run the geogrid sweep to populate this outlet.</p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
