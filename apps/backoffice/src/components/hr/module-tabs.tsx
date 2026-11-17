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
//
// Exported for hr-nav-drift.test.ts: every HR page in lib/nav.tsx must sit in
// exactly one group here, and every tab must exist in nav.tsx, so the two
// navigation sources cannot drift apart again (they had, twice).
export const TAB_GROUPS: { module: string; tabs: { href: string; label: string }[] }[] = [
  {
    // Roster (declutter, 17 Nov 2026): one shift is planned, worked and approved
    // here — the week grid, then the pages that edit or approve parts of it.
    module: "Roster",
    tabs: [
      { href: "/hr/roster", label: "Roster" },
      { href: "/hr/schedules", label: "Edit schedules" },
      { href: "/hr/attendance", label: "Clock-ins" },
      { href: "/hr/overtime", label: "Overtime" },
      { href: "/hr/shift-swaps", label: "Shift swaps" },
      { href: "/hr/leave", label: "Leave" },
    ],
  },
  {
    // Hours worked, for pay: rostered vs clocked, and part-timers' hours.
    module: "Hours",
    tabs: [
      { href: "/hr/roster-attendance", label: "Rostered vs clocked" },
      { href: "/hr/pt-hours", label: "PT hours" },
    ],
  },
  {
    // Scheduling set-up, rarely touched.
    module: "Scheduling set-up",
    tabs: [
      { href: "/hr/availability", label: "Availability" },
      { href: "/hr/coverage", label: "Coverage rules" },
    ],
  },
  {
    // Leave set-up lives under HR Settings (Time Off group); linked here so
    // leave rules are one tap from each other. Requests are in Roster.
    module: "Leave set-up",
    tabs: [
      { href: "/hr/settings", label: "Balances" },
      { href: "/hr/settings/leave-policies", label: "Policies" },
      { href: "/hr/settings/public-holidays", label: "Public holidays" },
    ],
  },
  {
    module: "People",
    tabs: [
      { href: "/hr/employees", label: "Employees" },
      { href: "/hr", label: "Overview" },
      // PT Rates sits with People, not Payroll: it's keyed on hr:employees so a
      // staffing manager sets hourly rates without the payroll module — and the
      // Payroll tab group is hidden from managers entirely.
      { href: "/hr/pt-rates", label: "PT rates" },
      { href: "/hr/access-presets", label: "App access" },
      { href: "/hr/certifications", label: "Certifications" },
      { href: "/hr/memos", label: "Memos" },
    ],
  },
  {
    module: "Payroll",
    tabs: [
      { href: "/hr/payroll", label: "Monthly" },
      { href: "/hr/payroll/weekly", label: "Weekly" },
      { href: "/hr/allowances", label: "Allowances" },
      { href: "/hr/compliance", label: "Statutory calendar" },
    ],
  },
  {
    module: "Performance",
    tabs: [
      { href: "/hr/performance", label: "Performance" },
      { href: "/hr/review-penalties", label: "Review penalties" },
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
                ? "border-ink text-brand-text"
                : "border-transparent text-muted-foreground hover:border-line-2 hover:text-foreground")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
