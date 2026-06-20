"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { RefreshCw, Boxes, Trash2, Users, Timer, HeartHandshake } from "lucide-react";
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell } from "recharts";
import { useFetch } from "@/lib/use-fetch";
import { Card } from "@/components/ui/card";

type UserProfile = { id: string; name: string; role: string };

type RoundPoint = { key: string; label: string; revenue: number };
type ChannelAgg = { revenue: number; orders: number };
type OutletKpi = {
  id: string; name: string; revenue: number; orders: number; aov: number;
  growthPct: number | null; periodTarget: number; pctOfTarget: number; onPace: boolean; traded: boolean;
  rounds: RoundPoint[];
};
type CommandData = {
  period: { type: string; from: string; to: string; days: number };
  canSeeAllOutlets: boolean;
  company: {
    revenue: number; orders: number; aov: number; target: number; pctOfTarget: number; onPace: boolean;
    growthPct: number | null;
    channel: { dineIn: ChannelAgg; takeaway: ChannelAgg; delivery: ChannelAgg };
    rounds: RoundPoint[];
  };
  outlets: OutletKpi[];
};
type ReviewsData = {
  outlets?: { outletId: string; google?: { averageRating?: number } }[];
};
type ServeStat = { avgMins: number; maxMins: number; tracked: number };
type LensData = {
  serving: { company: ServeStat | null; byOutlet: Record<string, ServeStat> } | null;
  cogs: { rm: number; pct: number; gpPct: number } | null;
  wastage: { companyRM: number; byOutlet: Record<string, number> } | null;
  peopleCost: { label: string; costRM: number; pct: number | null } | null;
  churn: { atRisk: number; winBack: number } | null;
};

const AOV_TARGET = 40;
const PERIODS = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];
const formatRM = (n: number) => "RM " + Math.round(n).toLocaleString();

export default function DashboardPage() {
  const { data: user } = useFetch<UserProfile>("/api/auth/me");

  const [period, setPeriod] = useState("month");
  const [outlet, setOutlet] = useState("all");
  const { data, mutate } = useFetch<CommandData>(`/api/command?period=${period}`);
  const { data: reviews, mutate: mutateReviews } = useFetch<ReviewsData>(`/api/reviews/dashboard?period=${period}`);
  const { data: lenses, mutate: mutateLenses } = useFetch<LensData>(`/api/command/lenses?period=${period}`);

  const ratingByOutlet = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of reviews?.outlets ?? []) {
      if (o.google?.averageRating) m.set(o.outletId, o.google.averageRating);
    }
    return m;
  }, [reviews]);

  const selected = outlet === "all" ? null : data?.outlets.find((o) => o.id === outlet);
  const view = selected ?? data?.company ?? null;
  const rounds = selected ? selected.rounds : data?.company.rounds ?? [];
  const maxRound = Math.max(1, ...rounds.map((r) => r.revenue));
  const channel = data?.company.channel;
  const channelTotal = channel
    ? channel.dineIn.revenue + channel.takeaway.revenue + channel.delivery.revenue
    : 0;

  const now = new Date();
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";

  const refreshAll = () => { mutate(); mutateReviews(); mutateLenses(); };

  return (
    <div className="p-4 sm:p-6 lg:p-8 overflow-x-hidden space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-xl sm:text-2xl font-bold text-foreground">
            {greeting}{user?.name ? `, ${user.name}` : ""}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {now.toLocaleDateString("en-MY", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border p-0.5">
            {PERIODS.map((p) => (
              <button key={p.key} onClick={() => setPeriod(p.key)}
                className={`rounded-md px-3 py-1 text-xs transition ${period === p.key ? "bg-terracotta text-white" : "text-muted-foreground hover:bg-muted"}`}>
                {p.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={refreshAll}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* Outlet selector */}
      {data && data.canSeeAllOutlets && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setOutlet("all")}
            className={`rounded-full border px-3 py-1 text-xs ${outlet === "all" ? "border-terracotta bg-terracotta/10 text-terracotta" : "text-muted-foreground hover:bg-muted"}`}>
            All outlets
          </button>
          {data.outlets.map((o) => (
            <button key={o.id} onClick={() => setOutlet(o.id)}
              className={`rounded-full border px-3 py-1 text-xs ${outlet === o.id ? "border-terracotta bg-terracotta/10 text-terracotta" : "text-muted-foreground hover:bg-muted"}`}>
              {o.name}
            </button>
          ))}
        </div>
      )}

      {/* Pulse */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Sales" value={view ? formatRM(view.revenue) : "—"}
          sub={view ? `${view.pctOfTarget}% of ${formatRM(selected ? selected.periodTarget : data?.company.target ?? 0)}` : ""}
          good={view ? view.onPace : undefined} progress={view?.pctOfTarget} />
        <Stat label="Avg order" value={view ? `RM ${view.aov}` : "—"} sub={`target RM ${AOV_TARGET}`}
          good={view ? view.aov >= AOV_TARGET : undefined} />
        <Stat label="Orders" value={view ? view.orders.toLocaleString() : "—"} sub={data ? `${data.period.days} days` : ""} />
        <Stat label="Growth" value={view?.growthPct != null ? `${view.growthPct > 0 ? "+" : ""}${view.growthPct}%` : "—"}
          sub="vs last period" good={view?.growthPct != null ? view.growthPct >= 0 : undefined} />
      </div>

      {/* Branch league — company view */}
      {!selected && data && (
        <Card className="p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Branch league · who needs attention</span>
            <span className="text-xs text-muted-foreground">red = behind pace</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="pb-2 font-normal">Outlet</th>
                  <th className="pb-2 text-right font-normal">Sales / target</th>
                  <th className="pb-2 text-right font-normal">AOV</th>
                  <th className="pb-2 text-right font-normal">Growth</th>
                  <th className="pb-2 text-right font-normal">Serve</th>
                  <th className="pb-2 text-right font-normal">★</th>
                </tr>
              </thead>
              <tbody>
                {data.outlets.map((o) => {
                  const rating = ratingByOutlet.get(o.id);
                  const serve = lenses?.serving?.byOutlet[o.id];
                  return (
                    <tr key={o.id} className="border-t">
                      <td className="py-2.5 font-medium">{o.name}</td>
                      <td className={`py-2.5 text-right ${o.onPace ? "text-emerald-600" : "text-red-600"}`}>{formatRM(o.revenue)} · {o.pctOfTarget}%</td>
                      <td className={`py-2.5 text-right ${o.aov >= AOV_TARGET ? "" : "text-red-600"}`}>RM {o.aov}</td>
                      <td className={`py-2.5 text-right ${o.growthPct == null ? "text-muted-foreground" : o.growthPct >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {o.growthPct == null ? "—" : `${o.growthPct > 0 ? "+" : ""}${o.growthPct}%`}
                      </td>
                      <td className={`py-2.5 text-right ${serve == null ? "text-muted-foreground" : serve.avgMins <= 10 ? "text-emerald-600" : "text-red-600"}`}>
                        {serve == null ? "—" : `${serve.avgMins}m`}
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
          <p className="mt-2 text-[11px] text-muted-foreground">Targets: RM 120,000 / outlet / month (Putrajaya RM 140,000) · % = share of the period goal, coloured by whether the outlet is on pace.</p>
        </Card>
      )}

      {/* Round chart + channel mix */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sales by round{selected ? ` · ${selected.name}` : ""}
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rounds} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} interval={0} />
                <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                  {rounds.map((r) => <Cell key={r.key} fill={r.revenue >= maxRound ? "#C2452D" : "#D4654F"} />)}
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

      {/* The other lenses — live */}
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Cost · service · people · customers</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <LensCard icon={Timer} label="Serve time"
            value={lenses?.serving?.company ? `${lenses.serving.company.avgMins}m` : "—"}
            sub={lenses?.serving?.company ? `max ${lenses.serving.company.maxMins}m · <10 target` : "no data yet"}
            tone={lenses?.serving?.company ? (lenses.serving.company.avgMins <= 10 ? "good" : "bad") : "muted"}
            href="/pos/store-menu-status" loading={!lenses} />
          <LensCard icon={Boxes} label="COGS"
            value={lenses?.cogs ? `${lenses.cogs.pct}%` : "—"}
            sub={lenses?.cogs ? `GP ${lenses.cogs.gpPct}% · target 35%` : "no data yet"}
            tone={lenses?.cogs ? (lenses.cogs.pct <= 35 ? "good" : "bad") : "muted"}
            href="/inventory/reports" loading={!lenses} />
          <LensCard icon={Users} label="People cost"
            value={lenses?.peopleCost?.pct != null ? `${lenses.peopleCost.pct}%` : lenses?.peopleCost ? formatRM(lenses.peopleCost.costRM) : "—"}
            sub={lenses?.peopleCost ? `${lenses.peopleCost.label} · target 15%` : "no data yet"}
            tone={lenses?.peopleCost?.pct != null ? (lenses.peopleCost.pct <= 15 ? "good" : "bad") : "muted"}
            href="/hr/payroll" loading={!lenses} />
          <LensCard icon={Trash2} label="Wastage"
            value={lenses?.wastage ? formatRM(lenses.wastage.companyRM) : "—"}
            sub="this period" tone="muted" href="/inventory/wastage" loading={!lenses} />
          <LensCard icon={HeartHandshake} label="Win-back"
            value={lenses?.churn ? lenses.churn.winBack.toLocaleString() : "—"}
            sub={lenses?.churn ? `of ${lenses.churn.atRisk.toLocaleString()} quiet 28d+` : "no data yet"}
            tone="muted" href="/loyalty/dashboard" loading={!lenses} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, good, progress }: { label: string; value: string; sub?: string; good?: boolean; progress?: number }) {
  const tone = good === undefined ? "" : good ? "text-emerald-600" : "text-red-600";
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-medium leading-tight ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      {progress != null && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, progress))}%`, background: good === false ? "#C2452D" : "#16a34a" }} />
        </div>
      )}
    </div>
  );
}

function ChannelRow({ color, label, pct }: { color: string; label: string; pct: number }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-sm">
      <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}</span>
      <span>{Math.round(pct)}%</span>
    </div>
  );
}

function LensCard({ icon: Icon, label, value, sub, tone, href, loading }: {
  icon: React.ElementType; label: string; value: string; sub: string;
  tone: "good" | "bad" | "muted"; href: string; loading?: boolean;
}) {
  const toneCls = tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-red-600" : "text-foreground";
  return (
    <Link href={href} className="rounded-lg border bg-card p-3 transition-colors hover:bg-muted/40">
      <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /><span className="text-xs">{label}</span>
      </div>
      {loading
        ? <div className="h-6 w-12 rounded bg-muted animate-pulse" />
        : <div className={`text-xl font-medium leading-tight ${toneCls}`}>{value}</div>}
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </Link>
  );
}
