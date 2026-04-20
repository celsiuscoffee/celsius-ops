"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Sparkles, RefreshCw, Loader2, ArrowRight,
  Gift, ClipboardCheck, Boxes, Trash2, HandCoins, Users, AlertOctagon, TrendingUp,
} from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type UserProfile = { id: string; name: string; role: string };

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
  sales: TrendingUp,
  loyalty: Gift,
  ops: ClipboardCheck,
  inventory: Boxes,
  wastage: Trash2,
  cash: HandCoins,
  people: Users,
  other: AlertOctagon,
};

const AREA_LINK: Record<Recommendation["area"], string> = {
  sales: "/sales/dashboard",
  loyalty: "/loyalty/dashboard",
  ops: "/ops/dashboard",
  inventory: "/inventory/dashboard",
  wastage: "/inventory/wastage",
  cash: "/inventory/pay-and-claim",
  people: "/hr",
  other: "/dashboard",
};

const PRIORITY_ORDER: Record<Recommendation["priority"], number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

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
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function DashboardPage() {
  const { data: user } = useFetch<UserProfile>("/api/auth/me");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCached = useCallback(async () => {
    setLoading(true);
    setError(null);
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
      setError("Failed to load insights");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCached(); }, [loadCached]);

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-agent/celsius-overview?skipTelegram=true", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Failed to generate");
        return;
      }
      setGeneratedAt(data.generatedAt);
      setRecs(data.recommendations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setRefreshing(false);
    }
  };

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const sortedRecs = recs ? [...recs].sort((a, b) =>
    PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
  ) : null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 overflow-x-hidden">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-xl sm:text-2xl font-bold text-foreground">
            {greeting}{user?.name ? `, ${user.name}` : ""}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {now.toLocaleDateString("en-MY", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {generatedAt && (
            <span className="text-[11px] text-gray-400">
              Updated {relativeTime(generatedAt)}
            </span>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50"
          >
            {refreshing
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : generatedAt
                ? <RefreshCw className="h-3.5 w-3.5" />
                : <Sparkles className="h-3.5 w-3.5" />}
            {refreshing ? "Analyzing…" : generatedAt ? "Refresh" : "Generate insights"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Title for insights section */}
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-purple-500" />
        <h2 className="text-sm font-semibold text-gray-900">This week — what needs your attention</h2>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="space-y-3">
          {[1,2,3,4].map(i => (
            <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state — no cache yet */}
      {!loading && generatedAt === null && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <Sparkles className="h-8 w-8 text-purple-300 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-gray-900">No insights generated yet</h3>
          <p className="mt-1 text-xs text-gray-500 max-w-md mx-auto">
            Click <strong>Generate insights</strong> to scan the past 7 days across ops, inventory,
            wastage, cash, and loyalty — the AI will surface what needs your attention.
          </p>
        </div>
      )}

      {/* Empty state — nothing urgent */}
      {!loading && sortedRecs && sortedRecs.length === 0 && generatedAt && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <p className="text-sm font-medium text-emerald-800">
            Nothing urgent right now — the AI scanned everything and found no items worth flagging.
          </p>
          <p className="mt-1 text-xs text-emerald-700">Refresh anytime to re-scan.</p>
        </div>
      )}

      {/* Recommendations */}
      {!loading && sortedRecs && sortedRecs.length > 0 && (
        <div className="space-y-3">
          {sortedRecs.map((r, i) => {
            const Icon = AREA_ICON[r.area];
            const href = AREA_LINK[r.area];
            const styles = PRIORITY_STYLES[r.priority];
            return (
              <Link
                key={i}
                href={href}
                className={`block rounded-xl border bg-white p-4 hover:shadow-md transition-shadow ${styles.card}`}
              >
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-0.5 rounded-lg bg-gray-50 p-2">
                    <Icon className="h-4 w-4 text-gray-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${styles.chip}`}>
                        {styles.label}
                      </span>
                      <span className="text-[10px] text-gray-400 uppercase tracking-wide">{r.area}</span>
                    </div>
                    <h3 className="text-sm font-semibold text-gray-900">{r.title}</h3>
                    <p className="mt-1 text-xs text-gray-600">{r.why}</p>
                    <p className="mt-1.5 text-xs font-medium text-gray-900">
                      <span className="text-gray-400">→</span> {r.action}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-gray-300 shrink-0" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
