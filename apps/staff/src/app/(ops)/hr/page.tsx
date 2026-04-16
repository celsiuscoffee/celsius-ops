"use client";

import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";
import { Clock, CalendarDays, CalendarOff, Receipt, ChevronRight, CheckCircle2 } from "lucide-react";

type HRStatus = {
  activeLog: {
    id: string;
    clock_in: string;
  } | null;
  geofence: unknown;
  outletId: string | null;
};

type LeaveBalanceSummary = {
  annual: { entitled: number; remaining: number };
  sick: { entitled: number; remaining: number };
};

export default function HRHomePage() {
  const { data: clockStatus } = useFetch<HRStatus>("/api/hr/clock");

  const isClockedIn = !!clockStatus?.activeLog;
  const clockedInSince = clockStatus?.activeLog
    ? new Date(clockStatus.activeLog.clock_in).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })
    : null;

  const actions = [
    {
      href: "/hr/clock",
      icon: Clock,
      label: "Time Clock",
      subtitle: isClockedIn ? `Clocked in since ${clockedInSince}` : "Not clocked in",
      color: isClockedIn ? "text-green-600" : "text-gray-400",
      bgColor: isClockedIn ? "bg-green-50" : "bg-gray-50",
    },
    {
      href: "/hr/shifts",
      icon: CalendarDays,
      label: "My Shifts",
      subtitle: "View upcoming schedule",
      color: "text-blue-600",
      bgColor: "bg-blue-50",
    },
    {
      href: "/hr/leave",
      icon: CalendarOff,
      label: "Leave",
      subtitle: "Request & view balances",
      color: "text-purple-600",
      bgColor: "bg-purple-50",
    },
    {
      href: "/hr/payslips",
      icon: Receipt,
      label: "Payslips",
      subtitle: "View pay history",
      color: "text-terracotta",
      bgColor: "bg-orange-50",
    },
  ];

  return (
    <div className="px-4 pt-6">
      <h1 className="mb-6 text-2xl font-bold">HR</h1>

      {/* Clock-in status card */}
      <div className={`mb-6 rounded-2xl p-4 ${isClockedIn ? "bg-green-50 border border-green-200" : "bg-gray-50 border border-gray-200"}`}>
        <div className="flex items-center gap-3">
          <div className={`rounded-full p-2 ${isClockedIn ? "bg-green-100" : "bg-gray-200"}`}>
            <Clock className={`h-6 w-6 ${isClockedIn ? "text-green-600" : "text-gray-400"}`} />
          </div>
          <div className="flex-1">
            <p className="font-semibold">{isClockedIn ? "On Shift" : "Off Shift"}</p>
            <p className="text-sm text-gray-500">
              {isClockedIn ? `Since ${clockedInSince}` : "Tap Time Clock to start"}
            </p>
          </div>
          {isClockedIn && <CheckCircle2 className="h-6 w-6 text-green-500" />}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="space-y-3">
        {actions.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition-all active:scale-[0.98]"
            >
              <div className={`rounded-xl p-3 ${item.bgColor}`}>
                <Icon className={`h-6 w-6 ${item.color}`} />
              </div>
              <div className="flex-1">
                <p className="font-semibold">{item.label}</p>
                <p className="text-sm text-gray-500">{item.subtitle}</p>
              </div>
              <ChevronRight className="h-5 w-5 text-gray-300" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
