"use client";

import Link from "next/link";
import { Settings, BarChart3, QrCode, Printer, ClipboardList, Receipt, type LucideIcon } from "lucide-react";

/**
 * POS section landing — quick links into the POS admin surfaces, grouped by
 * job-to-be-done so the page reads as structured sections (StoreHub-style)
 * rather than a flat wall of cards:
 *   • Reports & cash-up — what you VIEW / file (sales, shift, tax)
 *   • Register setup     — what you CONFIGURE (register, printers, QR)
 */

type PosCard = { href: string; Icon: LucideIcon; title: string; blurb: string };
type PosGroup = { label: string; blurb: string; cards: PosCard[] };

const GROUPS: PosGroup[] = [
  {
    label: "Reports & cash-up",
    blurb: "Daily sales, end-of-shift cash-ups, and monthly tax filing.",
    cards: [
      {
        href: "/pos/reports",
        Icon: BarChart3,
        title: "Sales Reports",
        blurb: "Sales, orders, payment mix, product mix, and staff performance — last 14 days.",
      },
      {
        href: "/pos/z-report",
        Icon: ClipboardList,
        title: "Z-Report (Shift Close)",
        blurb: "Per-shift cash-up: sales, payments, refunds, drawer variance. Printable 80mm slip.",
      },
      {
        href: "/pos/tax-report",
        Icon: Receipt,
        title: "Tax Report",
        blurb: "Monthly SST filing — taxable sales and tax collected, grouped by outlet and rate.",
      },
    ],
  },
  {
    label: "Register setup",
    blurb: "Configure how the register, printers, and dine-in ordering behave.",
    cards: [
      {
        href: "/pos/settings",
        Icon: Settings,
        title: "Settings",
        blurb: "Per-outlet register, receipt, service charge, tax, table layout, and payment config.",
      },
      {
        href: "/pos/printers",
        Icon: Printer,
        title: "Printers",
        blurb: "Map printers to stations (Bar / Counter / Kitchen) so each item auto-routes.",
      },
      {
        href: "/pos/table-qr",
        Icon: QrCode,
        title: "Table QR Codes",
        blurb: "Per-table dine-in QR codes, auto-generated from each outlet's floor plan.",
      },
    ],
  },
];

export default function POSLanding() {
  return (
    <div className="p-3 sm:p-6 space-y-8 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-[#160800]">POS</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage the in-store register — reporting, cash-ups, and setup.
        </p>
      </div>

      {GROUPS.map((g) => (
        <section key={g.label} className="space-y-3">
          <div>
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-[#A2492C]">{g.label}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{g.blurb}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {g.cards.map((c) => (
              <Link key={c.href} href={c.href}>
                <div className="h-full rounded-2xl border border-gray-100 bg-white p-5 transition-all hover:border-[#A2492C]/30 hover:shadow-sm">
                  <div className="mb-3 w-fit rounded-xl bg-[#FBEBE8] p-2.5">
                    <c.Icon className="h-5 w-5 text-[#A2492C]" />
                  </div>
                  <h3 className="text-[15px] font-bold text-[#160800]">{c.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-gray-600">{c.blurb}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
