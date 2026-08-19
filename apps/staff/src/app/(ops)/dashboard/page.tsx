"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  FileText, Send, FileEdit, Tags, Building2, Loader2,
  ClipboardCheck, CheckCircle2, Clock,
} from "lucide-react";
import { useFetch } from "@/lib/use-fetch";
import Link from "next/link";

type Sop = {
  id: string;
  title?: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  _count: { sopOutlets: number };
};

type Category = { id: string; name: string; _count: { sops: number } };

type ChecklistSummary = {
  id: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  sop: { title: string; category: { name: string } };
  outlet: { name: string };
  totalItems: number;
  completedItems: number;
  progress: number;
};

export default function DashboardPage() {
  const { data: sops, isLoading: sopsLoading } = useFetch<Sop[]>("/api/sops");
  const { data: categories, isLoading: catsLoading } = useFetch<Category[]>("/api/sop-categories");

  // MYT date, not UTC — before 08:00 MYT a UTC date is still yesterday, so the
  // "today's checklists" fetch pulled the wrong day (matches the checklists page).
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
  const { data: todayChecklists, isLoading: clLoading } = useFetch<ChecklistSummary[]>(
    `/api/checklists?date=${today}`
  );

  const isLoading = sopsLoading || catsLoading || clLoading;

  const total = sops?.length ?? 0;
  const published = sops?.filter((s) => s.status === "PUBLISHED").length ?? 0;
  const drafts = sops?.filter((s) => s.status === "DRAFT").length ?? 0;
  const catCount = categories?.length ?? 0;
  const todayTotal = todayChecklists?.length ?? 0;
  const todayCompleted = todayChecklists?.filter((c) => c.status === "COMPLETED").length ?? 0;
  const todayPending = todayChecklists?.filter((c) => c.status !== "COMPLETED").length ?? 0;

  const sopStats = [
    { label: "Total SOPs", value: total, icon: FileText, color: "text-terracotta", bg: "bg-terracotta/10", href: "/sops" },
    { label: "Published", value: published, icon: Send, color: "text-green-600", bg: "bg-green-100", href: "/sops" },
    { label: "Drafts", value: drafts, icon: FileEdit, color: "text-yellow-600", bg: "bg-yellow-100", href: "/sops" },
    { label: "Categories", value: catCount, icon: Tags, color: "text-blue-600", bg: "bg-blue-100", href: "/categories" },
  ];

  const checklistStats = [
    { label: "Today's Checklists", value: todayTotal, icon: ClipboardCheck, color: "text-terracotta", bg: "bg-terracotta/10", href: "/checklists" },
    { label: "Completed", value: todayCompleted, icon: CheckCircle2, color: "text-green-600", bg: "bg-green-100", href: "/checklists" },
    { label: "Pending", value: todayPending, icon: Clock, color: "text-yellow-600", bg: "bg-yellow-100", href: "/checklists" },
  ];

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Outlet Operations overview</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Today's Checklists */}
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">Today&apos;s Checklists</h2>
          <div className="grid gap-4 sm:grid-cols-3 mb-8">
            {checklistStats.map((stat) => (
              <Link key={stat.label} href={stat.href}>
                <Card className="transition-shadow hover:shadow-md cursor-pointer">
                  <CardContent className="flex items-center gap-4 p-5">
                    <div className={`rounded-lg p-2.5 ${stat.bg}`}>
                      <stat.icon className={`h-5 w-5 ${stat.color}`} />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                      <p className="text-xs text-muted-foreground">{stat.label}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {/* Incomplete checklists */}
          {todayChecklists && todayChecklists.filter((c) => c.status !== "COMPLETED").length > 0 && (
            <div className="mb-8">
              <h2 className="mb-3 font-medium text-foreground">Needs Attention</h2>
              <div className="space-y-2">
                {todayChecklists
                  .filter((c) => c.status !== "COMPLETED")
                  .map((cl) => (
                    <Link key={cl.id} href={`/checklists/${cl.id}`}>
                      <Card className="transition-shadow hover:shadow-sm cursor-pointer border-l-4 border-l-yellow-400">
                        <CardContent className="flex items-center justify-between p-3">
                          <div>
                            <span className="text-sm font-medium">{cl.sop.title}</span>
                            <p className="text-[11px] text-muted-foreground">{cl.outlet.name} · {cl.sop.category.name}</p>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-bold">{cl.progress}%</span>
                            <p className="text-[10px] text-muted-foreground">{cl.completedItems}/{cl.totalItems}</p>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
              </div>
            </div>
          )}

          {/* SOP Stats */}
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">SOPs</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {sopStats.map((stat) => (
              <Link key={stat.label} href={stat.href}>
                <Card className="transition-shadow hover:shadow-md cursor-pointer">
                  <CardContent className="flex items-center gap-4 p-5">
                    <div className={`rounded-lg p-2.5 ${stat.bg}`}>
                      <stat.icon className={`h-5 w-5 ${stat.color}`} />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                      <p className="text-xs text-muted-foreground">{stat.label}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
