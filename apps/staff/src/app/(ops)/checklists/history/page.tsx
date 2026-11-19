"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Clock, AlertCircle, Loader2, History } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";
import { PageHeader } from "@/components/page-header";

type Outlet = { id: string; code: string; name: string; type: string };

type ChecklistSummary = {
  id: string;
  date: string;
  shift: "OPENING" | "MIDDAY" | "CLOSING";
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  sop: { id: string; title: string; category: { name: string } };
  outlet: { id: string; code: string; name: string };
  completedBy: { id: string; name: string } | null;
  completedAt: string | null;
  totalItems: number;
  completedItems: number;
  progress: number;
};

const SHIFT_LABELS: Record<string, string> = {
  OPENING: "Opening",
  MIDDAY: "Midday",
  CLOSING: "Closing",
};

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; bg: string }> = {
  PENDING: { icon: Clock, color: "text-warn-text", bg: "bg-warn-soft" },
  IN_PROGRESS: { icon: AlertCircle, color: "text-info-text", bg: "bg-info-soft" },
  COMPLETED: { icon: CheckCircle2, color: "text-ok-text", bg: "bg-ok-soft" },
};

export default function ChecklistHistoryPage() {
  const { data: outlets } = useFetch<Outlet[]>("/api/outlets");
  const [selectedOutlet, setSelectedOutlet] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  useEffect(() => {
    if (outlets && outlets.length > 0 && !selectedOutlet) {
      setSelectedOutlet(outlets[0].id);
    }
  }, [outlets, selectedOutlet]);

  // Build query — no date filter = all history
  let queryUrl = selectedOutlet ? `/api/checklists?outletId=${selectedOutlet}` : null;
  if (queryUrl && selectedDate) queryUrl += `&date=${selectedDate}`;
  if (queryUrl && statusFilter !== "ALL") queryUrl += `&status=${statusFilter}`;

  const { data: checklists, isLoading } = useFetch<ChecklistSummary[]>(queryUrl);

  // Group by date
  const grouped = (checklists ?? []).reduce<Record<string, ChecklistSummary[]>>((acc, cl) => {
    const dateKey = cl.date.split("T")[0];
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(cl);
    return acc;
  }, {});

  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <div className="px-4 pb-6">
      <PageHeader title="Past checklists" description="Checklists done on earlier days." backHref="/checklists" />

      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <select
          value={selectedOutlet}
          onChange={(e) => setSelectedOutlet(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">Choose an outlet</option>
          {outlets?.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <Input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="w-auto"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="ALL">Any status</option>
          <option value="PENDING">Pending</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="COMPLETED">Completed</option>
        </select>
        {selectedDate && (
          <button
            onClick={() => setSelectedDate("")}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear date
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : sortedDates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12">
            <History className="h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">No checklist history found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {sortedDates.map((dateKey) => {
            const items = grouped[dateKey];
            const completed = items.filter((c) => c.status === "COMPLETED").length;
            const total = items.length;
            return (
              <div key={dateKey}>
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="text-sm font-semibold text-foreground">
                    {new Date(dateKey + "T00:00:00").toLocaleDateString("en-US", {
                      weekday: "long", year: "numeric", month: "long", day: "numeric",
                    })}
                  </h2>
                  <Badge variant="secondary" className="text-[10px]">
                    {completed}/{total} completed
                  </Badge>
                </div>
                <div className="space-y-2">
                  {items.map((cl) => {
                    const config = STATUS_CONFIG[cl.status];
                    const Icon = config.icon;
                    return (
                      <Link key={cl.id} href={`/checklists/${cl.id}`}>
                        <Card className="transition-shadow hover:shadow-md cursor-pointer">
                          <CardContent className="flex items-center gap-4 p-3">
                            <div className={`rounded-lg p-1.5 ${config.bg}`}>
                              <Icon className={`h-4 w-4 ${config.color}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="text-sm font-medium text-foreground truncate">{cl.sop.title}</h3>
                              <p className="text-[11px] text-muted-foreground">
                                {SHIFT_LABELS[cl.shift]} · {cl.sop.category.name}
                                {cl.completedBy && ` · by ${cl.completedBy.name}`}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <span className="text-sm font-bold">{cl.progress}%</span>
                              <p className="text-[10px] text-muted-foreground">
                                {cl.completedItems}/{cl.totalItems}
                              </p>
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
