"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock, Briefcase, Clock, Timer, Building2, Banknote, UserCog, CalendarDays } from "lucide-react";

// Settings is grouped into 4 logical buckets so the nav doesn't wrap to a
// second line. Sub-pages live under their group and share the same group
// highlight while inside it.
//
// - Time Off : holidays + leave policies + balances
// - Schedule : shift templates + working time
// - Pay      : allowance rules + per-staff overrides
// - Company  : company identity / payslip presentation
const GROUPS = [
  {
    label: "Time Off",
    icon: CalendarClock,
    items: [
      { href: "/hr/settings",                  label: "Balances" },
      { href: "/hr/settings/public-holidays",  label: "Public Holidays" },
      { href: "/hr/settings/leave-policies",   label: "Leave Policies" },
    ],
  },
  {
    label: "Schedule",
    icon: Clock,
    items: [
      { href: "/hr/settings/shift-templates", label: "Shift Templates" },
      { href: "/hr/settings/working-time",    label: "Working Time" },
    ],
  },
  {
    label: "Pay",
    icon: Banknote,
    items: [
      { href: "/hr/settings/allowances",       label: "Allowance Rules" },
      { href: "/hr/settings/staff-allowances", label: "Per-Staff Overrides" },
    ],
  },
  {
    label: "Company",
    icon: Building2,
    items: [
      { href: "/hr/settings/company", label: "Company" },
    ],
  },
] as const;

// Quick-lookup table — kept around for icons that older code might still want.
// (Imports retained so removing icons doesn't break existing references.)
void Briefcase; void CalendarDays; void Timer; void UserCog;

export function SettingsNav() {
  const pathname = usePathname();
  // Find which group contains the current path so its sub-tabs can render.
  const activeGroup = GROUPS.find((g) => g.items.some((i) => i.href === pathname)) ?? GROUPS[0];
  return (
    <div className="space-y-1.5 border-b pb-2">
      {/* Top row — group buttons. Click navigates to first item in group. */}
      <div className="flex flex-wrap gap-1">
        {GROUPS.map((g) => {
          const Icon = g.icon;
          const isActive = g.label === activeGroup.label;
          return (
            <Link
              key={g.label}
              href={g.items[0].href}
              className={
                "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition " +
                (isActive
                  ? "bg-terracotta text-white"
                  : "text-gray-600 hover:bg-gray-100")
              }
            >
              <Icon className="h-4 w-4" />
              {g.label}
            </Link>
          );
        })}
      </div>
      {/* Sub-tabs (only the active group's items) — only render when there's
          more than one to avoid showing a single-item second row. */}
      {activeGroup.items.length > 1 && (
        <div className="flex flex-wrap gap-1 pl-2 text-xs">
          {activeGroup.items.map((i) => {
            const active = pathname === i.href;
            return (
              <Link
                key={i.href}
                href={i.href}
                className={
                  "rounded px-2 py-1 transition " +
                  (active
                    ? "bg-gray-900 text-white"
                    : "text-gray-500 hover:bg-gray-100 hover:text-gray-800")
                }
              >
                {i.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
