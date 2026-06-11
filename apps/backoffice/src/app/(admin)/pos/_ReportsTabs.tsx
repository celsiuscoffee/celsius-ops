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
  { href: "/pos/z-report", label: "Daily Report" },
  { href: "/pos/tax-report", label: "Tax (SST)" },
];

export function ReportsTabs() {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 bg-white rounded-xl p-1 w-fit border border-border/40">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              active ? "bg-[#160800] text-white shadow-sm" : "text-muted-foreground hover:text-[#160800]"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
