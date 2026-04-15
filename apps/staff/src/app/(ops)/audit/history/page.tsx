"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, CheckCircle2, Clock, Building2, Loader2 } from "lucide-react";
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
    <div className="px-4 py-4 space-y-4">
      <div>
        <Link href="/audit" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="h-4 w-4" />Back to Audits
        </Link>
        <h1 className="font-heading text-lg font-bold text-brand-dark">Audit History</h1>
      </div>

      {isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
        </div>
      )}

      {Object.entries(grouped).map(([date, items]) => (
        <div key={date}>
          <h2 className="mb-2 text-xs font-semibold text-gray-400">{date}</h2>
          <div className="space-y-2">
            {items.map((audit) => (
              <Link key={audit.id} href={`/audit/${audit.id}`}>
                <Card className="px-3 py-2.5 transition-all active:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${audit.status === "COMPLETED" ? "bg-green-100" : "bg-blue-100"}`}>
                      {audit.status === "COMPLETED"
                        ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                        : <Clock className="h-4 w-4 text-blue-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{audit.template.name}</p>
                      <p className="text-[10px] text-gray-400 flex items-center gap-1">
                        <Building2 className="h-2.5 w-2.5" />
                        {audit.outlet.name} · {audit.completedItems}/{audit.totalItems} items
                      </p>
                    </div>
                    {audit.overallScore !== null && (
                      <Badge className={`text-[10px] ${(audit.overallScore) >= 80 ? "bg-green-100 text-green-700" : (audit.overallScore) >= 60 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}>
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
          <p className="text-sm text-gray-500">No audit history</p>
        </Card>
      )}
    </div>
  );
}
