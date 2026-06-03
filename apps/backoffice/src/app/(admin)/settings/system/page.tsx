"use client";

import Link from "next/link";
import { ArrowRight, Percent, Coins, ShoppingBag } from "lucide-react";

/**
 * "System Settings" is now mostly a signpost. The cards that used to live here
 * moved closer to where they apply:
 *   • SST → per-outlet, under POS → Settings (every channel charges that
 *     outlet's tax).
 *   • Loyalty base earn rate (points per RM) → Marketing → Loyalty → Settings.
 *   • Pickup-app config → Pickup → Settings.
 * Kept as a pointer page so old bookmarks still resolve.
 */
export default function SystemSettingsPage() {
  return (
    <div className="p-3 sm:p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">System Settings</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          These settings now live closer to where they apply — follow the links below.
        </p>
      </div>

      <div className="max-w-2xl space-y-3">
        <Pointer
          href="/pos/settings"
          icon={<Percent className="h-4.5 w-4.5 text-amber-600" />}
          bg="bg-amber-50"
          title="SST (Sales & Service Tax)"
          sub="Now per-outlet — set the rate + on/off for each outlet under POS → Settings. Every channel (in-store, pickup, web, QR-table) charges that outlet's SST."
        />
        <Pointer
          href="/loyalty/settings"
          icon={<Coins className="h-4.5 w-4.5 text-emerald-600" />}
          bg="bg-emerald-50"
          title="Loyalty: points per RM (base earn rate)"
          sub="Moved to Marketing → Loyalty → Settings."
        />
        <Pointer
          href="/pickup/settings"
          icon={<ShoppingBag className="h-4.5 w-4.5 text-blue-600" />}
          bg="bg-blue-50"
          title="Pickup app config"
          sub="Online payments, ordering hours, promo banner, push blast and more — under Pickup → Settings."
        />
      </div>
    </div>
  );
}

function Pointer({ href, icon, bg, title, sub }: {
  href: string; icon: React.ReactNode; bg: string; title: string; sub: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3.5 transition-colors hover:bg-gray-50"
    >
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${bg}`}>{icon}</div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <p className="mt-0.5 text-xs text-gray-500">{sub}</p>
        </div>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-gray-400" />
    </Link>
  );
}
