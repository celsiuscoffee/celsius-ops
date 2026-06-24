"use client";

import { useEffect, useState, Fragment } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  ShoppingBag,
  Box,
  Boxes,
  Gift,
  SlidersHorizontal,
  ChevronRight,
  LogOut,
  LayoutDashboard,
  ClipboardList,
  UtensilsCrossed,
  BarChart3,
  Power,
  Users,
  Package,
  PackageOpen,
  Truck,
  Tag,
  Tags,
  BookOpen,
  FileText,
  Receipt,
  ClipboardCheck,
  Trash2,
  ArrowLeftRight,
  TrendingUp,
  AlertTriangle,
  LineChart,
  Repeat,
  Star,
  Crown,
  TicketPercent,
  Megaphone,
  MessageSquare,
  MapPinned,
  Sparkles,
  Building2,
  UserCog,
  ShieldCheck,
  Plug,
  Wrench,
  Lock,
  Eye,
  EyeOff,
  Scale,
  Check,
  Loader2,
  HandCoins,
  Layers,
  Archive,
  ClipboardCheck as ClipboardCheckIcon,
  CalendarClock,
  Brain,
  MessageCircle,
  Coins,
  Clock,
  CalendarDays,
  CalendarOff,
  Flame,
  Banknote,
  TableProperties,
  Bot,
  Sun,
  Moon,
  ImagePlus,
  Target,
  Trophy,
  Cake,
  Ticket,
  CreditCard,
  QrCode,
  Printer,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { useTheme } from "@/components/theme-provider";
import { CommandPalette } from "@/components/command-palette";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useFetch } from "@/lib/use-fetch";
import { GRANTABLE_MODULE_KEYS } from "@/lib/modules";

// ─── Types ──────────────────────────────────────────────────────────────

type UserProfile = {
  id: string;
  name: string;
  role: string;
  outletId: string | null;
  outletName?: string | null;
  moduleAccess?: string[];
  hasPassword?: boolean;
};

type NavItem = {
  label: string;
  href: string;
  icon: React.ReactNode;
  moduleKey?: string;
};

type NavSubgroup = {
  label: string;
  items: NavItem[];
};

type NavSection = {
  label: string;
  icon: React.ReactNode;
  railIcon: React.ReactNode; // larger icon for the rail
  moduleKey?: string; // top-level module check
  items?: NavItem[];
  subgroups?: NavSubgroup[];
  dividerBefore?: boolean; // visual divider in rail
};

// ─── Sidebar Navigation Config ──────────────────────────────────────────

const ICON_SIZE = "h-4 w-4";
const RAIL_ICON_SIZE = "h-5 w-5";

const NAV_SECTIONS: NavSection[] = [
  // Menu (= product catalog) is shared across POS, Pickup app, and
  // Grab integration — promoted to a top-level "Catalog" section so it
  // doesn't read as Pickup-only. URLs stay at /pickup/* to avoid
  // breaking bookmarks; the routes can be re-homed later if needed.
  {
    label: "Catalog",
    icon: <UtensilsCrossed className={ICON_SIZE} />,
    railIcon: <UtensilsCrossed className={RAIL_ICON_SIZE} />,
    dividerBefore: true,
    items: [
      { label: "Products", href: "/pickup/menu", icon: <UtensilsCrossed className={ICON_SIZE} />, moduleKey: "pickup:menu" },
      { label: "Splash Posters", href: "/pickup/splash-posters", icon: <ImagePlus className={ICON_SIZE} />, moduleKey: "pickup:menu" },
      // Menu & BOM (recipe/BOM editor) lives with the catalog/menu definition,
      // not under Procurement. Gate stays inventory:menus so access is unchanged.
      { label: "Menu & BOM", href: "/inventory/menus", icon: <BookOpen className={ICON_SIZE} />, moduleKey: "inventory:menus" },
      // Packaging rules attach cups/lids/straws to menu items & channels — part
      // of the menu definition, so surfaced here too (also under Procurement →
      // Master Data). Gate stays inventory:packaging.
      { label: "Packaging", href: "/inventory/packaging", icon: <PackageOpen className={ICON_SIZE} />, moduleKey: "inventory:packaging" },
    ],
  },
  // Sales — one rail tab for everything sales/POS. Used to be two sections
  // ("Pickup App" + "POS") plus a standalone "Sales" analytics section;
  // StoreHub is retired so "Sales" no longer names a separate source, and
  // all the side tabs live here as a flat list:
  //   Dashboard (period analytics) · Orders (live queue) · Customers ·
  //   Compare · Reports (Sales/Z/Tax tabs) · Cashier Performance.
  // The old thin /pickup "today" overview was dropped — Dashboard is now
  // the /sales analytics page. Customers still points at /pickup/customers
  // until the consolidated customer page (merged with Rewards → Members)
  // ships, then it repoints. Settings surfaces stay under Settings. URLs
  // otherwise unchanged.
  {
    label: "Sales",
    icon: <BarChart3 className={ICON_SIZE} />,
    railIcon: <BarChart3 className={RAIL_ICON_SIZE} />,
    items: [
      { label: "Dashboard",           href: "/sales/dashboard",         icon: <LayoutDashboard className={ICON_SIZE} />, moduleKey: "sales:dashboard" },
      { label: "Orders",              href: "/pickup/orders",           icon: <ClipboardList className={ICON_SIZE} />,   moduleKey: "pickup:orders" },
      { label: "Customers",           href: "/loyalty/members",         icon: <Users className={ICON_SIZE} />,           moduleKey: "loyalty:members" },
      { label: "Compare",             href: "/sales/compare",           icon: <Scale className={ICON_SIZE} />,           moduleKey: "sales:dashboard" },
      { label: "Reports",             href: "/pos/reports",             icon: <BarChart3 className={ICON_SIZE} />,       moduleKey: "pickup:settings" },
      { label: "Cashier Performance", href: "/pos/cashier-performance", icon: <Users className={ICON_SIZE} />,           moduleKey: "pickup:settings" },
      { label: "Store / Menu Status", href: "/pos/store-menu-status",    icon: <Power className={ICON_SIZE} />,           moduleKey: "pickup:settings" },
    ],
  },
  {
    label: "Procurement",
    icon: <Boxes className={ICON_SIZE} />,
    railIcon: <Boxes className={RAIL_ICON_SIZE} />,
    subgroups: [
      {
        label: "Overview",
        items: [
          { label: "Dashboard", href: "/inventory/dashboard", icon: <LayoutDashboard className={ICON_SIZE} />, moduleKey: "inventory:products" },
        ],
      },
      {
        label: "Master Data",
        items: [
          { label: "Ingredients", href: "/inventory/products", icon: <Package className={ICON_SIZE} />, moduleKey: "inventory:products" },
          { label: "Perishables", href: "/inventory/perishables", icon: <Box className={ICON_SIZE} />, moduleKey: "inventory:perishables" },
          { label: "Packaging", href: "/inventory/packaging", icon: <PackageOpen className={ICON_SIZE} />, moduleKey: "inventory:packaging" },
          { label: "Suppliers", href: "/inventory/suppliers", icon: <Truck className={ICON_SIZE} />, moduleKey: "inventory:suppliers" },
          { label: "Groups & Storage", href: "/inventory/groups", icon: <Tags className={ICON_SIZE} />, moduleKey: "inventory:categories" },
        ],
      },
      {
        label: "Ordering",
        items: [
          { label: "Purchase Orders", href: "/inventory/orders", icon: <FileText className={ICON_SIZE} />, moduleKey: "inventory:orders" },
          { label: "Transfers", href: "/inventory/transfers", icon: <ArrowLeftRight className={ICON_SIZE} />, moduleKey: "inventory:transfers" },
          { label: "Receivings", href: "/inventory/receivings", icon: <Receipt className={ICON_SIZE} />, moduleKey: "inventory:receivings" },
          { label: "Invoices", href: "/inventory/invoices", icon: <ClipboardList className={ICON_SIZE} />, moduleKey: "inventory:invoices" },
          { label: "Payment Requests", href: "/inventory/pay-and-claim", icon: <HandCoins className={ICON_SIZE} />, moduleKey: "inventory:pay-and-claim" },
        ],
      },
      {
        label: "Operations",
        items: [
          { label: "Stock Count", href: "/inventory/stock-count", icon: <ClipboardCheck className={ICON_SIZE} />, moduleKey: "inventory:stock-count" },
          { label: "Wastage", href: "/inventory/wastage", icon: <Trash2 className={ICON_SIZE} />, moduleKey: "inventory:wastage" },
          { label: "Par Levels", href: "/inventory/par-levels", icon: <TrendingUp className={ICON_SIZE} />, moduleKey: "inventory:par-levels" },
        ],
      },
      {
        label: "Analytics",
        items: [
          { label: "Reports", href: "/inventory/reports", icon: <LineChart className={ICON_SIZE} />, moduleKey: "inventory:reports" },
        ],
      },
    ],
  },
  // Rewards — the loyalty programme's day-to-day surfaces. Pulled out of
  // "Marketing" into its own top-level section. The loyalty *config* (Tiers,
  // Discount Engine, All Rewards, Outcome Types, Birthday Treats) still lives
  // under Settings → Loyalty.
  {
    label: "Rewards",
    icon: <Gift className={ICON_SIZE} />,
    railIcon: <Gift className={RAIL_ICON_SIZE} />,
    dividerBefore: true,
    subgroups: [
      {
        // The rewards-program Overview was replaced by the Area Scorecard:
        // a per-outlet KPI scoreboard (loyalty capture, upsell, ops
        // compliance, wastage) sourced from the live POS / apps system —
        // answers "which area is hitting KPI". The mechanic-specific
        // rewards Analytics / AI Insights pages remain available via
        // deep-link (/loyalty/analytics, /loyalty/insights).
        label: "Overview",
        items: [
          { label: "Area Scorecard", href: "/loyalty/dashboard", icon: <Trophy className={ICON_SIZE} />, moduleKey: "loyalty:dashboard" },
        ],
      },
      {
        // Channels = "where rewards reach customers". Order mirrors the
        // pickup app's rewards screen top-to-bottom so admin mental
        // model matches what the customer sees.
        //
        // The Points Shop has no entry here: its catalog is managed
        // in All Rewards (Setup) — any template with points_cost set is a
        // points-shop item. The legacy rewards-table editor (/loyalty/
        // rewards) was removed once the Points-Shop readers migrated to
        // voucher_templates, so there's a single edit surface again.
        label: "Channels",
        items: [
          { label: "Challenges",       href: "/loyalty/missions",         icon: <Target className={ICON_SIZE} />,   moduleKey: "loyalty:rewards" },
          { label: "Mystery Pool",     href: "/loyalty/mystery",          icon: <Sparkles className={ICON_SIZE} />, moduleKey: "loyalty:rewards" },
          { label: "Admin Claimables", href: "/loyalty/admin-claimables", icon: <Gift className={ICON_SIZE} />,     moduleKey: "loyalty:rewards" },
        ],
      },
      {
        // Members = day-to-day work on individual customers. Manual
        // Grant lives here (not under a separate Operations heading) —
        // it's a member-level action, not a system-level config.
        // Customer List moved out — it's the consolidated customer page,
        // reached via Sales → Customers (same /loyalty/members route).
        label: "Members",
        items: [
          { label: "Manual Grant",  href: "/loyalty/manual-grant",  icon: <HandCoins className={ICON_SIZE} />, moduleKey: "loyalty:rewards" },
        ],
      },
      {
        // History = read-only audit trails of what was issued + redeemed.
        // No edits here — all writes happen via Channels or the
        // customer-facing app.
        label: "History",
        items: [
          { label: "Vouchers Issued",    href: "/loyalty/vouchers",    icon: <TicketPercent className={ICON_SIZE} />, moduleKey: "loyalty:redemptions" },
          { label: "Points Redemptions", href: "/loyalty/redemptions", icon: <Receipt className={ICON_SIZE} />,       moduleKey: "loyalty:redemptions" },
          { label: "Points Log",         href: "/loyalty/points-log",  icon: <Coins className={ICON_SIZE} />,         moduleKey: "loyalty:redemptions" },
        ],
      },
      {
        label: "Campaigns",
        items: [
          // Campaigns = Loops. The legacy preset editor (/loyalty/campaigns)
          // is retired (redirects here); every objective now runs as an
          // adaptive loop (holdout + offer/voucher/send-time learning).
          { label: "Campaigns", href: "/loyalty/loops", icon: <Repeat className={ICON_SIZE} />, moduleKey: "loyalty:campaigns" },
          // Engage = unified surface for "how we reach customers".
          // Push reminders (auto, triggered) + SMS broadcasts (manual)
          // live as tabs inside this page; no separate nav entries.
          { label: "Engage",    href: "/loyalty/engage",    icon: <MessageSquare className={ICON_SIZE} />, moduleKey: "loyalty:engage" },
        ],
      },
    ],
  },
  // Marketing — now just the outward-facing channels (customer reviews + paid
  // ads). The loyalty/rewards surfaces moved to their own "Rewards" section
  // above.
  {
    label: "Marketing",
    icon: <Megaphone className={ICON_SIZE} />,
    railIcon: <Megaphone className={RAIL_ICON_SIZE} />,
    subgroups: [
      {
        label: "Reviews",
        items: [
          { label: "All Reviews", href: "/reviews", icon: <Star className={ICON_SIZE} />, moduleKey: "reviews:list" },
          { label: "Feedback Management", href: "/reviews/feedback", icon: <MessageSquare className={ICON_SIZE} />, moduleKey: "reviews:list" },
          { label: "Local Rank", href: "/reviews/geogrid", icon: <MapPinned className={ICON_SIZE} />, moduleKey: "reviews:list" },
          { label: "Rank Scoreboard", href: "/reviews/scoreboard", icon: <Target className={ICON_SIZE} />, moduleKey: "reviews:list" },
        ],
      },
      {
        label: "Google Ads",
        items: [
          { label: "Overview",  href: "/ads",           icon: <LayoutDashboard className={ICON_SIZE} />, moduleKey: "ads:overview" },
          { label: "Campaigns", href: "/ads/campaigns", icon: <BarChart3 className={ICON_SIZE} />,        moduleKey: "ads:campaigns" },
          { label: "Invoices",  href: "/ads/invoices",  icon: <Receipt className={ICON_SIZE} />,          moduleKey: "ads:invoices" },
        ],
      },
      {
        label: "GrabFood",
        items: [
          { label: "Campaigns & Ad Spend", href: "/ads/grab", icon: <Megaphone className={ICON_SIZE} />, moduleKey: "ads:grab" },
        ],
      },
    ],
  },
  {
    label: "Finance",
    icon: <Banknote className={ICON_SIZE} />,
    railIcon: <Banknote className={RAIL_ICON_SIZE} />,
    items: [
      // moduleKey starts with "finance:" — canAccess hard-restricts these to
      // OWNER/ADMIN regardless of moduleAccess, so the section won't render
      // in the rail for managers/staff.
      { label: "Home", href: "/finance", icon: <LayoutDashboard className={ICON_SIZE} />, moduleKey: "finance:home" },
      { label: "Ledger", href: "/finance/transactions", icon: <FileText className={ICON_SIZE} />, moduleKey: "finance:transactions" },
      { label: "Reports", href: "/finance/reports", icon: <TrendingUp className={ICON_SIZE} />, moduleKey: "finance:reports" },
      { label: "Compliance", href: "/finance/compliance", icon: <ShieldCheck className={ICON_SIZE} />, moduleKey: "finance:compliance" },
      // Legacy (pre-agentic) views — kept until the new module reaches parity.
      { label: "Cashflow", href: "/finance/cashflow", icon: <LineChart className={ICON_SIZE} />, moduleKey: "finance:cashflow" },
      { label: "Cash Tracking", href: "/finance/cash-tracking", icon: <TableProperties className={ICON_SIZE} />, moduleKey: "finance:cash-tracking" },
      { label: "Bank Statements", href: "/finance/bank-statements", icon: <Banknote className={ICON_SIZE} />, moduleKey: "finance:bank-statements" },
      { label: "Payouts", href: "/finance/payouts", icon: <HandCoins className={ICON_SIZE} />, moduleKey: "finance:payouts" },
      { label: "Recurring Expenses", href: "/finance/recurring-expenses", icon: <CalendarClock className={ICON_SIZE} />, moduleKey: "finance:recurring-expenses" },
    ],
  },
  {
    label: "Ops",
    icon: <ClipboardCheckIcon className={ICON_SIZE} />,
    railIcon: <ClipboardCheckIcon className={RAIL_ICON_SIZE} />,
    items: [
      { label: "Dashboard", href: "/ops/dashboard", icon: <LayoutDashboard className={ICON_SIZE} />, moduleKey: "ops:performance" },
      { label: "Performance", href: "/ops/performance", icon: <BarChart3 className={ICON_SIZE} />, moduleKey: "ops:performance" },
      { label: "Audits", href: "/ops/audit", icon: <ClipboardCheck className={ICON_SIZE} />, moduleKey: "ops:audit" },
      { label: "SOPs & Templates", href: "/ops/sops", icon: <BookOpen className={ICON_SIZE} />, moduleKey: "ops:sops" },
      { label: "Categories", href: "/ops/categories", icon: <Tags className={ICON_SIZE} />, moduleKey: "ops:categories" },
    ],
  },
  {
    label: "HR",
    icon: <Bot className={ICON_SIZE} />,
    railIcon: <Bot className={RAIL_ICON_SIZE} />,
    dividerBefore: true,
    // BrioHR-style module IA: the sidebar picks a module (People / Leave /
    // Time / Scheduling / Payroll / Performance), the in-module tab strip
    // (components/hr/module-tabs.tsx) switches between its sibling pages.
    // Sub-pages of a module deliberately do NOT get their own sidebar entry —
    // they're reachable from the module tabs, keeping the rail short. URLs
    // are unchanged; orphan pages (analytics, compliance, certifications,
    // shift-swaps) are now reachable and reuse their parent module's key so
    // the access registry needs no new grants.
    subgroups: [
      {
        label: "Overview",
        items: [
          { label: "Dashboard", href: "/hr", icon: <LayoutDashboard className={ICON_SIZE} />, moduleKey: "hr:dashboard" },
          { label: "Analytics", href: "/hr/analytics", icon: <BarChart3 className={ICON_SIZE} />, moduleKey: "hr:dashboard" },
        ],
      },
      {
        label: "People",
        items: [
          { label: "Employees", href: "/hr/employees", icon: <UserCog className={ICON_SIZE} />, moduleKey: "hr:employees" },
          { label: "Certifications", href: "/hr/certifications", icon: <ShieldCheck className={ICON_SIZE} />, moduleKey: "hr:employees" },
          { label: "Memos", href: "/hr/memos", icon: <FileText className={ICON_SIZE} />, moduleKey: "hr:memos" },
        ],
      },
      {
        label: "Leave",
        items: [
          { label: "Requests", href: "/hr/leave", icon: <CalendarOff className={ICON_SIZE} />, moduleKey: "hr:leave" },
        ],
      },
      {
        label: "Time & Attendance",
        items: [
          { label: "Attendance", href: "/hr/attendance", icon: <Clock className={ICON_SIZE} />, moduleKey: "hr:attendance" },
          { label: "Overtime", href: "/hr/overtime", icon: <Clock className={ICON_SIZE} />, moduleKey: "hr:overtime" },
          { label: "Shift Swaps", href: "/hr/shift-swaps", icon: <ArrowLeftRight className={ICON_SIZE} />, moduleKey: "hr:schedules" },
        ],
      },
      {
        label: "Scheduling",
        items: [
          { label: "Schedules", href: "/hr/schedules", icon: <CalendarDays className={ICON_SIZE} />, moduleKey: "hr:schedules" },
          { label: "Availability", href: "/hr/availability", icon: <Clock className={ICON_SIZE} />, moduleKey: "hr:schedules" },
          { label: "Coverage Rules", href: "/hr/coverage", icon: <Flame className={ICON_SIZE} />, moduleKey: "hr:schedules" },
        ],
      },
      {
        label: "Payroll",
        items: [
          { label: "Payroll Runs", href: "/hr/payroll", icon: <Banknote className={ICON_SIZE} />, moduleKey: "hr:payroll" },
          { label: "Allowances", href: "/hr/allowances", icon: <Banknote className={ICON_SIZE} />, moduleKey: "hr:allowances" },
          { label: "Statutory Calendar", href: "/hr/compliance", icon: <CalendarClock className={ICON_SIZE} />, moduleKey: "hr:payroll" },
        ],
      },
      {
        label: "Performance",
        items: [
          { label: "Monthly Scores", href: "/hr/performance", icon: <TrendingUp className={ICON_SIZE} />, moduleKey: "hr:performance" },
          { label: "Review Penalties", href: "/hr/review-penalties", icon: <AlertTriangle className={ICON_SIZE} />, moduleKey: "hr:review-penalties" },
        ],
      },
    ],
  },
  // ── Settings (consolidated). Every configurable surface across the
  // platform lives here, grouped by domain — the per-module "Settings"
  // sidebar entries (POS, Pickup, Reviews, Ads, HR) were folded in so
  // there's one home for config. Page URLs are unchanged (deep links +
  // the /settings hub tiles still work); only the nav was unified. RBAC
  // is per-item, and empty groups auto-hide for users without access.
  {
    label: "Settings",
    icon: <SlidersHorizontal className={ICON_SIZE} />,
    railIcon: <SlidersHorizontal className={RAIL_ICON_SIZE} />,
    dividerBefore: true,
    subgroups: [
      {
        label: "Business",
        items: [
          { label: "Hub",            href: "/settings",         icon: <LayoutDashboard className={ICON_SIZE} />, moduleKey: "settings:outlets" },
          { label: "Outlets",        href: "/settings/outlets", icon: <Building2 className={ICON_SIZE} />,       moduleKey: "settings:outlets" },
          { label: "Staff & Access", href: "/settings/staff",   icon: <UserCog className={ICON_SIZE} />,         moduleKey: "settings:staff" },
          { label: "Approval Rules", href: "/settings/rules",   icon: <ShieldCheck className={ICON_SIZE} />,     moduleKey: "settings:rules" },
        ],
      },
      {
        label: "POS — In-store",
        items: [
          { label: "POS Settings",   href: "/pos/settings", icon: <CreditCard className={ICON_SIZE} />, moduleKey: "pickup:settings" },
          { label: "Printers",       href: "/pos/printers", icon: <Printer className={ICON_SIZE} />,    moduleKey: "pickup:settings" },
          { label: "Table QR Codes", href: "/pos/table-qr", icon: <QrCode className={ICON_SIZE} />,     moduleKey: "pickup:settings" },
        ],
      },
      {
        label: "Pickup App",
        items: [
          { label: "Pickup Settings", href: "/pickup/settings", icon: <ShoppingBag className={ICON_SIZE} />, moduleKey: "pickup:settings" },
        ],
      },
      {
        // Loyalty config — the "set it up once" rewards machinery (was the
        // Rewards › Setup subgroup) plus Birthday Treats, moved here so all
        // configuration lives under Settings. The operational loyalty pages
        // (members, history, campaigns, channels) live under Marketing.
        label: "Loyalty",
        items: [
          { label: "Tiers",           href: "/loyalty/tiers",       icon: <Crown className={ICON_SIZE} />,  moduleKey: "loyalty:rewards" },
          { label: "Discount Engine", href: "/loyalty/promotions",  icon: <Tag className={ICON_SIZE} />,    moduleKey: "loyalty:rewards" },
          { label: "All Rewards",     href: "/loyalty/all-rewards",  icon: <Ticket className={ICON_SIZE} />, moduleKey: "loyalty:rewards" },
          { label: "Outcome Types",   href: "/loyalty/reward-kinds", icon: <Layers className={ICON_SIZE} />, moduleKey: "loyalty:rewards" },
          { label: "Birthday Treats", href: "/loyalty/birthday",     icon: <Cake className={ICON_SIZE} />,   moduleKey: "loyalty:rewards" },
          { label: "Earn Rate",       href: "/loyalty/settings",     icon: <Coins className={ICON_SIZE} />,  moduleKey: "loyalty:rewards" },
        ],
      },
      {
        label: "Marketing",
        items: [
          { label: "Reviews",         href: "/reviews/settings",         icon: <MessageCircle className={ICON_SIZE} />, moduleKey: "reviews:settings" },
          { label: "Google Ads",      href: "/ads/settings",             icon: <Megaphone className={ICON_SIZE} />,     moduleKey: "ads:settings" },
        ],
      },
      {
        label: "People",
        items: [
          { label: "HR Settings", href: "/hr/settings", icon: <UserCog className={ICON_SIZE} />, moduleKey: "hr:settings" },
        ],
      },
      {
        label: "System",
        items: [
          { label: "Stock Count",  href: "/settings/stock-count",  icon: <ClipboardCheck className={ICON_SIZE} />, moduleKey: "settings:stock-count" },
          { label: "Integrations", href: "/settings/integrations", icon: <Plug className={ICON_SIZE} />,           moduleKey: "settings:integrations" },
          { label: "System",       href: "/settings/system",       icon: <Wrench className={ICON_SIZE} />,         moduleKey: "settings:system" },
        ],
      },
    ],
  },
];

// Dev-time guard against nav <-> permission-registry drift. If a nav item
// gates on a module that isn't grantable in the Staff & Access editor (or a
// grantable module has no nav destination), managers silently lose access —
// the exact failure that hid Reviews/Ads/POS settings. finance:* is OWNER-only
// and intentionally not grantable, so it's skipped.
if (process.env.NODE_ENV !== "production") {
  const navKeys = new Set<string>();
  for (const section of NAV_SECTIONS) {
    const items = [...(section.items ?? []), ...(section.subgroups?.flatMap((sg) => sg.items) ?? [])];
    for (const item of items) if (item.moduleKey) navKeys.add(item.moduleKey);
  }
  const missingFromRegistry = [...navKeys].filter((k) => !k.startsWith("finance:") && !GRANTABLE_MODULE_KEYS.has(k));
  const missingFromNav = [...GRANTABLE_MODULE_KEYS].filter((k) => !navKeys.has(k));
  if (missingFromRegistry.length) {
    console.warn("[perms] nav moduleKeys not grantable in Staff & Access (add to lib/modules.ts):", missingFromRegistry);
  }
  if (missingFromNav.length) {
    console.warn("[perms] grantable modules with no nav destination (remove from lib/modules.ts or add to nav):", missingFromNav);
  }
}

// ─── RBAC helper ────────────────────────────────────────────────────────

function canAccess(user: UserProfile | undefined, moduleKey?: string): boolean {
  if (!user) return false;
  // Finance module — consolidated cashflow + bank balances + payroll run-rate.
  // Owner/Admin only, no exceptions. The moduleAccess checkbox cannot
  // override this even if it ends up set on a Manager record.
  if (moduleKey?.startsWith("finance:")) {
    return user.role === "ADMIN" || user.role === "OWNER";
  }
  if (user.role === "ADMIN" || user.role === "OWNER") return true;
  if (!moduleKey) return true;
  if (!user.moduleAccess) return false;
  return user.moduleAccess.includes(moduleKey);
}

// ─── Helpers ────────────────────────────────────────────────────────────

function getSectionHrefs(section: NavSection): string[] {
  if (section.items) return section.items.map((i) => i.href);
  if (section.subgroups) return section.subgroups.flatMap((sg) => sg.items.map((i) => i.href));
  return [];
}

function getVisibleItems(section: NavSection, user: UserProfile | undefined): NavItem[] {
  if (section.items) return section.items.filter((item) => canAccess(user, item.moduleKey));
  if (section.subgroups) return section.subgroups.flatMap((sg) => sg.items.filter((item) => canAccess(user, item.moduleKey)));
  return [];
}

function pathMatchesSection(pathname: string, section: NavSection): boolean {
  // Compute this section's best (longest) matching href against the current
  // pathname, then ensure no other section has a *longer* matching href.
  // Without this, broad sections like Pickup App (`/pickup`) light up
  // simultaneously with more specific sections like Catalog (`/pickup/menu`).
  const bestMatchLen = (s: NavSection): number => {
    let best = -1;
    for (const href of getSectionHrefs(s)) {
      if (pathname === href || pathname.startsWith(href + "/")) {
        if (href.length > best) best = href.length;
      }
    }
    return best;
  };
  const myBest = bestMatchLen(section);
  if (myBest < 0) return false;
  for (const other of NAV_SECTIONS) {
    if (other === section) continue;
    if (bestMatchLen(other) > myBest) return false;
  }
  return true;
}

// ─── Leaf active-state ──────────────────────────────────────────────────
// Same longest-match rule the old NavLink used: a link is active when it's an
// exact match, or a prefix match with no sibling that matches more specifically.
function leafIsActive(pathname: string, href: string, siblingHrefs: string[]): boolean {
  const exact = pathname === href;
  const prefix = !exact && pathname.startsWith(href + "/");
  const siblingBetter =
    prefix &&
    siblingHrefs.some(
      (h) => h !== href && h.length > href.length && (pathname === h || pathname.startsWith(h + "/")),
    );
  return exact || (prefix && !siblingBetter);
}

// Render a section's leaves into the collapsible sub-menu. Handles both flat
// `items` sections and `subgroups` sections (3rd tier) — subgroups render a
// small uppercase label header, then their items. RBAC + empty-group hiding
// preserved exactly.
function renderSectionLinks(
  section: NavSection,
  user: UserProfile | undefined,
  pathname: string,
): React.ReactNode {
  if (section.items) {
    const vis = section.items.filter((item) => canAccess(user, item.moduleKey));
    const hrefs = vis.map((i) => i.href);
    return vis.map((item) => (
      <SidebarMenuSubItem key={item.href}>
        <SidebarMenuSubButton asChild isActive={leafIsActive(pathname, item.href, hrefs)}>
          <Link href={item.href}>
            {item.icon}
            <span className="truncate">{item.label}</span>
          </Link>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    ));
  }
  if (section.subgroups) {
    return section.subgroups.map((sg) => {
      const vis = sg.items.filter((item) => canAccess(user, item.moduleKey));
      if (vis.length === 0) return null;
      const hrefs = vis.map((i) => i.href);
      return (
        <Fragment key={sg.label}>
          <li className="px-2 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40 first:pt-1">
            {sg.label}
          </li>
          {vis.map((item) => (
            <SidebarMenuSubItem key={item.href}>
              <SidebarMenuSubButton asChild isActive={leafIsActive(pathname, item.href, hrefs)}>
                <Link href={item.href}>
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </Fragment>
      );
    });
  }
  return null;
}

// ─── Theme toggle (sidebar footer) ──────────────────────────────────────
function SidebarThemeToggle() {
  const { resolved, setTheme } = useTheme();
  return (
    <button
      onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
      className="flex h-7 w-7 items-center justify-center rounded-md text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
      title={resolved === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {resolved === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

// ─── User footer ────────────────────────────────────────────────────────
function SidebarUserFooter({ user, onLogout }: { user: UserProfile; onLogout: () => void }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <div className="flex items-center gap-2 px-1.5 py-1">
          <Avatar size="sm">
            <AvatarFallback className="bg-sidebar-primary/30 text-sidebar-foreground text-xs">
              {user.name?.slice(0, 2).toUpperCase() || "U"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-xs font-medium text-sidebar-foreground">{user.name}</p>
            <p className="truncate text-[10px] text-sidebar-foreground/50">{user.role}</p>
          </div>
          <div className="flex items-center gap-0.5 group-data-[collapsible=icon]:hidden">
            <SidebarThemeToggle />
            <button
              onClick={onLogout}
              title="Logout"
              className="flex h-7 w-7 items-center justify-center rounded-md text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </SidebarMenuItem>
      <SidebarMenuItem className="group-data-[collapsible=icon]:hidden">
        <div className="px-0.5">
          <PasswordChangeDialog hasPassword={user.hasPassword} />
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

// ─── App Sidebar (single collapsible) ───────────────────────────────────
function AppSidebar({
  user,
  pathname,
  openSection,
  onSectionToggle,
  onLogout,
}: {
  user: UserProfile;
  pathname: string;
  openSection: string | null;
  onSectionToggle: (label: string) => void;
  onLogout: () => void;
}) {
  const isDashboard = pathname === "/dashboard" || pathname === "/";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-1.5 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <Image
            src="/images/celsius-logo-sm.jpg"
            alt="Celsius"
            width={32}
            height={32}
            className="rounded-lg shrink-0 group-data-[collapsible=icon]:hidden"
          />
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <p className="font-heading text-sm font-bold leading-tight text-sidebar-foreground">Celsius Ops</p>
            <p className="text-[10px] text-sidebar-foreground/50">Backoffice</p>
          </div>
          {/* Collapse/expand toggle lives in the sidebar (desktop only). When
              collapsed it's the lone centered control; mobile uses the top-bar
              trigger instead, so hide this below md. */}
          <SidebarTrigger className="shrink-0 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground max-md:hidden" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {/* Dashboard — always available */}
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={isDashboard} tooltip="Dashboard">
                <Link href="/dashboard">
                  <LayoutDashboard />
                  <span>Dashboard</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {NAV_SECTIONS.map((section) => {
              const visible = getVisibleItems(section, user);
              if (visible.length === 0) return null;

              const sectionActive = pathMatchesSection(pathname, section);
              const open = openSection === section.label;

              return (
                <SidebarMenuItem key={section.label}>
                  <SidebarMenuButton
                    isActive={sectionActive && !open}
                    tooltip={section.label}
                    aria-expanded={open}
                    onClick={() => onSectionToggle(section.label)}
                  >
                    {section.icon}
                    <span className="truncate group-data-[collapsible=icon]:hidden">{section.label}</span>
                    <ChevronRight
                      className={`ml-auto shrink-0 transition-transform group-data-[collapsible=icon]:hidden ${open ? "rotate-90" : ""}`}
                    />
                  </SidebarMenuButton>
                  {open && <SidebarMenuSub>{renderSectionLinks(section, user, pathname)}</SidebarMenuSub>}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarUserFooter user={user} onLogout={onLogout} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

// ─── Password Change Dialog ─────────────────────────────────────────────

function PasswordChangeDialog({ hasPassword }: { hasPassword?: boolean }) {
  const [open, setOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const reset = () => {
    setCurrentPw("");
    setNewPw("");
    setConfirmPw("");
    setError("");
    setSuccess(false);
    setShowCurrent(false);
    setShowNew(false);
  };

  const handleSave = async () => {
    setError("");
    if (newPw.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (newPw !== confirmPw) { setError("Passwords do not match"); return; }

    setSaving(true);
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: hasPassword ? currentPw : undefined,
          newPassword: newPw,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to save"); setSaving(false); return; }

      setSuccess(true);
      setTimeout(() => { setOpen(false); reset(); }, 1500);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors cursor-pointer"
      >
        <Lock className="h-3 w-3" />
        {hasPassword ? "Change Password" : "Set Password"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{hasPassword ? "Change Password" : "Set Password"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {hasPassword && (
            <div className="relative">
              <input
                type={showCurrent ? "text" : "password"}
                placeholder="Current password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                className="w-full rounded-lg border border-border bg-transparent px-3 py-2 pr-9 text-sm outline-none focus:ring-2 focus:ring-ring/50"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          )}
          <div className="relative">
            <input
              type={showNew ? "text" : "password"}
              placeholder="New password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className="w-full rounded-lg border border-border bg-transparent px-3 py-2 pr-9 text-sm outline-none focus:ring-2 focus:ring-ring/50"
            />
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
            >
              {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <input
            type={showNew ? "text" : "password"}
            placeholder="Confirm new password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/50"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          {success && (
            <p className="flex items-center gap-1 text-xs text-green-600">
              <Check className="h-3 w-3" /> Password saved
            </p>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !newPw || !confirmPw}
            className="flex w-full items-center justify-center rounded-lg bg-terracotta py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Password"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Admin Layout ───────────────────────────────────────────────────────

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // Which top-level section is expanded in the sidebar accordion (one at a
  // time). Auto-follows the active route; user can toggle.
  const [openSection, setOpenSection] = useState<string | null>(null);

  const { data: user, isLoading } = useFetch<UserProfile>("/api/auth/me");

  // Redirect to login if not authenticated, or if a STAFF session somehow
  // reached the backoffice (login API only issues sessions to OWNER/ADMIN/
  // MANAGER, but a stale or cross-subdomain cookie could land here).
  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.push("/login");
      return;
    }
    if (!["OWNER", "ADMIN", "MANAGER"].includes(user.role)) {
      router.push("/login?reason=role");
    }
  }, [isLoading, user, router]);

  // Block direct URL access to unauthorized pages
  useEffect(() => {
    if (!user || !pathname) return;
    // Dashboard is always accessible
    if (pathname === "/dashboard" || pathname === "/") return;
    // OWNER and ADMIN bypass all checks
    if (user.role === "ADMIN" || user.role === "OWNER") return;
    // NOTE: there is no "empty moduleAccess = full access" escape here. The
    // sidebar render path (canAccess) already denies every gated item when
    // moduleAccess is empty, so such a manager only ever sees Dashboard in the
    // nav. Letting the URL guard fall through to the same canAccess check below
    // keeps direct-URL access consistent with what the sidebar exposes —
    // previously an empty-moduleAccess manager had a blank sidebar but could
    // still reach every non-finance page by typing the URL.

    // Match the current path to the MOST SPECIFIC (longest-href) nav item,
    // then gate on that item's module. A first-match loop let a broad parent
    // like the Settings "Hub" (/settings) shadow more specific siblings such
    // as /settings/staff — so a manager who has settings:staff but not the
    // Hub's settings:outlets got bounced to /dashboard the instant they
    // opened Settings. Longest-match mirrors the sidebar's active-link logic.
    let best: NavItem | undefined;
    for (const section of NAV_SECTIONS) {
      const allItems = [
        ...(section.items ?? []),
        ...(section.subgroups?.flatMap((sg) => sg.items) ?? []),
      ];
      for (const item of allItems) {
        if (pathname === item.href || pathname.startsWith(item.href + "/")) {
          if (!best || item.href.length > best.href.length) best = item;
        }
      }
    }
    if (best?.moduleKey && !canAccess(user, best.moduleKey)) {
      router.replace("/dashboard");
    }
  }, [user, pathname, router]);

  // Auto-open the section that matches the current route.
  useEffect(() => {
    const isDashboard = pathname === "/dashboard" || pathname === "/";
    if (isDashboard) {
      setOpenSection(null);
      return;
    }

    for (const section of NAV_SECTIONS) {
      if (pathMatchesSection(pathname, section)) {
        setOpenSection(section.label);
        return;
      }
    }
  }, [pathname]);

  const handleSectionToggle = (label: string) => {
    const section = NAV_SECTIONS.find((s) => s.label === label);
    if (!section) return;

    const visible = getVisibleItems(section, user);
    const firstHref = visible[0]?.href;
    const alreadyInModule = pathMatchesSection(pathname, section);

    // Click the open section while already on one of its pages → collapse it.
    if (openSection === label && alreadyInModule) {
      setOpenSection(null);
      return;
    }

    // Otherwise: expand it and navigate to its first visible page so the main
    // area follows the sidebar.
    if (firstHref) {
      router.push(firstHref);
    }
    setOpenSection(label);
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-brand-offwhite">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-terracotta border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <SidebarProvider className="h-svh overflow-hidden print:h-auto print:overflow-visible">
      {/* Sidebar is app chrome — never printed (contents = transparent on screen). */}
      <div className="contents print:hidden">
        <AppSidebar
          user={user}
          pathname={pathname}
          openSection={openSection}
          onSectionToggle={handleSectionToggle}
          onLogout={handleLogout}
        />
      </div>
      <SidebarInset className="min-w-0 bg-brand-offwhite print:overflow-visible">
        {/* Mobile-only top bar — tap the trigger to open the sidebar sheet.
            Desktop has no top chrome: the toggle lives in the sidebar header,
            plus the drag rail and ⌘B. */}
        <header className="flex items-center gap-3 border-b border-border bg-white px-4 py-3 dark:bg-card md:hidden print:hidden">
          <SidebarTrigger className="text-foreground" />
          <Image
            src="/images/celsius-logo-sm.jpg"
            alt="Celsius"
            width={24}
            height={24}
            className="rounded-md"
          />
          <span className="font-heading text-sm font-bold">Celsius Ops</span>
        </header>

        {/* Page content */}
        <PullToRefresh
          onRefresh={async () => { window.location.reload(); }}
          className="flex-1 overflow-y-auto overflow-x-hidden print:overflow-visible print:h-auto"
        >
          {children}
        </PullToRefresh>
      </SidebarInset>
      {/* Global ⌘K palette — toggles via Cmd/Ctrl+K from anywhere */}
      <CommandPalette />
    </SidebarProvider>
  );
}
