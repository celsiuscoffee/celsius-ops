"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Shared tab strip across the three POS reports — Sales, Z-Report, Tax —
 * so they read as one "Reports" area (the sidebar links to a single
 * Reports entry; these tabs switch between them). Mirrors the dashboard's
 * Overview/Analytics tab pattern.
 */
const TABS = [
  { href: "/pos/reports", label: "Sales" },
  { href: "/pos/z-report", label: "Daily report" },
  { href: "/pos/tax-report", label: "Tax (SST)" },
];

export function ReportsTabs() {
  const pathname = usePathname();
  return (
    <div className="flex gap-6 overflow-x-auto border-b border-line">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px whitespace-nowrap border-b-2 pb-2.5 text-sm transition-colors ${
              active ? "border-text font-semibold text-text" : "border-transparent text-text-2 hover:text-text"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
