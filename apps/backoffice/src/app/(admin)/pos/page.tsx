"use client";

import Link from "next/link";
import { Settings, BarChart3, QrCode, ExternalLink, Printer } from "lucide-react";

/**
 * POS section landing — quick links into the POS admin surfaces.
 * Settings is canonical here; Reports + Table QR are still hosted in
 * the POS app for now (per-terminal context) but linked from here.
 */

const SECTIONS = [
  {
    href: "/pos/settings",
    Icon: Settings,
    title: "Settings",
    blurb: "Per-outlet register, receipt, QR, promo, and payment terminal config. The POS reads from here.",
    external: false,
  },
  {
    href: "/pos/printers",
    Icon: Printer,
    title: "Printers",
    blurb: "Map physical printers to stations (Bar / Counter / Kitchen). Each station's items auto-route to the right printer.",
    external: false,
  },
  {
    href: "/pos/reports",
    Icon: BarChart3,
    title: "Reports",
    blurb: "Daily sales, orders, payment breakdown, product mix, staff performance. Last 14 days.",
    external: false,
  },
  {
    href: "/pos/table-qr",
    Icon: QrCode,
    title: "Table QR Codes",
    blurb: "Generate per-table QR codes for dine-in ordering. Print-friendly bulk layout.",
    external: false,
  },
] as const;

export default function POSLanding() {
  return (
    <div className="p-3 sm:p-6 space-y-5 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-[#160800]">POS</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage the in-store POS register from here. Settings, reports, and per-table QR codes.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {SECTIONS.map((s) => {
          const inner = (
            <div className="bg-white rounded-2xl p-5 hover:shadow-sm transition-shadow border border-gray-100 h-full">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-[#FBEBE8] p-2 shrink-0">
                  <s.Icon className="h-5 w-5 text-[#A2492C]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-[#160800]">{s.title}</h2>
                    {s.external && (
                      <ExternalLink className="h-3 w-3 text-gray-400 shrink-0" />
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-600 leading-relaxed">{s.blurb}</p>
                </div>
              </div>
            </div>
          );
          return <Link key={s.href} href={s.href}>{inner}</Link>;
        })}
      </div>
    </div>
  );
}
