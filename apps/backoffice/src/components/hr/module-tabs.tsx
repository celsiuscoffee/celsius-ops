"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFetch } from "@/lib/use-fetch";

// BrioHR-style in-module tab strip. The sidebar picks the module; this strip
// switches between the module's sibling pages without going back through the
// sidebar. Rendered by (admin)/hr/layout.tsx on every HR page — a strip only
// appears when the current pathname exactly matches one of a group's tabs, so
// detail pages (e.g. /hr/employees/[id]) and the payroll run wizard stay
// full-bleed with their own local navigation.
//
// URLs are unchanged from the flat structure — this is presentation only.
const TAB_GROUPS: { module: string; tabs: { href: string; label: string }[] }[] = [
  {
    module: "People",
    tabs: [
      { href: "/hr/employees", label: "Employees" },
      { href: "/hr/access-presets", label: "App Access" },
      { href: "/hr/certifications", label: "Certifications" },
      { href: "/hr/memos", label: "Memos" },
    ],
  },
  {
    module: "Leave",
    tabs: [
      { href: "/hr/leave", label: "Requests" },
      // Balances + policies live under HR Settings (Time Off group); linked
      // here so the Leave module is self-contained like BrioHR's.
      { href: "/hr/settings", label: "Balances" },
      { href: "/hr/settings/leave-policies", label: "Policies" },
      { href: "/hr/settings/public-holidays", label: "Public Holidays" },
    ],
  },
  {
    module: "Time & Attendance",
    tabs: [
      { href: "/hr/attendance", label: "Attendance" },
      { href: "/hr/roster-attendance", label: "Roster" },
      { href: "/hr/pt-hours", label: "PT Hours" },
      { href: "/hr/overtime", label: "Overtime" },
      { href: "/hr/shift-swaps", label: "Shift Swaps" },
    ],
  },
  {
    module: "Scheduling",
    tabs: [
      { href: "/hr/schedules", label: "Schedules" },
      { href: "/hr/availability", label: "Availability" },
      { href: "/hr/coverage", label: "Coverage Rules" },
    ],
  },
  {
    module: "Payroll",
    tabs: [
      { href: "/hr/payroll", label: "Monthly" },
      { href: "/hr/payroll/weekly", label: "Weekly" },
      { href: "/hr/allowances", label: "Allowances" },
      { href: "/hr/compliance", label: "Statutory Calendar" },
    ],
  },
  {
    module: "Performance",
    tabs: [
      { href: "/hr/performance", label: "Performance" },
      { href: "/hr/review-penalties", label: "Review Penalties" },
    ],
  },
];

export function HrModuleTabs() {
  const pathname = usePathname();
  // Payroll is Owner/Admin only — managers never get the Payroll tab group.
  // (Hook must run before the settings early-return below.)
  const { data: me } = useFetch<{ role: string }>("/api/auth/me");
  const canSeePayroll = me?.role === "OWNER" || me?.role === "ADMIN";

  // Settings pages keep their own SettingsNav as the primary strip — only the
  // Leave group cross-links into settings, and there the SettingsNav already
  // gives Balances/Policies/Holidays switching, so suppress ours to avoid a
  // double tab row.
  if (pathname.startsWith("/hr/settings")) return null;

  const groups = canSeePayroll ? TAB_GROUPS : TAB_GROUPS.filter((g) => g.module !== "Payroll");
  const group = groups.find((g) => g.tabs.some((t) => t.href === pathname));
  if (!group) return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b bg-card/50 px-4 pt-2 sm:px-6 lg:px-8">
      <span className="mr-2 hidden pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:block">
        {group.module}
      </span>
      {group.tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              "whitespace-nowrap border-b-2 px-3 pb-2 pt-1 text-sm font-medium transition " +
              (active
                ? "border-terracotta text-terracotta"
                : "border-transparent text-muted-foreground hover:border-gray-300 hover:text-foreground")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
