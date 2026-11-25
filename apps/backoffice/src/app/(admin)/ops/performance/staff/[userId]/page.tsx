"use client";

import { useState, use } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, CheckCircle2, Clock, Camera, TrendingUp,
  Loader2, ClipboardCheck, AlertCircle,
} from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

 

type PerformanceData = {
  summary: {
    totalChecklists: number;
    completedChecklists: number;
    completionRate: number;
    totalItems: number;
    itemsWithPhotos: number;
    photoRate: number;
  };
  staffBreakdown: {
    id: string; name: string; role: string;
    total: number; completed: number; completionRate: number;
    items: number; completedItems: number; photos: number; photoRate: number;
  }[];
  dailyTrend: { date: string; total: number; completed: number }[];
  incomplete: {
    id: string; sopTitle: string; category: string; outlet: string;
    assignedTo: string; date: string; shift: string;
    itemsCompleted: number; totalItems: number;
  }[];
};

export default function StaffPerformancePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const [from, setFrom] = useState(() => {
    const d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return d.toISOString().split("T")[0];
  });
  const [to, setTo] = useState(() => new Date().toISOString().split("T")[0]);

  const { data, isLoading } = useFetch<PerformanceData>(
    `/api/ops/performance?userId=${userId}&from=${from}&to=${to}`
  );

  const staff = data?.staffBreakdown?.[0];

  return (
    <div className="px-4 pt-6 pb-10 md:px-8">
      <div className="mb-6">
        <Link href="/ops/performance" className="inline-flex items-center gap-1 text-sm text-text-2 hover:text-text-2 mb-3">
          <ArrowLeft className="h-4 w-4" />Back to Performance
        </Link>
        <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">
          {staff?.name ?? "Staff"}: checklists
        </h1>
        {staff && (
          <p className="mt-0.5 text-sm text-text-2">{staff.role}</p>
        )}
      </div>

      {/* Date range */}
      <div className="mb-6 flex items-center gap-2">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
        <span className="text-sm text-text-3">to</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-brand-text" />
        </div>
      ) : !data || !staff ? (
        <p className="text-sm text-text-2">No data for this staff member in the selected period.</p>
      ) : (
        <>
          {/* Stats */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
            {[
              { label: "Checklists", value: `${staff.completed}/${staff.total}`, icon: ClipboardCheck, color: "text-brand-text", bg: "bg-brand-soft" },
              { label: "Completion Rate", value: `${staff.completionRate}%`, icon: TrendingUp, color: staff.completionRate >= 80 ? "text-ok-text" : "text-warn-text", bg: staff.completionRate >= 80 ? "bg-ok-soft" : "bg-warn-soft" },
              { label: "Items Completed", value: `${staff.completedItems}/${staff.items}`, icon: CheckCircle2, color: "text-info-text", bg: "bg-info-soft" },
              { label: "Photo Compliance", value: `${staff.photoRate}%`, icon: Camera, color: "text-info-text", bg: "bg-info-soft" },
            ].map((stat) => (
              <Card key={stat.label}>
                <CardContent className="flex items-center gap-4 p-5">
                  <div className={`rounded-lg p-2.5 ${stat.bg}`}>
                    <stat.icon className={`h-5 w-5 ${stat.color}`} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-text">{stat.value}</p>
                    <p className="text-xs text-text-2">{stat.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Daily trend */}
          {data.dailyTrend.length > 0 && (
            <Card className="mb-8">
              <CardContent className="p-5">
                <h3 className="text-sm font-semibold text-text mb-4">Daily Activity</h3>
                <div className="flex items-end gap-1 h-32">
                  {data.dailyTrend.map((d) => {
                    const rate = d.total > 0 ? (d.completed / d.total) * 100 : 0;
                    return (
                      <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                        <span className="text-[9px] text-text-3">{d.completed}/{d.total}</span>
                        <div className="w-full bg-sunken rounded-t relative" style={{ height: "80px" }}>
                          <div
                            className={`absolute bottom-0 w-full rounded-t transition-all ${rate === 100 ? "bg-ok" : "bg-ink"}`}
                            style={{ height: `${rate}%` }}
                          />
                        </div>
                        <span className="text-[9px] text-text-3">
                          {new Date(d.date + "T00:00:00Z").toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short" })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Incomplete checklists */}
          {data.incomplete.length > 0 && (
            <Card>
              <CardContent className="p-5">
                <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-warn-text" />Incomplete Checklists
                </h3>
                <div className="space-y-2">
                  {data.incomplete.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 rounded-lg border border-line p-3">
                      <Clock className="h-4 w-4 text-warn-text shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text">{item.sopTitle}</p>
                        <p className="text-[10px] text-text-3">
                          {item.outlet} · {item.shift} · {new Date(item.date).toLocaleDateString("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short" })}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[10px] text-warn-text border-warn/30">
                        {item.itemsCompleted}/{item.totalItems}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
