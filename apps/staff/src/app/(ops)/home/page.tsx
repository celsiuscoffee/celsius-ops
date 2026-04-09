"use client";

/* eslint-disable @next/next/no-img-element */

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ClipboardCheck,
  Package,
  ArrowRight,
  Loader2,
  Trash2,
  ArrowLeftRight,
  CheckCircle2,
  Clock,
  AlertCircle,
} from "lucide-react";

type UserProfile = {
  id: string;
  name: string;
  role: string;
  outletId: string | null;
  outletName?: string | null;
};

type ChecklistSummary = {
  id: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  sop: { title: string; category: { name: string } };
  totalItems: number;
  completedItems: number;
  progress: number;
};

type DashboardData = {
  stockCheckDone: boolean;
  lastCheckTime: string | null;
  deliveriesExpected: number;
  deliverySuppliers: string[];
};

export default function HomePage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [checklists, setChecklists] = useState<ChecklistSummary[] | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.id) setUser(data);

        const today = new Date().toISOString().split("T")[0];
        const clFetch = fetch(`/api/checklists?date=${today}&mine=true`).then((r) => r.json());
        const dashFetch = data.outletId
          ? fetch(`/api/dashboard?outletId=${data.outletId}`).then((r) => r.ok ? r.json() : null)
          : Promise.resolve(null);

        return Promise.all([clFetch, dashFetch]);
      })
      .then(([cls, dash]) => {
        if (Array.isArray(cls)) setChecklists(cls);
        if (dash) setDashboard(dash);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateStr = now.toLocaleDateString("en-MY", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const isMorning = hour >= 6 && hour < 12;

  const pendingChecklists = checklists?.filter((c) => c.status !== "COMPLETED") ?? [];
  const completedCount = checklists?.filter((c) => c.status === "COMPLETED").length ?? 0;
  const totalCount = checklists?.length ?? 0;

  const formatTimeAgo = (iso: string | null) => {
    if (!iso) return "Never";
    const diff = Date.now() - new Date(iso).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return "Just now";
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? "Yesterday" : `${days}d ago`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <img
            src="/images/celsius-logo-sm.jpg"
            alt="Celsius Coffee"
            width={40}
            height={40}
            className="rounded-lg"
          />
          <div>
            <h1 className="font-heading text-lg font-bold text-brand-dark">
              {greeting}, {user?.name || "there"}
            </h1>
            <p className="text-sm text-gray-500">
              {user?.outletName && <>{user.outletName} &middot; </>}{dateStr}
            </p>
          </div>
        </div>

        {/* Priority Cards */}
        <div className="space-y-2">
          {/* Stock check reminder */}
          {dashboard && !dashboard.stockCheckDone && (
            <Link href="/stock-count">
              <Card className={`px-4 py-3 transition-all ${
                isMorning
                  ? "border-terracotta bg-terracotta/5 ring-1 ring-terracotta/20"
                  : "border-terracotta/30 bg-terracotta/5"
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-terracotta/10">
                      <ClipboardCheck className="h-5 w-5 text-terracotta" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-terracotta-dark">
                        {isMorning ? "Start daily stock check" : "Daily check not done"}
                      </p>
                      <p className="text-xs text-terracotta/60">
                        Last: {formatTimeAgo(dashboard.lastCheckTime)}
                      </p>
                    </div>
                  </div>
                  {isMorning && <Badge className="bg-terracotta text-[10px]">Do First</Badge>}
                  <ArrowRight className="h-4 w-4 text-terracotta/50" />
                </div>
              </Card>
            </Link>
          )}

          {/* Deliveries expected */}
          {dashboard && dashboard.deliveriesExpected > 0 && (
            <Link href="/receiving">
              <Card className="border-blue-200 bg-blue-50 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100">
                      <Package className="h-5 w-5 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-blue-700">
                        {dashboard.deliveriesExpected} deliveries expected
                      </p>
                      <p className="text-xs text-blue-400">
                        {dashboard.deliverySuppliers.slice(0, 3).join(" & ")}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-blue-300" />
                </div>
              </Card>
            </Link>
          )}

          {/* Checklist priority card */}
          {pendingChecklists.length > 0 && (
            <Link href="/checklists">
              <Card className="border-amber-200 bg-amber-50 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100">
                      <AlertCircle className="h-5 w-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-amber-700">
                        {pendingChecklists.length} checklist{pendingChecklists.length !== 1 ? "s" : ""} pending
                      </p>
                      <p className="text-xs text-amber-500">
                        {completedCount}/{totalCount} completed today
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-amber-300" />
                </div>
              </Card>
            </Link>
          )}

          {/* All done */}
          {dashboard?.stockCheckDone && checklists && checklists.length > 0 && pendingChecklists.length === 0 && dashboard.deliveriesExpected === 0 && (
            <Card className="border-green-200 bg-green-50 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-100">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-green-700">All tasks done!</p>
                  <p className="text-xs text-green-500">Stock checked · {totalCount} checklists completed</p>
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* Pending checklist items */}
        {pendingChecklists.length > 0 && (
          <div>
            <h2 className="mb-2 text-sm font-semibold text-gray-900">Checklists to Complete</h2>
            <div className="space-y-2">
              {pendingChecklists.slice(0, 3).map((cl) => {
                const StatusIcon = cl.status === "IN_PROGRESS" ? AlertCircle : Clock;
                const statusColor = cl.status === "IN_PROGRESS" ? "text-blue-500" : "text-yellow-500";
                return (
                  <Link key={cl.id} href={`/checklists/${cl.id}`}>
                    <Card className="px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5 flex-1 min-w-0">
                          <StatusIcon className={`h-4 w-4 shrink-0 ${statusColor}`} />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{cl.sop.title}</p>
                            <p className="text-[10px] text-gray-400">{cl.sop.category.name} · {cl.completedItems}/{cl.totalItems} items</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-bold text-gray-600">{cl.progress}%</span>
                          <ArrowRight className="h-3.5 w-3.5 text-gray-300" />
                        </div>
                      </div>
                    </Card>
                  </Link>
                );
              })}
              {pendingChecklists.length > 3 && (
                <Link href="/checklists" className="block text-center text-xs text-terracotta py-1">
                  +{pendingChecklists.length - 3} more →
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Quick actions */}
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Quick Actions</h2>
          <div className="grid grid-cols-4 gap-2">
            {[
              { href: "/stock-count", icon: ClipboardCheck, label: "Check" },
              { href: "/receiving", icon: Package, label: "Receive" },
              { href: "/wastage", icon: Trash2, label: "Wastage" },
              { href: "/transfers", icon: ArrowLeftRight, label: "Transfer" },
            ].map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.label}
                  href={action.href}
                  className="flex flex-col items-center gap-1 rounded-xl border border-gray-200 bg-white py-3 text-gray-600 transition-colors hover:bg-terracotta/5 hover:text-terracotta"
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-[10px] font-medium">{action.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
