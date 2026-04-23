"use client";

import { useFetch } from "@/lib/use-fetch";
import { AlertTriangle, CheckCircle2, Clock, CalendarOff, CalendarDays, Banknote, Bot, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type DashboardData = {
  flaggedAttendance: number;
  escalatedLeave: number;
  scheduleStatus: string;
  payrollStatus: string;
  lastAgentRun: {
    status: string;
    completed_at: string;
    items_processed: number;
    items_flagged: number;
    items_auto_approved: number;
  } | null;
};

export default function HRDashboardPage() {
  const { data, mutate } = useFetch<DashboardData>("/api/hr/dashboard");
  const [processing, setProcessing] = useState(false);

  const runProcessor = async () => {
    setProcessing(true);
    try {
      await fetch("/api/hr/attendance/process", { method: "POST" });
      mutate();
    } finally {
      setProcessing(false);
    }
  };

  const cards = [
    {
      label: "Attendance Flags",
      value: data?.flaggedAttendance ?? "—",
      icon: Clock,
      href: "/hr/attendance",
      color: (data?.flaggedAttendance ?? 0) > 0 ? "text-red-600 bg-red-50" : "text-green-600 bg-green-50",
      subtitle: (data?.flaggedAttendance ?? 0) > 0 ? "Need review" : "All clear",
    },
    {
      label: "Leave Escalated",
      value: data?.escalatedLeave ?? "—",
      icon: CalendarOff,
      href: "/hr/leave",
      color: (data?.escalatedLeave ?? 0) > 0 ? "text-amber-600 bg-amber-50" : "text-green-600 bg-green-50",
      subtitle: (data?.escalatedLeave ?? 0) > 0 ? "AI needs your input" : "All clear",
    },
    {
      label: "Schedule",
      value: data?.scheduleStatus === "published" ? "Published" : data?.scheduleStatus === "ai_generated" ? "Ready" : "—",
      icon: CalendarDays,
      href: "/hr/schedules",
      color: data?.scheduleStatus === "published" ? "text-green-600 bg-green-50" : "text-blue-600 bg-blue-50",
      subtitle: data?.scheduleStatus === "published" ? "This week" : "Not generated",
    },
    {
      label: "Payroll",
      value: data?.payrollStatus === "confirmed" ? "Confirmed" : data?.payrollStatus === "ai_computed" ? "Ready" : "—",
      icon: Banknote,
      href: "/hr/payroll",
      color: data?.payrollStatus === "confirmed" ? "text-green-600 bg-green-50" : "text-gray-600 bg-gray-50",
      subtitle: data?.payrollStatus === "not_started" ? "Not started" : data?.payrollStatus || "",
    },
  ];

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">HR Dashboard</h1>
          <p className="text-sm text-muted-foreground">AI-managed, human-reviewed</p>
        </div>
        <button
          onClick={runProcessor}
          disabled={processing}
          className="flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
        >
          {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
          Run Attendance AI
        </button>
      </div>

      {/* Status Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.label}
              href={card.href}
              className="rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <div className={`rounded-lg p-2 ${card.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <span className="text-3xl font-bold">{card.value}</span>
              </div>
              <p className="mt-3 font-medium">{card.label}</p>
              <p className="text-sm text-muted-foreground">{card.subtitle}</p>
            </Link>
          );
        })}
      </div>

      {/* Last AI Run Info */}
      {data?.lastAgentRun && (
        <div className="rounded-xl border bg-card p-5">
          <h3 className="mb-2 flex items-center gap-2 font-semibold">
            <Bot className="h-5 w-5 text-terracotta" />
            Last Attendance AI Run
          </h3>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">When</p>
              <p className="font-medium">
                {data.lastAgentRun.completed_at
                  ? new Date(data.lastAgentRun.completed_at).toLocaleString("en-MY")
                  : "Running..."}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Processed</p>
              <p className="font-medium">{data.lastAgentRun.items_processed}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Auto-approved</p>
              <p className="font-medium text-green-600">{data.lastAgentRun.items_auto_approved}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Flagged</p>
              <p className="font-medium text-red-600">{data.lastAgentRun.items_flagged}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
