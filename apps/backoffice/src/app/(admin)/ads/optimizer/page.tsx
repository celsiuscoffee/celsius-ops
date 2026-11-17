"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, Ban, Coins, Loader2, Scissors, TrendingDown, XCircle } from "lucide-react";

type TrimSuggestion = {
  trimPct: number;
  newDailyMyr: number;
  dailySavedMyr: number;
  monthlySavedMyr: number;
  projConvLostPerMonth: number;
};
type Campaign = {
  campaignId: string;
  campaignName: string;
  outletName: string | null;
  dailyBudgetMyr: number;
  costMyr: number;
  clicks: number;
  conversions: number;
  costPerConv: number | null;
  cpc: number | null;
  avgDailySpendMyr: number;
  budgetCapped: boolean;
  efficiencyRatio: number | null;
  wasteMonthlyMyr: number;
  trim: TrimSuggestion;
  reclaimableMonthlyMyr: number;
  lastChange: { status: string; newDailyMyr: number; decidedAt: string } | null;
};
type Report = {
  windowDays: number;
  benchmarkCostPerConv: number | null;
  benchmarkOutlet: string | null;
  campaigns: Campaign[];
  summary: {
    totalMonthlySpendMyr: number;
    reclaimableWasteMyr: number;
    reclaimableTrimMyr: number;
    totalReclaimableMyr: number;
    projConvLostPerMonth: number;
    searchTermsAvailable: boolean;
  };
};

const myr = (n: number) => `RM${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs font-medium text-text-2">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone ?? "text-text"}`}>{value}</p>
      {sub && <p className="text-[11px] text-text-2">{sub}</p>}
    </div>
  );
}

export default function AdsOptimizerPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const load = () => {
    setLoading(true);
    fetch("/api/ads/optimizer?days=30")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setReport(d)))
      .catch(() => setError("Network error"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const campaigns = report?.campaigns ?? [];
  // Only campaigns with something to reclaim are actionable.
  const actionable = useMemo(() => campaigns.filter((c) => c.reclaimableMonthlyMyr > 0), [campaigns]);

  const decide = async (c: Campaign, action: "apply" | "reject") => {
    const key = c.campaignId;
    if (
      action === "apply" &&
      !window.confirm(
        `Cut ${c.campaignName} daily budget from ${myr(c.dailyBudgetMyr)} to ${myr(c.trim.newDailyMyr)}?\n\n` +
          `Reclaims ~${myr(c.trim.monthlySavedMyr)}/mo to redeploy elsewhere, giving up ~${c.trim.projConvLostPerMonth} ` +
          `conversions/mo (direction/call/menu clicks — a proxy, not sales). This changes the live campaign budget.`,
      )
    ) {
      return;
    }
    setBusy(key);
    setRowError((prev) => ({ ...prev, [key]: "" }));
    try {
      const res = await fetch("/api/ads/optimizer/apply-budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: c.campaignId,
          newDailyMyr: c.trim.newDailyMyr,
          action,
          monthlySavingMyr: c.trim.monthlySavedMyr,
          projConvLostPerMonth: c.trim.projConvLostPerMonth,
          reason:
            c.efficiencyRatio != null
              ? `cost/conv RM${c.costPerConv?.toFixed(2)} = ${c.efficiencyRatio}× fleet best (${report?.benchmarkOutlet ?? "benchmark"})`
              : null,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setRowError((prev) => ({ ...prev, [key]: d.error || "Failed" }));
      } else {
        setReport((prev) =>
          prev
            ? {
                ...prev,
                campaigns: prev.campaigns.map((x) =>
                  x.campaignId === c.campaignId
                    ? { ...x, lastChange: { status: d.status, newDailyMyr: c.trim.newDailyMyr, decidedAt: new Date().toISOString() } }
                    : x,
                ),
              }
            : prev,
        );
      }
    } catch {
      setRowError((prev) => ({ ...prev, [key]: "Network error" }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <Link href="/ads" className="mb-1 flex items-center gap-1 text-xs text-text-2 hover:text-text">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Google Ads
      </Link>
      <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Budget optimizer</h1>
      <p className="mt-0.5 text-sm text-text-2">
        How much ad spend you can safely reclaim and move to other marketing. Two tiers: <strong>waste</strong> (terms you
        already own on the map — near-zero conversion loss) and <strong>efficiency trims</strong> on the least cost-efficient
        campaigns (conversions given up shown explicitly). Every cut needs your approval before it touches Google Ads.
      </p>

      {loading ? (
        <p className="mt-8 flex items-center gap-2 text-sm text-text-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading spend + efficiency…
        </p>
      ) : error ? (
        <div className="mt-4 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger-text">{error}</div>
      ) : !report || campaigns.length === 0 ? (
        <div className="mt-6 rounded-xl border border-line bg-surface p-10 text-center">
          <Coins className="mx-auto h-10 w-10 text-text-2/30" />
          <p className="mt-3 text-sm text-text-2">
            No enabled campaigns with spend yet. Metrics flow in with the nightly ads sync.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Monthly ad spend" value={myr(report.summary.totalMonthlySpendMyr)} sub={`${report.windowDays}d run-rate`} />
            <Stat
              label="Reclaimable / month"
              value={myr(report.summary.totalReclaimableMyr)}
              sub="to redeploy to other marketing"
              tone="text-ok-text"
            />
            <Stat
              label="Waste (≈0 conv loss)"
              value={myr(report.summary.reclaimableWasteMyr)}
              sub="terms you own organically"
              tone="text-ok-text"
            />
            <Stat
              label="Efficiency trims"
              value={myr(report.summary.reclaimableTrimMyr)}
              sub={`−${report.summary.projConvLostPerMonth} conv/mo`}
              tone="text-warn-text"
            />
          </div>

          {!report.summary.searchTermsAvailable && (
            <div className="mt-4 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-xs text-warn-text">
              No search-term spend synced yet, so the <strong>waste</strong> tier is blind — only efficiency trims are shown.
              Run the ads backfill (<span className="font-mono">/api/cron/ads-backfill?from=…&amp;to=…</span>) to load the last
              30 days of search terms.
            </div>
          )}

          <p className="mt-5 text-xs font-medium text-text-2">
            Benchmark cost/conversion:{" "}
            <span className="text-text">
              {report.benchmarkCostPerConv != null ? `RM${report.benchmarkCostPerConv.toFixed(2)}` : "not enough data"}
            </span>
            {report.benchmarkOutlet ? ` · your best: ${report.benchmarkOutlet}` : ""}
          </p>

          <div className="mt-2 rounded-xl border border-line bg-surface p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-2">
                  <th className="py-1 pr-2">Campaign</th>
                  <th className="pr-2">Daily budget</th>
                  <th className="pr-2">Cost / conv</th>
                  <th className="pr-2">Reclaimable / mo</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody className="[&_td]:align-middle">
                {actionable.map((c) => {
                  const key = c.campaignId;
                  const applied = c.lastChange?.status === "applied";
                  const rejected = c.lastChange?.status === "rejected";
                  const canTrim = c.trim.trimPct > 0 && !applied && !rejected;
                  return (
                    <tr key={key} className="border-t border-line">
                      <td className="py-2 pr-2">
                        <span className="font-medium text-text">{c.outletName ?? c.campaignName}</span>
                        <span className="block text-[11px] text-text-2">
                          {c.conversions} conv · {c.clicks.toLocaleString()} clicks ({report.windowDays}d)
                          {c.budgetCapped ? " · budget-limited" : ""}
                        </span>
                      </td>
                      <td className="pr-2 tabular-nums">
                        <span className="font-medium text-text">{myr(c.dailyBudgetMyr)}</span>
                        {c.trim.trimPct > 0 && (
                          <span className="block text-[11px] text-warn-text">
                            → {myr(c.trim.newDailyMyr)} (−{Math.round(c.trim.trimPct * 100)}%)
                          </span>
                        )}
                      </td>
                      <td className="pr-2 tabular-nums">
                        {c.costPerConv != null ? (
                          <>
                            <span className="font-medium text-text">RM{c.costPerConv.toFixed(2)}</span>
                            {c.efficiencyRatio != null && (
                              <span
                                className={`block text-[11px] ${c.efficiencyRatio > 1.15 ? "text-warn-text" : "text-text-2"}`}
                              >
                                {c.efficiencyRatio}× best
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-text-2">no conv</span>
                        )}
                      </td>
                      <td className="pr-2 tabular-nums">
                        <span className="font-medium text-ok-text">{myr(c.reclaimableMonthlyMyr)}</span>
                        <span className="block text-[11px] text-text-2">
                          {c.wasteMonthlyMyr > 0 ? `${myr(c.wasteMonthlyMyr)} waste` : ""}
                          {c.wasteMonthlyMyr > 0 && c.trim.monthlySavedMyr > 0 ? " · " : ""}
                          {c.trim.monthlySavedMyr > 0 ? `${myr(c.trim.monthlySavedMyr)} trim, −${c.trim.projConvLostPerMonth} conv` : ""}
                        </span>
                      </td>
                      <td>
                        {c.lastChange ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-text-2">
                            {applied ? (
                              <>
                                <BadgeCheck className="h-3.5 w-3.5 text-ok-text" /> Cut to {myr(c.lastChange.newDailyMyr)}
                              </>
                            ) : rejected ? (
                              <>
                                <XCircle className="h-3.5 w-3.5" /> Dismissed
                              </>
                            ) : (
                              <>
                                <Ban className="h-3.5 w-3.5 text-danger-text" /> Failed — retry below
                              </>
                            )}
                          </span>
                        ) : null}
                        {canTrim && (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <button
                              onClick={() => decide(c, "apply")}
                              disabled={busy === key}
                              className="inline-flex items-center gap-1 rounded-lg bg-ok px-2.5 py-1 text-[11px] font-medium text-on-ink hover:bg-ok disabled:opacity-50"
                            >
                              {busy === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Scissors className="h-3 w-3" />}
                              Cut to {myr(c.trim.newDailyMyr)} · save ~{myr(c.trim.monthlySavedMyr)}/mo
                            </button>
                            <button
                              onClick={() => decide(c, "reject")}
                              disabled={busy === key}
                              className="rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-text hover:bg-sunken disabled:opacity-50"
                            >
                              Dismiss
                            </button>
                          </span>
                        )}
                        {!canTrim && c.wasteMonthlyMyr > 0 && !c.lastChange && (
                          <Link href="/reviews/geogrid/paid-organic" className="inline-flex items-center gap-1 text-[11px] font-medium text-ok-text hover:underline">
                            <TrendingDown className="h-3 w-3" /> Cut {myr(c.wasteMonthlyMyr)} waste via exclusions
                          </Link>
                        )}
                        {rowError[key] && <span className="block text-[11px] text-danger-text">{rowError[key]}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-text-2">
              <strong>Waste</strong> is reclaimed by excluding terms you own organically (approve on Paid × Organic) — the map
              already serves those for free. <strong>Efficiency trims</strong> cut the least cost-efficient campaigns toward
              your best cost/conversion, capped at −20% per step and never below 50% of budget (a visibility floor); the weekly
              loop re-measures and steps again. Conversions are direction/call/menu clicks — a proxy for interest, not sales.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
