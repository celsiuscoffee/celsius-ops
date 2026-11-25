"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, AlertTriangle, XCircle, Loader2,
  Building2, Shield, Clock,
} from "lucide-react";
import { useFetch } from "@/lib/use-fetch";
import Link from "next/link";
import { useState } from "react";

type OutletStatus = {
  outletId: string; outletName: string; outletCode: string;
  status: "ok" | "warning" | "missing";
  scheduledTimesPerDay: number; hasStaff: boolean; message: string;
};

type SopCompliance = {
  sopId: string; title: string; category: string;
  expectedRecurrence: string; expectedTimesPerDay: number;
  appliesToAllOutlets: boolean;
  outlets: OutletStatus[];
  severity: "ok" | "warning" | "critical";
};

type ComplianceData = {
  summary: {
    totalSops: number; coveredSops: number; coverageRate: number;
    totalGaps: number; criticalGaps: number; warningGaps: number;
    totalOutlets: number;
  };
  sops: SopCompliance[];
};

const RECURRENCE_LABELS: Record<string, string> = {
  SHIFT: "Per shift", SPECIFIC_TIMES: "Specific times", HOURLY: "Hourly",
};

const SEVERITY_CONFIG = {
  critical: { icon: XCircle, color: "text-danger-text", bg: "bg-danger-soft", border: "border-l-danger/30", badge: "bg-danger-soft text-danger-text" },
  warning: { icon: AlertTriangle, color: "text-warn-text", bg: "bg-warn-soft", border: "border-l-warn/30", badge: "bg-warn-soft text-warn-text" },
  ok: { icon: CheckCircle2, color: "text-ok-text", bg: "bg-ok-soft", border: "border-l-ok/30", badge: "bg-ok-soft text-ok-text" },
};

/**
 * Coverage: is every published SOP scheduled at every outlet it applies to?
 * Was its own page (/ops/compliance, linked from nowhere); now the top of SOP
 * Schedules, where the gaps are fixed (restructure step 5, 17 Nov 2026).
 * Shows the gaps; covered SOPs are one tap away.
 */
export function SopCoverage() {
  const { data, isLoading } = useFetch<ComplianceData>("/api/ops/compliance");
  const [showCovered, setShowCovered] = useState(false);
  const shown = data ? data.sops.filter((s) => showCovered || s.severity !== "ok") : [];

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-text">Coverage</h2>
          <p className="mt-0.5 text-sm text-text-3">Is every SOP scheduled at every outlet it applies to?</p>
        </div>
        {data && data.summary.coveredSops > 0 && (
          <button type="button" onClick={() => setShowCovered((v) => !v)} className="text-xs font-medium text-text-3 underline underline-offset-2 hover:text-text">
            {showCovered ? "Show gaps only" : `Show covered SOPs too (${data.summary.coveredSops})`}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-text" /></div>
      ) : !data ? (
        <p className="text-sm text-text-2">No data</p>
      ) : (
        <>
          {/* Summary */}
          <div className="grid gap-4 sm:grid-cols-4 mb-6">
            <Card><CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-brand-soft p-2"><Shield className="h-5 w-5 text-brand-text" /></div>
              <div><p className="text-2xl font-bold text-text">{data.summary.coverageRate}%</p>
                <p className="text-xs text-text-2">Coverage</p></div>
            </CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-ok-soft p-2"><CheckCircle2 className="h-5 w-5 text-ok-text" /></div>
              <div><p className="text-2xl font-bold text-text">{data.summary.coveredSops}/{data.summary.totalSops}</p>
                <p className="text-xs text-text-2">SOPs Covered</p></div>
            </CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 p-4">
              <div className={`rounded-lg p-2 ${data.summary.criticalGaps > 0 ? "bg-danger-soft" : "bg-sunken"}`}>
                <XCircle className={`h-5 w-5 ${data.summary.criticalGaps > 0 ? "text-danger-text" : "text-text-3"}`} /></div>
              <div><p className="text-2xl font-bold text-text">{data.summary.criticalGaps}</p>
                <p className="text-xs text-text-2">Critical Gaps</p></div>
            </CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 p-4">
              <div className={`rounded-lg p-2 ${data.summary.warningGaps > 0 ? "bg-warn-soft" : "bg-sunken"}`}>
                <AlertTriangle className={`h-5 w-5 ${data.summary.warningGaps > 0 ? "text-warn-text" : "text-text-3"}`} /></div>
              <div><p className="text-2xl font-bold text-text">{data.summary.warningGaps}</p>
                <p className="text-xs text-text-2">Warnings</p></div>
            </CardContent></Card>
          </div>

          {/* SOP list: gaps first, covered on request */}
          {shown.length === 0 && (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-text-3">Every SOP is scheduled where it applies.</p>
          )}
          <div className="space-y-3">
            {shown.map((sop) => {
              const config = SEVERITY_CONFIG[sop.severity];
              const Icon = config.icon;
              return (
                <Card key={sop.sopId} className={`border-l-4 ${config.border}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Icon className={`h-4 w-4 ${config.color}`} />
                          <Link href={`/ops/sops/${sop.sopId}`} className="font-medium text-text hover:text-brand-text">
                            {sop.title}
                          </Link>
                          <Badge variant="secondary" className="text-[10px]">{sop.category}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-text-3 flex items-center gap-3">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {RECURRENCE_LABELS[sop.expectedRecurrence]} · {sop.expectedTimesPerDay}x/day
                          </span>
                          {sop.appliesToAllOutlets && (
                            <span className="flex items-center gap-1">
                              <Building2 className="h-3 w-3" />All outlets
                            </span>
                          )}
                        </p>
                      </div>
                      <Badge className={`text-[10px] ${config.badge}`}>
                        {sop.severity === "ok" ? "Covered" : sop.severity === "warning" ? "Under-scheduled" : "Missing"}
                      </Badge>
                    </div>

                    {/* Outlet breakdown */}
                    <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
                      {sop.outlets.map((o) => (
                        <div key={o.outletId} className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs ${
                          o.status === "ok" ? "bg-ok-soft text-ok-text" :
                          o.status === "warning" ? "bg-warn-soft text-warn-text" :
                          "bg-danger-soft text-danger-text"
                        }`}>
                          {o.status === "ok" ? <CheckCircle2 className="h-3 w-3 shrink-0" /> :
                           o.status === "warning" ? <AlertTriangle className="h-3 w-3 shrink-0" /> :
                           <XCircle className="h-3 w-3 shrink-0" />}
                          <span className="font-medium truncate">{o.outletName}</span>
                          <span className="ml-auto shrink-0">{o.message}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
