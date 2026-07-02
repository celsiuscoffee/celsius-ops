"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, RefreshCw, SearchCheck, Tags } from "lucide-react";

type Surface = "categories" | "services" | "description";
type KeywordCoverage = {
  keyword: string;
  clicks: number;
  lever: "category" | "menu" | "geo";
  wantedCategory: string | null;
  foundIn: Surface[];
  status: "strong" | "weak" | "missing";
  fix: string | null;
};
type Report = {
  connected: boolean;
  error?: string;
  outletName?: string;
  profile?: {
    title: string | null;
    primaryCategory: string | null;
    additionalCategories: string[];
    descriptionChars: number;
    servicesCount: number;
    hasWebsite: boolean;
    hasPhone: boolean;
    hasHours: boolean;
  };
  keywords?: KeywordCoverage[];
  suggestedCategories?: string[];
  summary?: { strong: number; weak: number; missing: number };
};
type Outlet = { id: string; name: string };

const STATUS_STYLE: Record<KeywordCoverage["status"], string> = {
  strong: "border-emerald-200 bg-emerald-50 text-emerald-700",
  weak: "border-amber-200 bg-amber-50 text-amber-700",
  missing: "border-red-200 bg-red-50 text-red-700",
};
const STATUS_LABEL: Record<KeywordCoverage["status"], string> = {
  strong: "Covered",
  weak: "Weak",
  missing: "Missing",
};
const LEVER_LABEL: Record<KeywordCoverage["lever"], string> = {
  category: "Category",
  menu: "Menu/Service",
  geo: "Geo/Description",
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone ?? "text-foreground"}`}>{value}</p>
    </div>
  );
}

export default function RelevanceAuditPage() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings/outlets")
      .then((r) => r.json())
      .then((d) => {
        const list: Outlet[] = (Array.isArray(d) ? d : d.outlets ?? []).map((o: Outlet) => ({ id: o.id, name: o.name }));
        setOutlets(list);
        if (list[0]) setOutletId(list[0].id);
      })
      .catch(() => setOutlets([]));
  }, []);

  const load = useCallback(async (oid: string) => {
    if (!oid) return;
    setLoading(true);
    setError("");
    setReport(null);
    try {
      const res = await fetch(`/api/geogrid/relevance?outletId=${oid}`);
      const d = await res.json();
      if (!res.ok || d.error) setError(d.error || "Audit failed");
      else setReport(d);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(outletId);
  }, [outletId, load]);

  const kws = report?.keywords ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link href="/reviews/geogrid" className="mb-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Geogrid
      </Link>
      <h1 className="font-heading text-2xl font-bold text-foreground">Keyword Relevance Audit</h1>
      <p className="text-sm text-muted-foreground">
        Your live Google Business Profile vs the target keywords. Reviews widen how far you rank; <em>these</em> fields decide whether you rank for a term at all.
      </p>

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground">Outlet</label>
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="mt-1 rounded-lg border border-border bg-white px-3 py-2 text-sm">
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => load(outletId)}
          disabled={loading || !outletId}
          className="flex items-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {loading ? "Auditing…" : "Re-run audit"}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</div>
      )}

      {report?.profile && (
        <>
          {/* Profile snapshot — what Google currently reads */}
          <div className="mt-6 rounded-xl border border-border bg-white p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
              <SearchCheck className="h-4 w-4" /> Live profile · {report.profile.title ?? report.outletName}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span>
                <span className="font-medium text-foreground">Primary category:</span>{" "}
                {report.profile.primaryCategory ?? <span className="text-red-600">not set</span>}
              </span>
              <span>
                <span className="font-medium text-foreground">Additional:</span>{" "}
                {report.profile.additionalCategories.length ? report.profile.additionalCategories.join(", ") : <span className="text-red-600">none</span>}
              </span>
              <span>
                <span className="font-medium text-foreground">Description:</span>{" "}
                {report.profile.descriptionChars > 0 ? `${report.profile.descriptionChars} chars` : <span className="text-red-600">empty</span>}
              </span>
              <span>
                <span className="font-medium text-foreground">Services/products:</span>{" "}
                {report.profile.servicesCount > 0 ? report.profile.servicesCount : <span className="text-red-600">none</span>}
              </span>
              <span>{report.profile.hasHours ? "Hours ✓" : <span className="text-red-600">Hours ✗</span>}</span>
              <span>{report.profile.hasWebsite ? "Website ✓" : <span className="text-red-600">Website ✗</span>}</span>
              <span>{report.profile.hasPhone ? "Phone ✓" : <span className="text-red-600">Phone ✗</span>}</span>
            </div>
          </div>

          {/* The score */}
          {report.summary && (
            <div className="mt-4 grid grid-cols-3 gap-3">
              <Stat label="Covered" value={String(report.summary.strong)} tone="text-emerald-700" />
              <Stat label="Weak (wrong surface)" value={String(report.summary.weak)} tone="text-amber-700" />
              <Stat label="Missing" value={String(report.summary.missing)} tone="text-red-700" />
            </div>
          )}

          {/* One-shot category fix */}
          {(report.suggestedCategories?.length ?? 0) > 0 && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-900">
                <Tags className="h-4 w-4" /> Add these categories — the single highest-leverage edit
              </div>
              <p className="mt-1 text-xs text-emerald-800">
                Edit profile → Business category. Each one unlocks every keyword mapped to it below. Only add what the outlet genuinely is.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {report.suggestedCategories!.map((c) => (
                  <span key={c} className="rounded-full border border-emerald-300 bg-white px-2.5 py-0.5 text-xs font-medium text-emerald-900">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Per-keyword coverage */}
          <div className="mt-4 rounded-xl border border-border bg-white p-4">
            <div className="mb-2 text-sm font-medium text-foreground">Keyword coverage ({kws.length})</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-2">Keyword</th>
                  <th className="pr-2">Demand</th>
                  <th className="pr-2">Lever</th>
                  <th className="pr-2">Status</th>
                  <th>Fix</th>
                </tr>
              </thead>
              <tbody>
                {kws.map((k) => (
                  <tr key={k.keyword} className="border-t border-border align-top">
                    <td className="py-2 pr-2 font-medium text-foreground">{k.keyword}</td>
                    <td className="pr-2 text-muted-foreground">{k.clicks > 0 ? k.clicks.toLocaleString() : "–"}</td>
                    <td className="pr-2 text-xs text-muted-foreground">{LEVER_LABEL[k.lever]}</td>
                    <td className="pr-2">
                      <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[k.status]}`}>
                        {STATUS_LABEL[k.status]}
                        {k.status === "weak" && k.foundIn.length > 0 ? ` · in ${k.foundIn.join("+")}` : ""}
                      </span>
                    </td>
                    <td className="text-xs text-muted-foreground">{k.fix ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-muted-foreground">
              &ldquo;Covered&rdquo; = the term is on the surface that ranks it (category terms → you hold the category; menu terms → a
              service/product; geo terms → the description). &ldquo;Weak&rdquo; = mentioned somewhere, but not where it counts. Apply the
              fixes, then watch the geogrid trend for these exact keywords.
            </p>
          </div>
        </>
      )}

      {!report?.profile && !error && !loading && (
        <div className="mt-6 rounded-xl border border-border bg-white p-10 text-center">
          <SearchCheck className="mx-auto h-10 w-10 text-muted-foreground/30" />
          <p className="mt-3 text-sm text-muted-foreground">Pick an outlet to audit its profile against the target keywords.</p>
        </div>
      )}
    </div>
  );
}
