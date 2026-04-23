"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, AlertTriangle, XCircle, Loader2,
  Building2, Shield, Clock,
} from "lucide-react";
import { useFetch } from "@/lib/use-fetch";
import Link from "next/link";

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
  critical: { icon: XCircle, color: "text-red-500", bg: "bg-red-50", border: "border-l-red-400", badge: "bg-red-100 text-red-700" },
  warning: { icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-50", border: "border-l-amber-400", badge: "bg-amber-100 text-amber-700" },
  ok: { icon: CheckCircle2, color: "text-green-500", bg: "bg-green-50", border: "border-l-green-400", badge: "bg-green-100 text-green-700" },
};

export default function CompliancePage() {
  const { data, isLoading } = useFetch<ComplianceData>("/api/ops/compliance");

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">SOP Compliance</h2>
        <p className="mt-0.5 text-sm text-gray-500">Check that all SOPs are properly scheduled across outlets</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-terracotta" /></div>
      ) : !data ? (
        <p className="text-sm text-gray-500">No data</p>
      ) : (
        <>
          {/* Summary */}
          <div className="grid gap-4 sm:grid-cols-4 mb-6">
            <Card><CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-terracotta/10 p-2"><Shield className="h-5 w-5 text-terracotta" /></div>
              <div><p className="text-2xl font-bold text-gray-900">{data.summary.coverageRate}%</p>
                <p className="text-xs text-gray-500">Coverage</p></div>
            </CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-green-100 p-2"><CheckCircle2 className="h-5 w-5 text-green-500" /></div>
              <div><p className="text-2xl font-bold text-gray-900">{data.summary.coveredSops}/{data.summary.totalSops}</p>
                <p className="text-xs text-gray-500">SOPs Covered</p></div>
            </CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 p-4">
              <div className={`rounded-lg p-2 ${data.summary.criticalGaps > 0 ? "bg-red-100" : "bg-gray-100"}`}>
                <XCircle className={`h-5 w-5 ${data.summary.criticalGaps > 0 ? "text-red-500" : "text-gray-400"}`} /></div>
              <div><p className="text-2xl font-bold text-gray-900">{data.summary.criticalGaps}</p>
                <p className="text-xs text-gray-500">Critical Gaps</p></div>
            </CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 p-4">
              <div className={`rounded-lg p-2 ${data.summary.warningGaps > 0 ? "bg-amber-100" : "bg-gray-100"}`}>
                <AlertTriangle className={`h-5 w-5 ${data.summary.warningGaps > 0 ? "text-amber-500" : "text-gray-400"}`} /></div>
              <div><p className="text-2xl font-bold text-gray-900">{data.summary.warningGaps}</p>
                <p className="text-xs text-gray-500">Warnings</p></div>
            </CardContent></Card>
          </div>

          {/* SOP list */}
          <div className="space-y-3">
            {data.sops.map((sop) => {
              const config = SEVERITY_CONFIG[sop.severity];
              const Icon = config.icon;
              return (
                <Card key={sop.sopId} className={`border-l-4 ${config.border}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Icon className={`h-4 w-4 ${config.color}`} />
                          <Link href={`/ops/sops/${sop.sopId}`} className="font-medium text-gray-900 hover:text-terracotta">
                            {sop.title}
                          </Link>
                          <Badge variant="secondary" className="text-[10px]">{sop.category}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-gray-400 flex items-center gap-3">
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
                          o.status === "ok" ? "bg-green-50 text-green-700" :
                          o.status === "warning" ? "bg-amber-50 text-amber-700" :
                          "bg-red-50 text-red-700"
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
    </div>
  );
}
