"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, Ban, Coins, Loader2, ShieldCheck, XCircle } from "lucide-react";

type Verdict = "exclude_candidate" | "almost" | "keep" | "competitor" | "brand" | "no_data";
type OrganicSignal = { keyword: string; avgRank: number | null; pctTop3: number | null; scannedAt: string };
type Row = {
  outletId: string | null;
  outletName: string;
  campaignId: string;
  campaignName: string;
  searchTerm: string;
  clicks: number;
  costMyr: number;
  estMonthlySavingMyr: number;
  organic: OrganicSignal | null;
  verdict: Verdict;
  exclusion: { status: string; decidedAt: string } | null;
};
type Report = {
  windowDays: number;
  rows: Row[];
  summary: {
    totalCostMyr: number;
    candidateSavingMyr: number;
    counts: Record<Verdict, number>;
    termsWithSpend: number;
    lastTermDate: string | null;
  };
};

const VERDICT_META: Record<Verdict, { label: string; cls: string; hint: string }> = {
  exclude_candidate: {
    label: "Owned organically",
    cls: "border-emerald-200 bg-emerald-50 text-emerald-700",
    hint: "Top-3 across most of the grid — paying for what you already get free",
  },
  almost: { label: "Almost organic", cls: "border-amber-200 bg-amber-50 text-amber-700", hint: "Rank 4–10 — keep paying, push relevance/reviews" },
  keep: { label: "Keep paying", cls: "border-border bg-muted/40 text-muted-foreground", hint: "Paid is your only presence here" },
  competitor: { label: "Competitor brand", cls: "border-purple-200 bg-purple-50 text-purple-700", hint: "Conquesting — deliberate choice, not winnable organically" },
  brand: { label: "Own brand", cls: "border-blue-200 bg-blue-50 text-blue-700", hint: "Your own name — should be excluded or free" },
  no_data: { label: "No scan data", cls: "border-border bg-muted/40 text-muted-foreground", hint: "No geogrid scan covers this term yet" },
};

const myr = (n: number) => `RM${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone ?? "text-foreground"}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default function PaidOrganicPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [outletFilter, setOutletFilter] = useState("");
  const [verdictFilter, setVerdictFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // "<campaignId> <term>"
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const load = () => {
    setLoading(true);
    fetch("/api/ads/paid-organic?days=30")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setReport(d)))
      .catch(() => setError("Network error"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const rows = report?.rows ?? [];
  const outlets = useMemo(() => [...new Set(rows.map((r) => r.outletName))].sort(), [rows]);
  const visible = rows.filter(
    (r) => (!outletFilter || r.outletName === outletFilter) && (!verdictFilter || r.verdict === verdictFilter),
  );

  const decide = async (row: Row, action: "apply" | "reject") => {
    const key = `${row.campaignId} ${row.searchTerm}`;
    if (
      action === "apply" &&
      !window.confirm(
        `Exclude "${row.searchTerm}" from ${row.campaignName}?\n\nGoogle will stop showing your ads for this search (~${myr(row.estMonthlySavingMyr)}/mo redirected within the campaign budget). This changes the live campaign.`,
      )
    ) {
      return;
    }
    setBusy(key);
    setRowError((prev) => ({ ...prev, [key]: "" }));
    try {
      const res = await fetch("/api/ads/paid-organic/exclude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: row.campaignId,
          searchTerm: row.searchTerm,
          action,
          estMonthlySavingMyr: row.estMonthlySavingMyr,
          reason: row.organic
            ? `organic avg rank ${row.organic.avgRank?.toFixed(1)} · ${Math.round(row.organic.pctTop3 ?? 0)}% top-3 (scan ${row.organic.scannedAt})`
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
                rows: prev.rows.map((r) =>
                  r.campaignId === row.campaignId && r.searchTerm === row.searchTerm
                    ? { ...r, exclusion: { status: d.status, decidedAt: new Date().toISOString() } }
                    : r,
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
      <Link href="/reviews/geogrid" className="mb-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Geogrid
      </Link>
      <h1 className="font-heading text-2xl font-bold text-foreground">Paid × Organic</h1>
      <p className="text-sm text-muted-foreground">
        What each ad search term costs vs where you rank organically. Terms you own on the map are candidates to stop paying
        for — every exclusion needs your explicit approval before anything touches Google Ads.
      </p>

      {loading ? (
        <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading paid + organic data…
        </p>
      ) : error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-xl border border-border bg-white p-10 text-center">
          <Coins className="mx-auto h-10 w-10 text-muted-foreground/30" />
          <p className="mt-3 text-sm text-muted-foreground">
            No search-term spend synced yet. It starts flowing with the nightly ads sync — or run the ads backfill
            (<span className="font-mono text-xs">/api/cron/ads-backfill?from=…&amp;to=…</span>) to load the last 30 days now.
          </p>
        </div>
      ) : (
        report && (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label={`Paid spend (${report.windowDays}d)`} value={myr(report.summary.totalCostMyr)} sub={`${report.summary.termsWithSpend} search terms`} />
              <Stat label="Potential saving" value={myr(report.summary.candidateSavingMyr)} sub="per month, terms you own organically" tone="text-emerald-700" />
              <Stat label="Exclude candidates" value={String(report.summary.counts.exclude_candidate)} tone="text-emerald-700" />
              <Stat label="Data through" value={report.summary.lastTermDate ?? "–"} sub="latest synced day" />
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground">Outlet</label>
                <select value={outletFilter} onChange={(e) => setOutletFilter(e.target.value)} className="mt-1 rounded-lg border border-border bg-white px-3 py-2 text-sm">
                  <option value="">All outlets</option>
                  {outlets.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground">Verdict</label>
                <select value={verdictFilter} onChange={(e) => setVerdictFilter(e.target.value)} className="mt-1 rounded-lg border border-border bg-white px-3 py-2 text-sm">
                  <option value="">All verdicts</option>
                  {Object.entries(VERDICT_META).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-border bg-white p-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1 pr-2">Search term</th>
                    <th className="pr-2">Paid (30d)</th>
                    <th className="pr-2">Organic</th>
                    <th className="pr-2">Verdict</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody className="[&_td]:align-middle">
                  {visible.map((r) => {
                    const key = `${r.campaignId} ${r.searchTerm}`;
                    const v = VERDICT_META[r.verdict];
                    return (
                      <tr key={key} className="border-t border-border">
                        <td className="py-2 pr-2">
                          <span className="font-medium text-foreground">{r.searchTerm}</span>
                          <span className="block text-[11px] text-muted-foreground">{r.outletName}</span>
                        </td>
                        <td className="pr-2 tabular-nums">
                          <span className="font-medium text-foreground">{myr(r.costMyr)}</span>
                          <span className="block text-[11px] text-muted-foreground">{r.clicks.toLocaleString()} clicks</span>
                        </td>
                        <td className="pr-2 tabular-nums">
                          {r.organic ? (
                            <>
                              <span className="font-medium text-foreground">#{r.organic.avgRank?.toFixed(1) ?? ">20"}</span>
                              <span className="text-xs text-muted-foreground"> · {Math.round(r.organic.pctTop3 ?? 0)}% top-3</span>
                              <span className="block text-[11px] text-muted-foreground">
                                &ldquo;{r.organic.keyword}&rdquo; · {r.organic.scannedAt}
                              </span>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">no scan</span>
                          )}
                        </td>
                        <td className="pr-2">
                          <span title={v.hint} className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${v.cls}`}>
                            {v.label}
                          </span>
                        </td>
                        <td>
                          {r.exclusion ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                              {r.exclusion.status === "applied" ? (
                                <>
                                  <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" /> Excluded
                                </>
                              ) : r.exclusion.status === "rejected" ? (
                                <>
                                  <XCircle className="h-3.5 w-3.5" /> Dismissed
                                </>
                              ) : (
                                <>
                                  <Ban className="h-3.5 w-3.5 text-red-500" /> Failed — retry below
                                </>
                              )}
                            </span>
                          ) : null}
                          {r.verdict === "exclude_candidate" && r.exclusion?.status !== "applied" && r.exclusion?.status !== "rejected" && (
                            <span className="flex flex-wrap items-center gap-1.5">
                              <button
                                onClick={() => decide(r, "apply")}
                                disabled={busy === key}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                              >
                                {busy === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                                Approve exclusion · save ~{myr(r.estMonthlySavingMyr)}/mo
                              </button>
                              <button
                                onClick={() => decide(r, "reject")}
                                disabled={busy === key}
                                className="rounded-lg border border-border bg-white px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted/50 disabled:opacity-50"
                              >
                                Dismiss
                              </button>
                            </span>
                          )}
                          {rowError[key] && <span className="block text-[11px] text-red-600">{rowError[key]}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-muted-foreground">
                &ldquo;Owned organically&rdquo; = latest geogrid scan shows avg rank ≤3 with ≥70% of grid points in the top 3 — dominance
                across the area, not just at the storefront. Approving writes a negative keyword theme to the Smart campaign; the
                budget redistributes to terms you don&apos;t yet own. Savings are the term&apos;s trailing spend normalized to 30 days.
              </p>
            </div>
          </>
        )
      )}
    </div>
  );
}
