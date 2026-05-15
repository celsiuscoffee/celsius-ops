"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, Power, TrendingUp, MailOpen, ShoppingCart, Coins, Clock } from "lucide-react";
import { toast } from "@celsius/ui";

/**
 * Push reminders — backoffice control surface for the loyalty push
 * campaign engine. One row per trigger type (voucher expiring,
 * sitting on Beans, lapsed customer, etc.). Toggling a campaign off
 * stops it on the next cron tick (no deploy needed).
 *
 * Stats columns are rolling 7d / 30d windows. "Orders" is the count
 * of orders attributed to a send within 24h (last-touch); "Revenue"
 * is the sum of those orders' totals. Both flow from the
 * notification_sends.attributed_* columns set by the order POST
 * attribution helper.
 */

type Campaign = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  trigger_config: Record<string, unknown>;
  frequency_cap_count: number;
  frequency_cap_days: number;
  send_window_start_hour: number;
  send_window_end_hour: number;
  enabled: boolean;
  stats: {
    sent7: number;
    sent30: number;
    opened7: number;
    opened30: number;
    orders7: number;
    orders30: number;
    revenue7: number;
    revenue30: number;
  };
};

const KEY_ICONS: Record<string, typeof Bell> = {
  voucher_expiring:  Clock,
  sitting_on_beans:  Coins,
  lapsed_customer:   TrendingUp,
  birthday_treat:    Bell,
  tier_at_risk:      MailOpen,
};

export default function PushRemindersPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading]     = useState(true);
  const [busyKey, setBusyKey]     = useState<string | null>(null);
  const [windowMode, setWindowMode] = useState<"7d" | "30d">("7d");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/loyalty/push-campaigns");
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setCampaigns(json.campaigns ?? []);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function toggle(key: string, next: boolean) {
    setBusyKey(key);
    try {
      const res = await fetch(`/api/loyalty/push-campaigns/${key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error(await res.text());
      // Optimistic-ish: refetch so stats stay accurate after toggle.
      await load();
      toast.success(next ? "Campaign enabled" : "Campaign paused");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update campaign");
    } finally {
      setBusyKey(null);
    }
  }

  // Roll up totals across all enabled campaigns for the header card.
  const totals = useMemo(() => {
    return campaigns
      .filter((c) => c.enabled)
      .reduce(
        (acc, c) => {
          acc.sent    += windowMode === "7d" ? c.stats.sent7    : c.stats.sent30;
          acc.opened  += windowMode === "7d" ? c.stats.opened7  : c.stats.opened30;
          acc.orders  += windowMode === "7d" ? c.stats.orders7  : c.stats.orders30;
          acc.revenue += windowMode === "7d" ? c.stats.revenue7 : c.stats.revenue30;
          return acc;
        },
        { sent: 0, opened: 0, orders: 0, revenue: 0 },
      );
  }, [campaigns, windowMode]);

  const openRate = totals.sent > 0 ? (totals.opened / totals.sent) * 100 : 0;
  const orderRate = totals.sent > 0 ? (totals.orders / totals.sent) * 100 : 0;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 flex items-center gap-2">
            <Bell className="h-6 w-6 text-amber-600" />
            Push Reminders
          </h1>
          <p className="text-sm text-gray-600 mt-1 max-w-2xl">
            Triggered push notifications that fan out daily based on
            each member&apos;s rewards state. Toggle a row off to pause
            it; takes effect on the next cron tick.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-white text-xs">
          <button
            onClick={() => setWindowMode("7d")}
            className={`px-3 py-1.5 rounded-md transition ${
              windowMode === "7d" ? "bg-amber-100 text-amber-900 font-semibold" : "text-gray-600"
            }`}
          >Last 7 days</button>
          <button
            onClick={() => setWindowMode("30d")}
            className={`px-3 py-1.5 rounded-md transition ${
              windowMode === "30d" ? "bg-amber-100 text-amber-900 font-semibold" : "text-gray-600"
            }`}
          >Last 30 days</button>
        </div>
      </div>

      {/* Totals card */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatBox label="Sent"      value={totals.sent.toLocaleString()} />
        <StatBox label="Open rate" value={`${openRate.toFixed(1)}%`}    sub={`${totals.opened.toLocaleString()} opened`} />
        <StatBox label="Orders"    value={totals.orders.toLocaleString()} sub={`${orderRate.toFixed(1)}% of sent`} />
        <StatBox label="Revenue"   value={`RM${totals.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} highlight />
      </div>

      {/* Campaign list */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200 bg-gray-50/60">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Campaigns</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
        ) : campaigns.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No campaigns configured.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {campaigns.map((c) => {
              const Icon = KEY_ICONS[c.key] ?? Bell;
              const sent    = windowMode === "7d" ? c.stats.sent7    : c.stats.sent30;
              const opened  = windowMode === "7d" ? c.stats.opened7  : c.stats.opened30;
              const orders  = windowMode === "7d" ? c.stats.orders7  : c.stats.orders30;
              const revenue = windowMode === "7d" ? c.stats.revenue7 : c.stats.revenue30;
              const open    = sent > 0 ? (opened / sent) * 100 : 0;
              const order   = sent > 0 ? (orders / sent) * 100 : 0;

              return (
                <li key={c.key} className="px-5 py-4 hover:bg-amber-50/30 transition">
                  <div className="flex items-center gap-4">
                    {/* Icon + status pill */}
                    <div className="flex flex-col items-center w-10">
                      <Icon className={`h-5 w-5 ${c.enabled ? "text-amber-600" : "text-gray-400"}`} />
                    </div>

                    {/* Name + description */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900 text-sm">{c.name}</span>
                        {c.enabled ? (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium uppercase tracking-wide">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            On
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium uppercase tracking-wide">
                            Paused
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{c.description}</p>
                      <p className="text-[11px] text-gray-400 mt-1">
                        Cap {c.frequency_cap_count}/{c.frequency_cap_days}d &middot;
                        {" "}Send window {String(c.send_window_start_hour).padStart(2, "0")}:00 – {String(c.send_window_end_hour).padStart(2, "0")}:00 MYT
                      </p>
                    </div>

                    {/* Stats inline */}
                    <div className="hidden md:grid grid-cols-4 gap-6 items-center text-right text-xs">
                      <Stat label="Sent"    value={sent.toLocaleString()} />
                      <Stat label="Opened"  value={`${open.toFixed(0)}%`}  sub={opened.toLocaleString()} />
                      <Stat label="Orders"  value={`${order.toFixed(0)}%`} sub={orders.toLocaleString()} />
                      <Stat label="Revenue" value={`RM${revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} highlight />
                    </div>

                    {/* Toggle */}
                    <button
                      onClick={() => toggle(c.key, !c.enabled)}
                      disabled={busyKey === c.key}
                      className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition ${
                        c.enabled
                          ? "bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200"
                          : "bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200"
                      } ${busyKey === c.key ? "opacity-60 cursor-wait" : ""}`}
                      aria-pressed={c.enabled}
                    >
                      <Power className="h-3.5 w-3.5" />
                      {c.enabled ? "Pause" : "Enable"}
                    </button>
                  </div>

                  {/* Stats stacked on mobile */}
                  <div className="md:hidden mt-3 grid grid-cols-4 gap-3 text-xs">
                    <Stat label="Sent"    value={sent.toLocaleString()} />
                    <Stat label="Opened"  value={`${open.toFixed(0)}%`} />
                    <Stat label="Orders"  value={orders.toLocaleString()} />
                    <Stat label="Revenue" value={`RM${revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} highlight />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-4 text-center">
        Stats include only sends from active campaigns within the selected window.
        Order attribution = last-touch within 24h.
      </p>
    </div>
  );
}

function StatBox({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`bg-white border rounded-xl px-4 py-3 ${highlight ? "border-amber-200 shadow-sm" : "border-gray-200"}`}>
      <div className="text-[11px] text-gray-500 font-medium uppercase tracking-wide flex items-center gap-1">
        {label === "Revenue" && <ShoppingCart className="h-3 w-3" />}
        {label}
      </div>
      <div className={`text-xl font-bold mt-1 ${highlight ? "text-amber-700" : "text-gray-900"}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className="text-right">
      <div className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-semibold ${highlight ? "text-amber-700" : "text-gray-900"}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}
