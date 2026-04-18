"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock, Briefcase, Calculator, Clock, Timer, Building2 } from "lucide-react";

const TABS = [
  { href: "/hr/settings", label: "Holidays & Balances", icon: CalendarClock },
  { href: "/hr/settings/leave-policies", label: "Leave Policies", icon: Briefcase },
  { href: "/hr/settings/payroll-items", label: "Payroll Items", icon: Calculator },
  { href: "/hr/settings/shift-templates", label: "Shift Templates", icon: Clock },
  { href: "/hr/settings/working-time", label: "Working Time", icon: Timer },
  { href: "/hr/settings/company", label: "Company", icon: Building2 },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap gap-1 border-b pb-2">
      {TABS.map((t) => {
        const active = pathname === t.href;
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition " +
              (active
                ? "bg-terracotta text-white"
                : "text-gray-600 hover:bg-gray-100")
            }
          >
            <Icon className="h-4 w-4" />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
