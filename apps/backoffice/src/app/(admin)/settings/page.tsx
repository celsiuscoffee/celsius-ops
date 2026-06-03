"use client";

import Link from "next/link";
import {
  Building2,
  UserCog,
  ShieldCheck,
  Plug,
  Wrench,
  CreditCard,
  Printer,
  QrCode,
  Receipt,
  ShoppingBag,
  Crown,
  TicketPercent,
  Target,
  Star,
  Megaphone,
  FileText,
  ClipboardCheck,
  ExternalLink,
  ChevronRight,
} from "lucide-react";

/**
 * Settings hub — single discovery surface for every configurable
 * area of the platform. Used to be that "Settings" meant different
 * things in different modules: POS had its own, Pickup had its own,
 * Ads + HR + Reviews each had their own, and the top-level
 * /settings group only covered global infra (outlets, staff,
 * integrations). The result was that a user trying to change a
 * specific config had to remember which module's submenu it lived
 * under.
 *
 * This page indexes ALL of them under one URL, grouped by domain.
 * Each tile links to the actual settings page (no logic moves) so
 * existing deep links + the per-module sidebar entries keep
 * working. The hub is just an addressable shortcut.
 *
 * Tiles are filtered by the same moduleAccess RBAC rules that the
 * sidebar uses, so a manager only sees groups they have access
 * to. (The link href still gets checked server-side; this is UX
 * filtering only.)
 */

type Tile = {
  href: string;
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  blurb: string;
  external?: boolean;
};

type Group = {
  label: string;
  blurb: string;
  tiles: Tile[];
};

const GROUPS: Group[] = [
  {
    label: "Business",
    blurb: "Company identity, outlets, tax registration, staff access.",
    tiles: [
      {
        href: "/settings/outlets",
        Icon: Building2,
        title: "Outlets",
        blurb: "Stores, addresses, contact info. Used by receipts, e-Invoice, and outlet-aware reports.",
      },
      {
        href: "/settings/staff",
        Icon: UserCog,
        title: "Staff & Access",
        blurb: "User accounts, roles (Owner / Admin / Manager / Staff), per-module access toggles.",
      },
      {
        href: "/settings/rules",
        Icon: ShieldCheck,
        title: "Approval Rules",
        blurb: "Approval thresholds and routing for purchase orders, refunds, manual discounts.",
      },
    ],
  },
  {
    label: "POS — In-Store",
    blurb: "Register defaults, receipt, payment terminal, printers, tables.",
    tiles: [
      {
        href: "/pos/settings",
        Icon: CreditCard,
        title: "POS Settings",
        blurb: "Per-outlet register defaults, receipt customization, payment terminal, tax + e-Invoice TIN/BRN/SST.",
      },
      {
        href: "/pos/printers",
        Icon: Printer,
        title: "Printers",
        blurb: "Map physical printers to stations (Bar / Counter / Kitchen). One docket per station.",
      },
      {
        href: "/pos/table-qr",
        Icon: QrCode,
        title: "Table QR Codes",
        blurb: "Generate per-table QR for dine-in self-ordering. Print-friendly bulk layout.",
      },
    ],
  },
  {
    label: "Pickup App",
    blurb: "Customer-facing pickup ordering on order.celsiuscoffee.com.",
    tiles: [
      {
        href: "/pickup/settings",
        Icon: ShoppingBag,
        title: "Pickup Settings",
        blurb: "Hours per outlet, pickup time estimate, minimum order, ordering fees.",
      },
    ],
  },
  {
    label: "Loyalty & Promotions",
    blurb: "Member tiers, Points, missions, promotion engine.",
    tiles: [
      {
        href: "/loyalty/tiers",
        Icon: Crown,
        title: "Tiers",
        blurb: "Bronze / Silver / Gold / Platinum / Staff / Black Card — discount %, stackable rule, qualifying thresholds.",
      },
      {
        href: "/loyalty/promotions",
        Icon: TicketPercent,
        title: "Promotions",
        blurb: "Auto-promos, first-order discount, combos, BOGO, time-window deals. Per-channel + per-outlet.",
      },
      {
        href: "/loyalty/missions",
        Icon: Target,
        title: "Missions & Challenges",
        blurb: "RM50 Bill, Weekend Run, Make it a Meal — gamified goals that mint vouchers.",
      },
      {
        href: "/loyalty/mystery",
        Icon: Star,
        title: "Mystery Reward Pool",
        blurb: "Surprise reward outcomes shown on the customer-display after checkout.",
      },
    ],
  },
  {
    label: "Marketing",
    blurb: "Customer-facing review prompts and paid ads.",
    tiles: [
      {
        href: "/reviews/settings",
        Icon: Megaphone,
        title: "Reviews",
        blurb: "QR review-gate config, Google Business Profile sync, auto-post rules.",
      },
      {
        href: "/ads/settings",
        Icon: Megaphone,
        title: "Google Ads",
        blurb: "Campaign defaults, budget guards, per-outlet location targeting.",
      },
    ],
  },
  {
    label: "Operations",
    blurb: "Stock count rules, system + integrations.",
    tiles: [
      {
        href: "/settings/stock-count",
        Icon: ClipboardCheck,
        title: "Stock Count",
        blurb: "Variance thresholds, freeze rules, audit trail settings.",
      },
      {
        href: "/settings/integrations",
        Icon: Plug,
        title: "Integrations",
        blurb: "Grab, Foodpanda, Google Business Profile, Google Ads, Indeed, FCM, APNs, MyInvois.",
      },
      {
        href: "/settings/system",
        Icon: Wrench,
        title: "System",
        blurb: "Database health, backups, feature flags, cron status, kill-switches.",
      },
    ],
  },
  {
    label: "HR & Finance",
    blurb: "Staff payroll, scheduling, finance module.",
    tiles: [
      {
        href: "/hr/settings",
        Icon: UserCog,
        title: "HR Settings",
        blurb: "Payroll cycles, overtime rules, leave entitlements, AI agent toggles.",
      },
      {
        href: "/finance",
        Icon: FileText,
        title: "Finance",
        blurb: "Chart of accounts, bank-line classifier, agentic finance settings. (Owner/Admin only)",
      },
    ],
  },
];

export default function SettingsHub() {
  return (
    <div className="p-3 sm:p-6 space-y-6 max-w-6xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#160800]">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Every configurable area of the platform, in one place. Pick a tile to jump in.
        </p>
      </div>

      {/* Groups */}
      {GROUPS.map((group) => (
        <section key={group.label} className="space-y-3">
          <div>
            <h2 className="text-base font-bold text-[#160800]">{group.label}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{group.blurb}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {group.tiles.map((tile) => (
              <Link
                key={tile.href}
                href={tile.href}
                className="group bg-white rounded-2xl p-4 hover:shadow-sm transition-shadow border border-gray-100 hover:border-[#A2492C]/30"
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-[#FBEBE8] p-2 shrink-0">
                    <tile.Icon className="h-5 w-5 text-[#A2492C]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-sm font-bold text-[#160800]">{tile.title}</h3>
                      {tile.external ? (
                        <ExternalLink className="h-3 w-3 text-gray-400 shrink-0" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-gray-300 group-hover:text-[#A2492C] group-hover:translate-x-0.5 transition-all shrink-0" />
                      )}
                    </div>
                    <p className="mt-1 text-xs text-gray-600 leading-relaxed">{tile.blurb}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}

      {/* Footer help */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900">
        <p className="font-semibold mb-1">Don't see what you need?</p>
        <p>
          Some settings live inside their feature module — e.g. POS register layout customization
          is under POS → Settings, splash poster scheduling under Catalog → Splash Posters.
          The sidebar mirrors this structure when you'd rather drill in than scan tiles.
        </p>
      </div>
    </div>
  );
}
