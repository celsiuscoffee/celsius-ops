"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Banknote, SlidersHorizontal, UserCog } from "lucide-react";

// Shared tab strip for the three allowance-related pages so they feel like
// one tabbed view even though each lives under its own route. Reduces the
// "where do I go to do X?" tax for HR — Payouts is the daily workspace,
// Rules + Per-staff are the configuration twin.
const ALLOWANCE_TABS = [
  { href: "/hr/allowances",                  label: "Payouts",            icon: Banknote },
  { href: "/hr/settings/allowances",         label: "Rules",              icon: SlidersHorizontal },
  { href: "/hr/settings/staff-allowances",   label: "Per-staff Overrides", icon: UserCog },
] as const;

export function AllowanceTabs() {
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap gap-1 border-b pb-2">
      {ALLOWANCE_TABS.map((t) => {
        const Icon = t.icon;
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition " +
              (active
                ? "bg-ink text-on-ink"
                : "text-text-2 hover:bg-sunken")
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
