"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { CheckCircle2, Clock, Building2, Loader2 } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type AuditSummary = {
  id: string; date: string; status: string; overallScore: number | null;
  completedAt: string | null;
  template: { id: string; name: string; roleType: string };
  outlet: { id: string; name: string; code: string };
  totalItems: number; completedItems: number; progress: number;
};

export default function AuditHistoryPage() {
  const { data: audits, isLoading } = useFetch<AuditSummary[]>("/api/audits?status=all");

  // Group by date
  const grouped = (audits ?? []).reduce<Record<string, AuditSummary[]>>((acc, a) => {
    if (!acc[a.date]) acc[a.date] = [];
    acc[a.date].push(a);
    return acc;
  }, {});

  return (
    <div className="px-4 pb-6 space-y-4">
      <PageHeader title="Past audits" description="Every audit done, newest first." backHref="/audit" />

      {isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-brand-text" />
        </div>
      )}

      {Object.entries(grouped).map(([date, items]) => (
        <div key={date}>
          <h2 className="mb-2 text-xs font-semibold text-text-3">{date}</h2>
          <div className="space-y-2">
            {items.map((audit) => (
              <Link key={audit.id} href={`/audit/${audit.id}`}>
                <Card className="px-3 py-2.5 transition-all active:bg-sunken/60">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${audit.status === "COMPLETED" ? "bg-ok-soft" : "bg-info-soft"}`}>
                      {audit.status === "COMPLETED"
                        ? <CheckCircle2 className="h-4 w-4 text-ok-text" />
                        : <Clock className="h-4 w-4 text-info-text" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text truncate">{audit.template.name}</p>
                      <p className="text-[10px] text-text-3 flex items-center gap-1">
                        <Building2 className="h-2.5 w-2.5" />
                        {audit.outlet.name} · {audit.completedItems}/{audit.totalItems} items
                      </p>
                    </div>
                    {audit.overallScore !== null && (
                      <Badge className={`text-[10px] ${(audit.overallScore) >= 80 ? "bg-ok-soft text-ok-text" : (audit.overallScore) >= 60 ? "bg-warn-soft text-warn-text" : "bg-danger-soft text-danger-text"}`}>
                        {audit.overallScore}%
                      </Badge>
                    )}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      ))}

      {!isLoading && (!audits || audits.length === 0) && (
        <Card className="px-4 py-8 text-center">
          <p className="text-sm text-text-3">No audit history</p>
        </Card>
      )}
    </div>
  );
}
