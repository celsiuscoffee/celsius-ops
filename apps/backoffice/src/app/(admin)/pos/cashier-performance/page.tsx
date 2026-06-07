"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, Phone, Target, Users, AlertTriangle } from "lucide-react";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { toast } from "@celsius/ui";

/**
 * POS Cashier Performance — phone-collection effectiveness per cashier.
 * v1: collection rate (the ungameable loyalty-DB metric). new/repeat split +
 * upsell + per-staff HR view are Phase B (see docs/design/
 * cashier-performance-dashboard.md). Scope: cashier-rung (source=pos) orders.
 */

type Cashier = {
  id: string;
  name: string;
  orders: number;
  collected: number;
  rate: number;
  maxSamePhone: number;
  suspicious: boolean;
};
type Data = {
  days: number;
  target: number;
  overall: { orders: number; collected: number; rate: number };
  cashiers: Cashier[];
};

const DAYS_OPTIONS = [7, 30, 90];

export default function CashierPerformancePage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`/api/pos/cashier-performance?days=${days}`);
      if (!res.ok) throw new Error("Load failed");
      setData((await res.json()) as Data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const overall = data?.overall;
  const cashiers = data?.cashiers ?? [];
  const target = data?.target ?? 70;

  return (
    <div className="p-3 sm:p-6 space-y-5 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#160800]">Cashier Performance</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Phone-number collection per cashier — the loyalty top-of-funnel. Counter-rung
            orders only (Grab / pickup / QR self-orders excluded). Target {target}%.
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-[#160800]"
        >
          {DAYS_OPTIONS.map((d) => (
            <option key={d} value={d}>Last {d} days</option>
          ))}
        </select>
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="rounded-2xl bg-white p-4 border border-gray-100">
          <div className="flex items-center gap-2 mb-1.5">
            <Target className="h-4 w-4 text-[#A2492C]" />
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Collection Rate</p>
          </div>
          <p className={`text-2xl font-bold ${rateColor(overall?.rate ?? 0, target)}`}>
            {overall ? `${overall.rate}%` : "—"}
          </p>
          <p className="mt-0.5 text-[11px] text-gray-500">
            {overall ? `${overall.collected.toLocaleString()} / ${overall.orders.toLocaleString()} orders · target ${target}%` : " "}
          </p>
        </div>
        <KpiCard Icon={Phone} label="Numbers Collected" value={overall ? overall.collected.toLocaleString() : "—"} sub={`last ${days} days`} />
        <KpiCard Icon={Users} label="Cashiers Tracked" value={String(cashiers.length)} sub="counter-rung orders" />
      </div>

      {/* Per-cashier leaderboard */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-700">
              <th className="px-4 py-3 w-10">#</th>
              <th className="px-4 py-3">Cashier</th>
              <th className="px-4 py-3 text-right">Orders</th>
              <th className="px-4 py-3 text-right">Collected</th>
              <th className="px-4 py-3 text-right w-48">Collection Rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center"><Loader2 className="inline h-5 w-5 animate-spin text-gray-400" /></td></tr>
            ) : cashiers.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500">No counter-rung orders in this period yet.</td></tr>
            ) : (
              cashiers.map((c, i) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-400">{i + 1}</td>
                  <td className="px-4 py-3 text-sm text-[#160800]">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#FBEBE8] text-xs font-bold text-[#A2492C]">
                        {c.name.charAt(0)}
                      </div>
                      <span className="font-medium">{c.name}</span>
                      {c.suspicious && (
                        <span title={`One number appears on ${c.maxSamePhone} of this cashier's orders — review for fake/own-number entry.`}>
                          <AlertTriangle className="h-4 w-4 text-amber-500" />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-gray-600">{c.orders.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium text-[#160800]">{c.collected.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-24 rounded-full bg-gray-200 overflow-hidden">
                        <div className={`h-1.5 rounded-full ${rateBar(c.rate, target)}`} style={{ width: `${Math.min(c.rate, 100)}%` }} />
                      </div>
                      <span className={`text-sm font-semibold w-10 text-right ${rateColor(c.rate, target)}`}>{c.rate}%</span>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        v1 measures collection only. New-vs-repeat split, the upsell conversion metric, and
        the per-staff view on the HR page are Phase B. <AlertTriangle className="inline h-3 w-3 text-amber-500" />
        flags a cashier where one number recurs across many tickets (possible fake/own-number entry).
      </p>
    </div>
  );
}

function rateColor(rate: number, target: number): string {
  if (rate >= target) return "text-emerald-600";
  if (rate >= target * 0.6) return "text-amber-600";
  return "text-red-600";
}
function rateBar(rate: number, target: number): string {
  if (rate >= target) return "bg-emerald-500";
  if (rate >= target * 0.6) return "bg-amber-500";
  return "bg-red-500";
}

function KpiCard({ Icon, label, value, sub }: { Icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 border border-gray-100">
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="h-4 w-4 text-[#A2492C]" />
        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">{label}</p>
      </div>
      <p className="text-2xl font-bold text-[#160800]">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-gray-500">{sub}</p>}
    </div>
  );
}
