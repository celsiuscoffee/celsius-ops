"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Trophy,
  Phone,
  TrendingUp,
  ClipboardCheck,
  Trash2,
  Clock,
  RefreshCw,
  Loader2,
  Store,
  Target,
  CheckCircle2,
  XCircle,
  MinusCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLatestRequest } from "@/lib/use-latest-request";

// ---------------------------------------------------------------------------
// Types — mirror /api/scorecard
// ---------------------------------------------------------------------------

type KpiStatus = "hit" | "miss" | "nodata";
type Period = "daily" | "yesterday" | "last7days" | "last30days" | "weekly" | "monthly";

type Kpi = { value: number | null; target?: number; status: KpiStatus };

type OutletRow = {
  id: string;
  code: string;
  name: string;
  onPos: boolean;
  revenue: number;
  met: number;
  measurable: number;
  score: number | null;
  kpis: {
    collection: Kpi & { orders: number; collected: number };
    upsell: Kpi & { orders: number; upsellOrders: number };
    ops: Kpi & { completed: number; total: number; photoRate: number | null };
    wastage: Kpi & { cost: number };
    serving: Kpi & { orders: number };
  };
};

type Scorecard = {
  period: { from: string; to: string; type: string; label: string };
  generatedAt: string;
  targets: {
    collectionRate: number;
    upsellRate: number;
    opsCompletion: number;
    wastagePctOfSales: number;
    servingMins: number;
  };
  summary: {
    totalOutlets: number;
    measuredOutlets: number;
    hittingAll: number;
    totalRevenue: number;
    avg: {
      collection: number | null;
      upsell: number | null;
      ops: number | null;
      wastagePct: number | null;
      servingMins: number | null;
    };
  };
  outlets: OutletRow[];
};

// ---------------------------------------------------------------------------
// KPI column metadata
// ---------------------------------------------------------------------------

type KpiKey = "collection" | "upsell" | "ops" | "wastage" | "serving";

const KPI_META: Record<
  KpiKey,
  { label: string; short: string; icon: React.ElementType; unit: "pct" | "mins"; lowerBetter: boolean }
> = {
  collection: { label: "Loyalty capture", short: "Capture", icon: Phone, unit: "pct", lowerBetter: false },
  upsell: { label: "Upsell", short: "Upsell", icon: TrendingUp, unit: "pct", lowerBetter: false },
  ops: { label: "Ops compliance", short: "Ops", icon: ClipboardCheck, unit: "pct", lowerBetter: false },
  wastage: { label: "Wastage", short: "Wastage", icon: Trash2, unit: "pct", lowerBetter: true },
  serving: { label: "Serving time", short: "Serving", icon: Clock, unit: "mins", lowerBetter: true },
};

const PERIODS: { value: Period; label: string }[] = [
  { value: "daily", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7days", label: "Last 7 Days" },
  { value: "last30days", label: "Last 30 Days" },
  { value: "monthly", label: "This Month" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${v}%`;
}
function fmtMins(v: number | null): string {
  return v === null ? "—" : `${v}m`;
}
function fmtUnit(v: number | null, unit: "pct" | "mins"): string {
  return unit === "mins" ? fmtMins(v) : fmtPct(v);
}
function fmtRM(v: number): string {
  return `RM ${v.toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const STATUS_STYLE: Record<KpiStatus, { pill: string; text: string; Icon: React.ElementType }> = {
  hit: { pill: "bg-emerald-50 border-emerald-200", text: "text-emerald-700", Icon: CheckCircle2 },
  miss: { pill: "bg-red-50 border-red-200", text: "text-red-700", Icon: XCircle },
  nodata: { pill: "bg-gray-50 border-gray-200", text: "text-gray-400", Icon: MinusCircle },
};

// ---------------------------------------------------------------------------
// Small components
// ---------------------------------------------------------------------------

function SummaryTile({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good";
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn("h-4 w-4", tone === "good" ? "text-emerald-500" : "text-gray-400")} />
        <span className="text-xs font-medium text-gray-500">{label}</span>
      </div>
      <div className={cn("text-2xl font-bold", tone === "good" ? "text-emerald-600" : "text-gray-900")}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-gray-400">{sub}</div>}
    </div>
  );
}

function KpiCell({ kpiKey, kpi }: { kpiKey: KpiKey; kpi: Kpi }) {
  const meta = KPI_META[kpiKey];
  const style = STATUS_STYLE[kpi.status];
  const valueText = fmtUnit(kpi.value, meta.unit);
  const targetUnit = meta.unit === "mins" ? "m" : "%";
  return (
    <div className={cn("rounded-lg border px-2.5 py-2", style.pill)}>
      <div className="flex items-center justify-between gap-1">
        <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
          <meta.icon className="h-3 w-3" />
          {meta.short}
        </span>
        <style.Icon className={cn("h-3.5 w-3.5", style.text)} />
      </div>
      <div className={cn("mt-1 text-base font-bold leading-none", style.text)}>{valueText}</div>
      <div className="mt-1 text-[10px] text-gray-400">
        {kpi.status === "nodata"
          ? "no data"
          : `target ${meta.lowerBetter ? "≤" : "≥"} ${kpi.target}${targetUnit}`}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AreaScorecardPage() {
  const [period, setPeriod] = useState<Period>("last7days");
  const [data, setData] = useState<Scorecard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const beginRequest = useLatestRequest();
  const load = useCallback(async (p: Period) => {
    const { signal, isCurrent } = beginRequest();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/scorecard?period=${p}`, { credentials: "include", signal });
      if (!isCurrent()) return;
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json);
    } catch (e) {
      if (!isCurrent()) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [beginRequest]);

  useEffect(() => {
    load(period);
  }, [period, load]);

  const s = data?.summary;

  return (
    <div className="p-4 sm:p-6 lg:p-8 overflow-x-hidden">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-xl sm:text-2xl font-bold text-foreground">Area Scorecard</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Which outlets are hitting KPI — live from the POS &amp; apps
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => load(period)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      {/* Loading */}
      {loading && !data && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      )}

      {data && s && (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryTile
              icon={Trophy}
              label="Hitting every KPI"
              value={`${s.hittingAll} / ${s.measuredOutlets}`}
              sub="outlets at 100%"
              tone={s.hittingAll > 0 ? "good" : "default"}
            />
            <SummaryTile icon={Phone} label="Avg loyalty capture" value={fmtPct(s.avg.collection)} sub={`target ${data.targets.collectionRate}%`} />
            <SummaryTile icon={TrendingUp} label="Avg upsell" value={fmtPct(s.avg.upsell)} sub={`target ${data.targets.upsellRate}%`} />
            <SummaryTile icon={ClipboardCheck} label="Avg ops compliance" value={fmtPct(s.avg.ops)} sub={`target ${data.targets.opsCompletion}%`} />
          </div>

          {/* Period note */}
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
            <Target className="h-3.5 w-3.5" />
            <span>
              {data.period.label} ({data.period.from} → {data.period.to}) · {s.totalOutlets} outlets ·{" "}
              {fmtRM(s.totalRevenue)} POS sales
            </span>
          </div>

          {/* Outlet ranking */}
          <div className="mt-4 space-y-3">
            {data.outlets.map((o, i) => {
              const allHit = o.measurable > 0 && o.met === o.measurable;
              return (
                <div
                  key={o.id}
                  className={cn(
                    "rounded-xl border bg-white p-4 shadow-sm",
                    allHit ? "border-emerald-200" : "border-gray-200",
                  )}
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                    {/* Rank + name */}
                    <div className="flex items-center gap-3 lg:w-64 lg:shrink-0">
                      <div
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold",
                          i === 0 && o.measurable > 0
                            ? "bg-amber-100 text-amber-700"
                            : "bg-gray-100 text-gray-500",
                        )}
                      >
                        {i + 1}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Store className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                          <h3 className="truncate text-sm font-semibold text-gray-900">{o.name}</h3>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-400">
                          <span>{fmtRM(o.revenue)}</span>
                          {!o.onPos && <span className="text-amber-500">· not on POS</span>}
                        </div>
                      </div>
                    </div>

                    {/* Score */}
                    <div className="lg:w-28 lg:shrink-0">
                      <div
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                          allHit
                            ? "bg-emerald-100 text-emerald-700"
                            : o.measurable === 0
                              ? "bg-gray-100 text-gray-400"
                              : "bg-amber-100 text-amber-700",
                        )}
                      >
                        <Trophy className="h-3.5 w-3.5" />
                        {o.measurable === 0 ? "no data" : `${o.met}/${o.measurable} KPIs`}
                      </div>
                    </div>

                    {/* KPI cells */}
                    <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                      <KpiCell kpiKey="collection" kpi={o.kpis.collection} />
                      <KpiCell kpiKey="upsell" kpi={o.kpis.upsell} />
                      <KpiCell kpiKey="ops" kpi={o.kpis.ops} />
                      <KpiCell kpiKey="wastage" kpi={o.kpis.wastage} />
                      <KpiCell kpiKey="serving" kpi={o.kpis.serving} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Serving-time scope note */}
          <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
            <div className="flex items-start gap-2">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
              <div className="text-xs text-gray-500">
                <span className="font-semibold text-gray-700">Serving time</span> measures order placed →
                kitchen <em>Ready</em> (target ≤ {data.targets.servingMins}m) for <strong>queued pickup &amp; Grab
                orders</strong> — the only ones with a kitchen bump. Dine-in sales are rung up already paid, so they
                have no &ldquo;ready&rdquo; event to measure; an outlet with no queued orders shows <em>no data</em>.
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
