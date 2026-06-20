"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Sparkles, RefreshCw, Loader2, ArrowRight,
  Gift, ClipboardCheck, Boxes, Trash2, HandCoins, Users, AlertOctagon, TrendingUp,
  Timer, HeartHandshake,
} from "lucide-react";
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell } from "recharts";
import { useFetch } from "@/lib/use-fetch";
import { Card } from "@/components/ui/card";

type UserProfile = { id: string; name: string; role: string };

// ── AI recommendations (the "needs your attention" lane) ──────────────────
type Recommendation = {
  area: "sales" | "loyalty" | "ops" | "inventory" | "wastage" | "cash" | "people" | "other";
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  why: string;
  action: string;
};
type Cached = {
  ok: true;
  cached: { generatedAt: string; recommendations: Recommendation[] } | null;
};

const AREA_ICON: Record<Recommendation["area"], React.ElementType> = {
  sales: TrendingUp, loyalty: Gift, ops: ClipboardCheck, inventory: Boxes,
  wastage: Trash2, cash: HandCoins, people: Users, other: AlertOctagon,
};
const AREA_LINK: Record<Recommendation["area"], string> = {
  sales: "/sales/dashboard", loyalty: "/loyalty/dashboard", ops: "/ops/dashboard",
  inventory: "/inventory/dashboard", wastage: "/inventory/wastage",
  cash: "/inventory/pay-and-claim", people: "/hr", other: "/dashboard",
};
const PRIORITY_ORDER: Record<Recommendation["priority"], number> = { critical: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_STYLES: Record<Recommendation["priority"], { chip: string; card: string; label: string }> = {
  critical: { chip: "bg-red-100 text-red-700", card: "border-red-200", label: "Critical" },
  high:     { chip: "bg-orange-100 text-orange-700", card: "border-orange-200", label: "High" },
  medium:   { chip: "bg-amber-100 text-amber-700", card: "border-amber-200", label: "Medium" },
  low:      { chip: "bg-gray-100 text-gray-700", card: "border-gray-200", label: "Low" },
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Command Center metrics ────────────────────────────────────────────────
type RoundPoint = { key: string; label: string; revenue: number };
type ChannelAgg = { revenue: number; orders: number };
type OutletKpi = {
  id: string; name: string; revenue: number; orders: number; aov: number;
  growthPct: number | null; periodTarget: number; pctOfTarget: number; traded: boolean;
  rounds: RoundPoint[];
};
type CommandData = {
  period: { type: string; from: string; to: string; days: number };
  canSeeAllOutlets: boolean;
  company: {
    revenue: number; orders: number; aov: number; target: number; pctOfTarget: number;
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

  // Attention lane — cached AI recommendations.
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [recsLoading, setRecsLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [recsError, setRecsError] = useState<string | null>(null);

  const loadCached = useCallback(async () => {
    setRecsLoading(true);
    setRecsError(null);
    try {
      const res = await fetch("/api/ai-agent/celsius-overview/latest", { credentials: "include" });
      const data: Cached = await res.json();
      if (data.cached) {
        setGeneratedAt(data.cached.generatedAt);
        setRecs(data.cached.recommendations);
      } else {
        setGeneratedAt(null);
        setRecs([]);
      }
    } catch {
      setRecsError("Failed to load insights");
    } finally {
      setRecsLoading(false);
    }
  }, []);
  useEffect(() => { loadCached(); }, [loadCached]);

  const regenerate = async () => {
    setRegenerating(true);
    setRecsError(null);
    try {
      const res = await fetch("/api/ai-agent/celsius-overview?skipTelegram=true", {
        method: "POST", credentials: "include",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) { setRecsError(data.error || "Failed to generate"); return; }
      setGeneratedAt(data.generatedAt);
      setRecs(data.recommendations);
    } catch (e) {
      setRecsError(e instanceof Error ? e.message : "Network error");
    } finally {
      setRegenerating(false);
    }
  };

  // Command metrics.
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

  const sortedRecs = recs
    ? [...recs].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
    : null;

  const now = new Date();
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";

  const refreshAll = () => { mutate(); mutateReviews(); mutateLenses(); loadCached(); };

  return (
    <div className="p-4 sm:p-6 lg:p-8 overflow-x-hidden space-y-7">
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
          {generatedAt && <span className="text-[11px] text-muted-foreground">Updated {relativeTime(generatedAt)}</span>}
          <button
            type="button" onClick={refreshAll}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* Attention lane — AI recommendations */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            <h2 className="text-sm font-semibold">This week — what needs your attention</h2>
          </div>
          <button
            type="button" onClick={regenerate} disabled={regenerating}
            className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-2.5 py-1 text-[11px] font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50"
          >
            {regenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {regenerating ? "Analyzing…" : generatedAt ? "Regenerate" : "Generate insights"}
          </button>
        </div>

        {recsError && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{recsError}</div>
        )}

        {recsLoading && (
          <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}</div>
        )}

        {!recsLoading && generatedAt === null && (
          <div className="rounded-xl border border-dashed p-6 text-center">
            <Sparkles className="h-7 w-7 text-purple-300 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Click <strong>Generate insights</strong> to scan the past 7 days across ops, inventory, wastage, cash and loyalty.
            </p>
          </div>
        )}

        {!recsLoading && sortedRecs && sortedRecs.length === 0 && generatedAt && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center text-sm font-medium text-emerald-800">
            Nothing urgent right now — the AI scanned everything and found nothing worth flagging.
          </div>
        )}

        {!recsLoading && sortedRecs && sortedRecs.length > 0 && (
          <div className="space-y-3">
            {sortedRecs.map((r, i) => {
              const Icon = AREA_ICON[r.area];
              const styles = PRIORITY_STYLES[r.priority];
              return (
                <Link key={i} href={AREA_LINK[r.area]} className={`block rounded-xl border bg-card p-4 hover:shadow-md transition-shadow ${styles.card}`}>
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 mt-0.5 rounded-lg bg-muted p-2"><Icon className="h-4 w-4 text-foreground" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${styles.chip}`}>{styles.label}</span>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{r.area}</span>
                      </div>
                      <h3 className="text-sm font-semibold">{r.title}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{r.why}</p>
                      <p className="mt-1.5 text-xs font-medium"><span className="text-muted-foreground">→</span> {r.action}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Performance — Command Center metrics */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold">Performance · every metric vs target</h2>
          <div className="inline-flex rounded-lg border p-0.5">
            {PERIODS.map((p) => (
              <button key={p.key} onClick={() => setPeriod(p.key)}
                className={`rounded-md px-3 py-1 text-xs transition ${period === p.key ? "bg-terracotta text-white" : "text-muted-foreground hover:bg-muted"}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

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
            good={view ? view.pctOfTarget >= 90 : undefined} progress={view?.pctOfTarget} />
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
                        <td className={`py-2.5 text-right ${o.pctOfTarget >= 90 ? "text-emerald-600" : "text-red-600"}`}>{formatRM(o.revenue)} · {o.pctOfTarget}%</td>
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
      </section>
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
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, progress))}%`, background: progress >= 90 ? "#16a34a" : "#C2452D" }} />
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
