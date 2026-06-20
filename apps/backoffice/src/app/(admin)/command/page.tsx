"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Gauge,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Receipt,
  Clock,
  UserMinus,
  MessageSquareWarning,
  ChevronRight,
  Timer,
  Users,
  Boxes,
  HeartHandshake,
  CheckCircle2,
} from "lucide-react";
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell } from "recharts";
import { useFetch } from "@/lib/use-fetch";
import { Card } from "@/components/ui/card";

type RoundPoint = { key: string; label: string; revenue: number; orders?: number };
type OutletKpi = {
  id: string;
  name: string;
  revenue: number;
  orders: number;
  aov: number;
  growthPct: number | null;
  periodTarget: number;
  pctOfTarget: number;
  traded: boolean;
  rounds: RoundPoint[];
};
type Alert = {
  id: string;
  family: "money" | "promise" | "pace" | "customer";
  severity: "high" | "med";
  title: string;
  detail: string;
  href: string;
};
type CommandData = {
  generatedAt: string;
  period: { type: string; from: string; to: string; days: number };
  scope: string;
  canSeeAllOutlets: boolean;
  company: {
    revenue: number;
    orders: number;
    aov: number;
    target: number;
    pctOfTarget: number;
    growthPct: number | null;
    channel: { dineIn: ChannelAgg; takeaway: ChannelAgg; delivery: ChannelAgg };
    rounds: RoundPoint[];
  };
  outlets: OutletKpi[];
  alerts: Alert[];
};
type ChannelAgg = { revenue: number; orders: number };

type ReviewsData = {
  allGoogleReviews?: { rating: number; outletName?: string }[];
  outlets?: { outletId: string; google?: { averageRating?: number } }[];
};

const AOV_TARGET = 40;
const PERIODS = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

const formatRM = (n: number) => "RM " + Math.round(n).toLocaleString();

const FAMILY_ICON: Record<Alert["family"], React.ElementType> = {
  pace: TrendingDown,
  money: Receipt,
  promise: Clock,
  customer: UserMinus,
};

export default function CommandCenterPage() {
  const [period, setPeriod] = useState("month");
  const [outlet, setOutlet] = useState("all");

  const { data, error, isLoading, mutate } = useFetch<CommandData>(`/api/command?period=${period}`);
  const { data: reviews } = useFetch<ReviewsData>(`/api/reviews/dashboard?period=${period}`);

  const ratingByOutlet = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of reviews?.outlets ?? []) {
      if (o.google?.averageRating) m.set(o.outletId, o.google.averageRating);
    }
    return m;
  }, [reviews]);

  const lowReviewCount = useMemo(
    () => (reviews?.allGoogleReviews ?? []).filter((r) => r.rating > 0 && r.rating < 3).length,
    [reviews],
  );

  // Scope selection is client-side: company = aggregate, otherwise read the
  // chosen outlet straight from the league array (rounds + KPIs are all there).
  const selected = outlet === "all" ? null : data?.outlets.find((o) => o.id === outlet);
  const view =
    selected != null
      ? {
          revenue: selected.revenue,
          aov: selected.aov,
          orders: selected.orders,
          pctOfTarget: selected.pctOfTarget,
          growthPct: selected.growthPct,
          target: selected.periodTarget,
          rounds: selected.rounds,
        }
      : data?.company
        ? {
            revenue: data.company.revenue,
            aov: data.company.aov,
            orders: data.company.orders,
            pctOfTarget: data.company.pctOfTarget,
            growthPct: data.company.growthPct,
            target: data.company.target,
            rounds: data.company.rounds,
          }
        : null;

  // Merge the live reviews signal into the attention lane (a 3rd family/module).
  const alerts: Alert[] = useMemo(() => {
    const base = [...(data?.alerts ?? [])];
    if (lowReviewCount > 0) {
      base.push({
        id: "reviews-low",
        family: "customer",
        severity: lowReviewCount >= 3 ? "high" : "med",
        title: `${lowReviewCount} Google review${lowReviewCount > 1 ? "s" : ""} under 3★`,
        detail: "Response rate drives your GBP ranking — reply today",
        href: "/reviews",
      });
    }
    return base;
  }, [data, lowReviewCount]);

  const channel = data?.company.channel;
  const channelTotal = channel
    ? channel.dineIn.revenue + channel.takeaway.revenue + channel.delivery.revenue
    : 0;

  const maxRound = Math.max(1, ...(view?.rounds.map((r) => r.revenue) ?? [1]));

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {/* Header + controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-dark text-terracotta">
            <Gauge className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-medium leading-tight">Command Center</h1>
            <p className="text-sm text-muted-foreground">
              One pane · every metric vs target{" "}
              {data && (
                <span className="text-xs">
                  · {data.period.from} → {data.period.to}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`rounded-md px-3 py-1 text-sm transition ${
                  period === p.key ? "bg-terracotta text-white" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => mutate()}
            className="flex h-8 w-8 items-center justify-center rounded-lg border hover:bg-muted"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Outlet selector */}
      {data && data.canSeeAllOutlets && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setOutlet("all")}
            className={`rounded-full border px-3 py-1 text-sm ${
              outlet === "all" ? "border-terracotta bg-terracotta/10 text-terracotta" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            All outlets
          </button>
          {data.outlets.map((o) => (
            <button
              key={o.id}
              onClick={() => setOutlet(o.id)}
              className={`rounded-full border px-3 py-1 text-sm ${
                outlet === o.id ? "border-terracotta bg-terracotta/10 text-terracotta" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {o.name}
            </button>
          ))}
        </div>
      )}

      {error && (
        <Card className="p-4 text-sm text-red-600">Couldn’t load the command center. Try refreshing.</Card>
      )}

      {/* Needs you now */}
      <Card className="p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-red-600">Needs you now</span>
          <span className="text-xs text-muted-foreground">ranked by impact · tap to drill</span>
        </div>
        {alerts.length === 0 ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            {isLoading ? "Reading the floor…" : "All clear — nothing tracking off target right now."}
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((a) => {
              const Icon = FAMILY_ICON[a.family];
              const tone = a.severity === "high" ? "text-red-600" : "text-amber-600";
              return (
                <Link
                  key={a.id}
                  href={a.href}
                  className="flex items-center gap-3 rounded-lg border border-transparent bg-muted/50 px-3 py-2.5 hover:border-border"
                >
                  <Icon className={`h-5 w-5 shrink-0 ${tone}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{a.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{a.detail}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              );
            })}
          </div>
        )}
      </Card>

      {/* Pulse */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Sales"
          value={view ? formatRM(view.revenue) : "—"}
          sub={view ? `${view.pctOfTarget}% of ${formatRM(view.target)}` : ""}
          good={view ? view.pctOfTarget >= 90 : undefined}
        />
        <Stat
          label="Avg order"
          value={view ? `RM ${view.aov}` : "—"}
          sub={`target RM ${AOV_TARGET}`}
          good={view ? view.aov >= AOV_TARGET : undefined}
        />
        <Stat label="Orders" value={view ? view.orders.toLocaleString() : "—"} sub={data ? `${data.period.days} days` : ""} />
        <Stat
          label="Growth"
          value={view?.growthPct != null ? `${view.growthPct > 0 ? "+" : ""}${view.growthPct}%` : "—"}
          sub="vs last period"
          good={view?.growthPct != null ? view.growthPct >= 0 : undefined}
        />
      </div>

      {/* Branch league — company view only */}
      {!selected && data && (
        <Card className="p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Branch league · who needs attention
            </span>
            <span className="text-xs text-muted-foreground">red = off target</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="pb-2 font-normal">Outlet</th>
                  <th className="pb-2 text-right font-normal">Sales / target</th>
                  <th className="pb-2 text-right font-normal">AOV</th>
                  <th className="pb-2 text-right font-normal">Growth</th>
                  <th className="pb-2 text-right font-normal">★</th>
                </tr>
              </thead>
              <tbody>
                {data.outlets.map((o) => {
                  const rating = ratingByOutlet.get(o.id);
                  return (
                    <tr key={o.id} className="border-t">
                      <td className="py-2.5 font-medium">{o.name}</td>
                      <td className={`py-2.5 text-right ${o.pctOfTarget >= 90 ? "text-emerald-600" : "text-red-600"}`}>
                        {formatRM(o.revenue)} · {o.pctOfTarget}%
                      </td>
                      <td className={`py-2.5 text-right ${o.aov >= AOV_TARGET ? "" : "text-red-600"}`}>RM {o.aov}</td>
                      <td
                        className={`py-2.5 text-right ${
                          o.growthPct == null ? "text-muted-foreground" : o.growthPct >= 0 ? "text-emerald-600" : "text-red-600"
                        }`}
                      >
                        {o.growthPct == null ? "—" : `${o.growthPct > 0 ? "+" : ""}${o.growthPct}%`}
                      </td>
                      <td className={`py-2.5 text-right ${rating == null ? "text-muted-foreground" : rating >= 4.5 ? "" : "text-red-600"}`}>
                        {rating == null ? "—" : rating.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Sales by round + channel mix */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sales by round{selected ? ` · ${selected.name}` : ""}
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={view?.rounds ?? []} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} interval={0} />
                <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                  {(view?.rounds ?? []).map((r) => (
                    <Cell key={r.key} fill={r.revenue >= maxRound ? "#C2452D" : "#D4654F"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Channel mix</div>
          {channel && channelTotal > 0 ? (
            <>
              <div className="mb-3 flex h-4 overflow-hidden rounded-md">
                <div style={{ width: `${(channel.dineIn.revenue / channelTotal) * 100}%`, background: "#160800" }} />
                <div style={{ width: `${(channel.takeaway.revenue / channelTotal) * 100}%`, background: "#C2452D" }} />
                <div style={{ width: `${(channel.delivery.revenue / channelTotal) * 100}%`, background: "#D4654F" }} />
              </div>
              <ChannelRow color="#160800" label="Dine-in" pct={(channel.dineIn.revenue / channelTotal) * 100} />
              <ChannelRow color="#C2452D" label="Pick-up" pct={(channel.takeaway.revenue / channelTotal) * 100} />
              <ChannelRow color="#D4654F" label="Delivery" pct={(channel.delivery.revenue / channelTotal) * 100} />
              {selected && <p className="mt-2 text-xs text-muted-foreground">Company split</p>}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No channel data.</p>
          )}
        </Card>
      </div>

      {/* Wiring next — the lenses still served by other modules */}
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Wiring next</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NextTile icon={Timer} label="Serving time" sub="<10-min promise" href="/ops/dashboard" />
          <NextTile icon={Users} label="People cost" sub="vs 15% target" href="/hr" />
          <NextTile icon={Boxes} label="Wastage & COGS" sub="vs 35% target" href="/inventory/dashboard" />
          <NextTile icon={HeartHandshake} label="Win-back" sub="churn signals" href="/loyalty/dashboard" />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean }) {
  const tone = good === undefined ? "" : good ? "text-emerald-600" : "text-red-600";
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-medium leading-tight ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function ChannelRow({ color, label, pct }: { color: string; label: string; pct: number }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-sm">
      <span className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span>{Math.round(pct)}%</span>
    </div>
  );
}

function NextTile({
  icon: Icon,
  label,
  sub,
  href,
}: {
  icon: React.ElementType;
  label: string;
  sub: string;
  href: string;
}) {
  return (
    <Link href={href} className="rounded-lg border border-dashed p-3 hover:bg-muted/50">
      <Icon className="mb-1 h-4 w-4 text-muted-foreground" />
      <div className="text-sm">{label}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </Link>
  );
}
