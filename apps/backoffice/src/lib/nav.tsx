// Backoffice navigation registry — the single source of truth for the sidebar
// tree, the ⌘K palette's page index, and the client-side route gate in
// (admin)/layout.tsx. Page URLs never change here; only labels/grouping do,
// so deep links and bookmarks always survive a nav reshuffle.
//
// Rail order groups by how often each area is worked, top to bottom:
//   run the shops   → Sales · Procurement · Ops
//   people & money  → HR · Finance
//   growth          → Rewards · Marketing
//   configuration   → Catalog · Settings
// (Dashboard sits above all of these; it's rendered separately by the layout.)

import {
  ShoppingBag,
  Box,
  Boxes,
  Gift,
  SlidersHorizontal,
  LayoutDashboard,
  ClipboardList,
  UtensilsCrossed,
  BarChart3,
  Scissors,
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
  Scale,
  HandCoins,
  Layers,
  CalendarClock,
  MessageCircle,
  Coins,
  Clock,
  CalendarDays,
  CalendarOff,
  Flame,
  Banknote,
  TableProperties,
  ImagePlus,
  Target,
  Trophy,
  Cake,
  Ticket,
  CreditCard,
  QrCode,
  Printer,
  Landmark,
} from "lucide-react";
import { GRANTABLE_MODULE_KEYS } from "@/lib/modules";

// ─── Types ──────────────────────────────────────────────────────────────

export type UserProfile = {
  id: string;
  name: string;
  role: string;
  outletId: string | null;
  outletName?: string | null;
  moduleAccess?: string[];
  hasPassword?: boolean;
};

export type NavItem = {
  label: string;
  href: string;
  icon: React.ReactNode;
  moduleKey?: string;
};

export type NavSubgroup = {
  label: string;
  items: NavItem[];
};

export type NavSection = {
  label: string;
  icon: React.ReactNode;
  moduleKey?: string; // top-level module check
  items?: NavItem[];
  subgroups?: NavSubgroup[];
  dividerBefore?: boolean; // start of a new rail cluster
};

const ICON_SIZE = "h-4 w-4";

export const NAV_SECTIONS: NavSection[] = [
  // Sales — one tab for everything sales/POS. Subgroups by cadence: the
  // analytics you check first, the surfaces worked during service, then the
  // period-close reports. Customers points at /loyalty/members (the
  // consolidated customer page).
  {
    label: "Sales",
    icon: <BarChart3 className={ICON_SIZE} />,
    dividerBefore: true,
    subgroups: [
      {
        label: "Overview",
        items: [
          { label: "Dashboard", href: "/sales/dashboard", icon: <LayoutDashboard className={ICON_SIZE} />, moduleKey: "sales:dashboard" },
          { label: "Compare",   href: "/sales/compare",   icon: <Scale className={ICON_SIZE} />,           moduleKey: "sales:dashboard" },
        ],
      },
      {
        label: "Daily",
        items: [
          { label: "Orders",              href: "/pickup/orders",         icon: <ClipboardList className={ICON_SIZE} />, moduleKey: "pickup:orders" },
          { label: "Customers",           href: "/loyalty/members",       icon: <Users className={ICON_SIZE} />,         moduleKey: "loyalty:members" },
          { label: "Store / Menu Status", href: "/pos/store-menu-status", icon: <Power className={ICON_SIZE} />,         moduleKey: "pickup:settings" },
        ],
      },
      {
        label: "Reports",
        items: [
          { label: "Reports",             href: "/pos/reports",             icon: <BarChart3 className={ICON_SIZE} />, moduleKey: "sales:reports" },
          { label: "Cashier Performance", href: "/pos/cashier-performance", icon: <Users className={ICON_SIZE} />,     moduleKey: "sales:reports" },
        ],
      },
    ],
  },
  // Procurement — subgroups ordered by daily flow: check the dashboard,
  // do the ordering work, count/adjust stock, and master data last (it's
  // set-up-once reference data, not daily work).
  {
    label: "Procurement",
    icon: <Boxes className={ICON_SIZE} />,
    subgroups: [
      {
        label: "Overview",
        items: [
          { label: "Dashboard", href: "/inventory/dashboard", icon: <LayoutDashboard className={ICON_SIZE} />, moduleKey: "inventory:products" },
          { label: "Reports",   href: "/inventory/reports",   icon: <LineChart className={ICON_SIZE} />,       moduleKey: "inventory:reports" },
        ],
      },
      {
        // Owner-preferred labels (restored 2026-07-11 after the #894 rename
        // didn't stick): "Purchase Orders" = the WhatsApp supplier-chat
        // surface where POs are raised; "PO List" = the resulting list at
        // /inventory/orders. This is the team's established vocabulary —
        // don't "fix" it again.
        label: "Ordering",
        items: [
          { label: "Purchase Orders", href: "/inventory/supplier-chats", icon: <MessageCircle className={ICON_SIZE} />,  moduleKey: "inventory:orders" },
          { label: "PO List",         href: "/inventory/orders",         icon: <FileText className={ICON_SIZE} />,       moduleKey: "inventory:orders" },
          // Agent QA runs in the background (the verifier grades every decision
          // regardless); the viewer stays at /inventory/agent-qa, off the nav by choice.
          { label: "Receivings",       href: "/inventory/receivings",     icon: <Receipt className={ICON_SIZE} />,        moduleKey: "inventory:receivings" },
          { label: "Invoices",         href: "/inventory/invoices",       icon: <ClipboardList className={ICON_SIZE} />,  moduleKey: "inventory:invoices" },
          { label: "Reconciliation",   href: "/inventory/reconciliation", icon: <Scale className={ICON_SIZE} />,          moduleKey: "inventory:invoices" },
          { label: "Payment Requests", href: "/inventory/pay-and-claim",  icon: <HandCoins className={ICON_SIZE} />,      moduleKey: "inventory:pay-and-claim" },
          { label: "Transfers",        href: "/inventory/transfers",      icon: <ArrowLeftRight className={ICON_SIZE} />, moduleKey: "inventory:transfers" },
        ],
      },
      {
        label: "Stock",
        items: [
          { label: "Stock Count", href: "/inventory/stock-count", icon: <ClipboardCheck className={ICON_SIZE} />, moduleKey: "inventory:stock-count" },
          { label: "Wastage",     href: "/inventory/wastage",     icon: <Trash2 className={ICON_SIZE} />,         moduleKey: "inventory:wastage" },
          { label: "Par Levels",  href: "/inventory/par-levels",  icon: <TrendingUp className={ICON_SIZE} />,     moduleKey: "inventory:par-levels" },
        ],
      },
      {
        // Packaging's nav home is Catalog (it's part of the menu definition —
        // cups/lids/straws attach to menu items & channels); it was listed in
        // both sections before, which read as two different pages.
        label: "Master Data",
        items: [
          { label: "Ingredients",      href: "/inventory/products",    icon: <Package className={ICON_SIZE} />, moduleKey: "inventory:products" },
          { label: "Perishables",      href: "/inventory/perishables", icon: <Box className={ICON_SIZE} />,     moduleKey: "inventory:perishables" },
          { label: "Suppliers",        href: "/inventory/suppliers",   icon: <Truck className={ICON_SIZE} />,   moduleKey: "inventory:suppliers" },
          { label: "Groups & Storage", href: "/inventory/groups",      icon: <Tags className={ICON_SIZE} />,    moduleKey: "inventory:categories" },
        ],
      },
    ],
  },
  // Ops — Overview (how the shops are doing), Daily (the surfaces worked
  // through the day), Setup (the SOP/category definitions behind them).
  {
    label: "Ops",
    icon: <ClipboardCheck className={ICON_SIZE} />,
    subgroups: [
      {
        label: "Overview",
        items: [
          { label: "Dashboard",   href: "/ops/dashboard",   icon: <LayoutDashboard className={ICON_SIZE} />, moduleKey: "ops:performance" },
          { label: "Performance", href: "/ops/performance", icon: <BarChart3 className={ICON_SIZE} />,       moduleKey: "ops:performance" },
        ],
      },
      {
        label: "Daily",
        items: [
          { label: "Ops Workspace", href: "/ops/chat-inbox", icon: <MessageSquare className={ICON_SIZE} />,  moduleKey: "ops:chat-inbox" },
          { label: "Audits",        href: "/ops/audit",      icon: <ClipboardCheck className={ICON_SIZE} />, moduleKey: "ops:audit" },
        ],
      },
      {
        label: "Setup",
        items: [
          { label: "SOPs & Templates", href: "/ops/sops",       icon: <BookOpen className={ICON_SIZE} />, moduleKey: "ops:sops" },
          { label: "Categories",       href: "/ops/categories", icon: <Tags className={ICON_SIZE} />,     moduleKey: "ops:categories" },
        ],
      },
    ],
  },
  {
    label: "HR",
    icon: <Users className={ICON_SIZE} />,
    dividerBefore: true,
    // BrioHR-style module IA: the sidebar picks a module, the in-module tab
    // strip (components/hr/module-tabs.tsx) switches between its sibling
    // pages. Sub-pages of a module deliberately do NOT get their own sidebar
    // entry. URLs are unchanged; orphan pages (analytics, compliance,
    // certifications, shift-swaps) reuse their parent module's key so the
    // access registry needs no new grants.
    subgroups: [
      {
        label: "Overview",
        items: [
          { label: "Dashboard", href: "/hr",           icon: <LayoutDashboard className={ICON_SIZE} />, moduleKey: "hr:dashboard" },
          { label: "Analytics", href: "/hr/analytics", icon: <BarChart3 className={ICON_SIZE} />,       moduleKey: "hr:dashboard" },
        ],
      },
      {
        label: "People",
        items: [
          { label: "Employees",      href: "/hr/employees",      icon: <UserCog className={ICON_SIZE} />,     moduleKey: "hr:employees" },
          { label: "Certifications", href: "/hr/certifications", icon: <ShieldCheck className={ICON_SIZE} />, moduleKey: "hr:employees" },
          { label: "Memos",          href: "/hr/memos",          icon: <FileText className={ICON_SIZE} />,    moduleKey: "hr:memos" },
        ],
      },
      {
        label: "Time & Leave",
        items: [
          { label: "Attendance",     href: "/hr/attendance",  icon: <Clock className={ICON_SIZE} />,          moduleKey: "hr:attendance" },
          { label: "Overtime",       href: "/hr/overtime",    icon: <Clock className={ICON_SIZE} />,          moduleKey: "hr:overtime" },
          { label: "Leave Requests", href: "/hr/leave",       icon: <CalendarOff className={ICON_SIZE} />,    moduleKey: "hr:leave" },
          { label: "Shift Swaps",    href: "/hr/shift-swaps", icon: <ArrowLeftRight className={ICON_SIZE} />, moduleKey: "hr:schedules" },
        ],
      },
      {
        label: "Scheduling",
        items: [
          { label: "Schedules",      href: "/hr/schedules",    icon: <CalendarDays className={ICON_SIZE} />, moduleKey: "hr:schedules" },
          { label: "Availability",   href: "/hr/availability", icon: <Clock className={ICON_SIZE} />,        moduleKey: "hr:schedules" },
          { label: "Coverage Rules", href: "/hr/coverage",     icon: <Flame className={ICON_SIZE} />,        moduleKey: "hr:schedules" },
        ],
      },
      {
        label: "Payroll",
        items: [
          { label: "Payroll Runs",       href: "/hr/payroll",    icon: <Banknote className={ICON_SIZE} />,      moduleKey: "hr:payroll" },
          { label: "Allowances",         href: "/hr/allowances", icon: <Banknote className={ICON_SIZE} />,      moduleKey: "hr:allowances" },
          { label: "Statutory Calendar", href: "/hr/compliance", icon: <CalendarClock className={ICON_SIZE} />, moduleKey: "hr:payroll" },
        ],
      },
      {
        label: "Performance",
        items: [
          { label: "Monthly Scores",   href: "/hr/performance",      icon: <TrendingUp className={ICON_SIZE} />,    moduleKey: "hr:performance" },
          { label: "Review Penalties", href: "/hr/review-penalties", icon: <AlertTriangle className={ICON_SIZE} />, moduleKey: "hr:review-penalties" },
        ],
      },
    ],
  },
  // Finance — moduleKeys start with "finance:", which canAccess hard-restricts
  // to OWNER/ADMIN regardless of moduleAccess, so the section won't render in
  // the rail for managers/staff.
  {
    label: "Finance",
    icon: <Banknote className={ICON_SIZE} />,
    subgroups: [
      {
        label: "Books",
        items: [
          { label: "Ledger",         href: "/finance/transactions", icon: <FileText className={ICON_SIZE} />,   moduleKey: "finance:transactions" },
          { label: "Reports",        href: "/finance/reports",      icon: <TrendingUp className={ICON_SIZE} />, moduleKey: "finance:reports" },
          { label: "Reconciliation", href: "/finance/recon",        icon: <Scale className={ICON_SIZE} />,      moduleKey: "finance:reports" },
        ],
      },
      {
        label: "Reference",
        items: [
          { label: "Chart of Accounts", href: "/finance/coa",          icon: <BookOpen className={ICON_SIZE} />, moduleKey: "finance:reports" },
          { label: "Fixed Assets",      href: "/finance/fixed-assets", icon: <Landmark className={ICON_SIZE} />, moduleKey: "finance:reports" },
        ],
      },
      {
        // Pre-agentic views — kept until the new module reaches parity, and
        // labelled as such so nobody mistakes them for the system of record.
        label: "Legacy",
        items: [
          { label: "Cashflow",      href: "/finance/cashflow",      icon: <LineChart className={ICON_SIZE} />,       moduleKey: "finance:cashflow" },
          { label: "Cash Tracking", href: "/finance/cash-tracking", icon: <TableProperties className={ICON_SIZE} />, moduleKey: "finance:cash-tracking" },
        ],
      },
      // Hidden from the rail (Home/Compliance/Bank Statements/Payouts/Recurring
      // Expenses) — pages still exist, just dropped from nav per owner. Re-add a
      // line here to restore any of them.
    ],
  },
  // Rewards — the loyalty programme's day-to-day surfaces. The loyalty
  // *config* (Tiers, Discount Engine, All Rewards, Outcome Types, Birthday
  // Treats, Earn Rate) lives under Settings → Loyalty.
  {
    label: "Rewards",
    icon: <Gift className={ICON_SIZE} />,
    dividerBefore: true,
    subgroups: [
      {
        // The rewards-program Overview was replaced by the Area Scorecard:
        // a per-outlet KPI scoreboard (loyalty capture, upsell, ops
        // compliance, wastage). The mechanic-specific rewards Analytics /
        // AI Insights pages remain available via deep-link
        // (/loyalty/analytics, /loyalty/insights).
        label: "Overview",
        items: [
          { label: "Area Scorecard", href: "/loyalty/dashboard", icon: <Trophy className={ICON_SIZE} />, moduleKey: "loyalty:dashboard" },
        ],
      },
      {
        label: "Campaigns",
        items: [
          // Campaigns = Loops. The legacy preset editor (/loyalty/campaigns)
          // is retired (redirects here); every objective now runs as an
          // adaptive loop (holdout + offer/voucher/send-time learning).
          { label: "Campaigns", href: "/loyalty/loops",  icon: <Repeat className={ICON_SIZE} />,        moduleKey: "loyalty:campaigns" },
          // Engage = unified surface for "how we reach customers". Push
          // reminders (auto) + SMS broadcasts (manual) are tabs inside it.
          { label: "Engage",    href: "/loyalty/engage", icon: <MessageSquare className={ICON_SIZE} />, moduleKey: "loyalty:engage" },
        ],
      },
      {
        // Channels = "where rewards reach customers", ordered to mirror the
        // pickup app's rewards screen. Manual Grant sits here too — it's the
        // admin-issued channel, and too small to warrant its own subgroup.
        //
        // The Points Shop has no entry: its catalog is managed in
        // Settings → Loyalty → All Rewards (any template with points_cost
        // set is a points-shop item).
        label: "Channels",
        items: [
          { label: "Challenges",       href: "/loyalty/missions",         icon: <Target className={ICON_SIZE} />,    moduleKey: "loyalty:rewards" },
          { label: "Mystery Pool",     href: "/loyalty/mystery",          icon: <Sparkles className={ICON_SIZE} />,  moduleKey: "loyalty:rewards" },
          { label: "Admin Claimables", href: "/loyalty/admin-claimables", icon: <Gift className={ICON_SIZE} />,      moduleKey: "loyalty:rewards" },
          { label: "Manual Grant",     href: "/loyalty/manual-grant",     icon: <HandCoins className={ICON_SIZE} />, moduleKey: "loyalty:manual-grant" },
        ],
      },
      {
        // History = read-only audit trails of what was issued + redeemed.
        label: "History",
        items: [
          { label: "Vouchers Issued",    href: "/loyalty/vouchers",    icon: <TicketPercent className={ICON_SIZE} />, moduleKey: "loyalty:redemptions" },
          { label: "Points Redemptions", href: "/loyalty/redemptions", icon: <Receipt className={ICON_SIZE} />,       moduleKey: "loyalty:redemptions" },
          { label: "Points Log",         href: "/loyalty/points-log",  icon: <Coins className={ICON_SIZE} />,         moduleKey: "loyalty:redemptions" },
        ],
      },
    ],
  },
  // Marketing — the outward-facing channels: customer reviews + paid ads
  // (Google + GrabFood in one Advertising group).
  {
    label: "Marketing",
    icon: <Megaphone className={ICON_SIZE} />,
    subgroups: [
      {
        label: "Reviews",
        items: [
          { label: "All Reviews",         href: "/reviews",            icon: <Star className={ICON_SIZE} />,          moduleKey: "reviews:list" },
          { label: "Feedback Management", href: "/reviews/feedback",   icon: <MessageSquare className={ICON_SIZE} />, moduleKey: "reviews:list" },
          { label: "Local Rank",          href: "/reviews/geogrid",    icon: <MapPinned className={ICON_SIZE} />,     moduleKey: "reviews:list" },
          { label: "Rank Scoreboard",     href: "/reviews/scoreboard", icon: <Target className={ICON_SIZE} />,        moduleKey: "reviews:list" },
        ],
      },
      {
        label: "Advertising",
        items: [
          { label: "Google Ads Overview", href: "/ads",           icon: <LayoutDashboard className={ICON_SIZE} />, moduleKey: "ads:overview" },
          { label: "Campaigns",           href: "/ads/campaigns", icon: <BarChart3 className={ICON_SIZE} />,       moduleKey: "ads:campaigns" },
          { label: "Optimizer",           href: "/ads/optimizer", icon: <Scissors className={ICON_SIZE} />,        moduleKey: "ads:campaigns" },
          { label: "Ad Invoices",         href: "/ads/invoices",  icon: <Receipt className={ICON_SIZE} />,         moduleKey: "ads:invoices" },
          { label: "GrabFood Ads",        href: "/ads/grab",      icon: <Megaphone className={ICON_SIZE} />,       moduleKey: "ads:grab" },
        ],
      },
    ],
  },
  // Catalog (= product catalog) is shared across POS, Pickup app, and the
  // Grab integration. It's definition/config work, not daily ops, so it sits
  // in the configuration cluster next to Settings. URLs stay at /pickup/* //
  // /inventory/* to avoid breaking bookmarks.
  {
    label: "Catalog",
    icon: <UtensilsCrossed className={ICON_SIZE} />,
    dividerBefore: true,
    // Ordered by how central each is to the menu definition: the product
    // list, then what makes up each product (BOM → printable cards →
    // packaging rules), and app presentation (splash posters) last.
    items: [
      { label: "Products", href: "/pickup/menu", icon: <UtensilsCrossed className={ICON_SIZE} />, moduleKey: "pickup:menu" },
      // Menu & BOM (recipe/BOM editor) lives with the catalog/menu definition,
      // not under Procurement. Gate stays inventory:menus so access is unchanged.
      { label: "Menu & BOM",   href: "/inventory/menus",       icon: <BookOpen className={ICON_SIZE} />, moduleKey: "inventory:menus" },
      // Printable per-item BOM. Sub-route of Menu & BOM, same module gate.
      { label: "Recipe Cards", href: "/inventory/menus/cards", icon: <Printer className={ICON_SIZE} />,  moduleKey: "inventory:menus" },
      // Packaging rules attach cups/lids/straws to menu items & channels —
      // part of the menu definition. Single nav home (dropped the duplicate
      // Procurement → Master Data entry). Gate stays inventory:packaging.
      { label: "Packaging",      href: "/inventory/packaging",   icon: <PackageOpen className={ICON_SIZE} />, moduleKey: "inventory:packaging" },
      { label: "Splash Posters", href: "/pickup/splash-posters", icon: <ImagePlus className={ICON_SIZE} />,   moduleKey: "pickup:menu" },
    ],
  },
  // ── Settings (consolidated). Every configurable surface across the
  // platform lives here, grouped by domain. Page URLs are unchanged (deep
  // links + the /settings hub tiles still work). RBAC is per-item, and empty
  // groups auto-hide for users without access.
  {
    label: "Settings",
    icon: <SlidersHorizontal className={ICON_SIZE} />,
    subgroups: [
      {
        label: "Business",
        items: [
          { label: "Hub",            href: "/settings",         icon: <LayoutDashboard className={ICON_SIZE} />, moduleKey: "settings:outlets" },
          { label: "Outlets",        href: "/settings/outlets", icon: <Building2 className={ICON_SIZE} />,       moduleKey: "settings:outlets" },
          { label: "Staff & Access", href: "/settings/staff",   icon: <UserCog className={ICON_SIZE} />,         moduleKey: "settings:staff" },
          { label: "Approval Rules", href: "/settings/rules",   icon: <ShieldCheck className={ICON_SIZE} />,     moduleKey: "settings:rules" },
          { label: "HR Settings",    href: "/hr/settings",      icon: <UserCog className={ICON_SIZE} />,         moduleKey: "hr:settings" },
        ],
      },
      {
        label: "POS & Pickup",
        items: [
          { label: "POS Settings",    href: "/pos/settings",    icon: <CreditCard className={ICON_SIZE} />,  moduleKey: "pickup:settings" },
          { label: "Printers",        href: "/pos/printers",    icon: <Printer className={ICON_SIZE} />,     moduleKey: "pickup:settings" },
          { label: "Table QR Codes",  href: "/pos/table-qr",    icon: <QrCode className={ICON_SIZE} />,      moduleKey: "pickup:settings" },
          { label: "Pickup Settings", href: "/pickup/settings", icon: <ShoppingBag className={ICON_SIZE} />, moduleKey: "pickup:settings" },
        ],
      },
      {
        // Loyalty config — the "set it up once" rewards machinery. The
        // operational loyalty pages (scorecard, channels, history, campaigns)
        // live under the Rewards section.
        label: "Loyalty",
        items: [
          { label: "Tiers",           href: "/loyalty/tiers",        icon: <Crown className={ICON_SIZE} />,  moduleKey: "loyalty:rewards" },
          { label: "Discount Engine", href: "/loyalty/promotions",   icon: <Tag className={ICON_SIZE} />,    moduleKey: "loyalty:rewards" },
          { label: "All Rewards",     href: "/loyalty/all-rewards",  icon: <Ticket className={ICON_SIZE} />, moduleKey: "loyalty:rewards" },
          { label: "Outcome Types",   href: "/loyalty/reward-kinds", icon: <Layers className={ICON_SIZE} />, moduleKey: "loyalty:rewards" },
          { label: "Birthday Treats", href: "/loyalty/birthday",     icon: <Cake className={ICON_SIZE} />,   moduleKey: "loyalty:rewards" },
          { label: "Earn Rate",       href: "/loyalty/settings",     icon: <Coins className={ICON_SIZE} />,  moduleKey: "loyalty:rewards" },
        ],
      },
      {
        label: "Marketing",
        items: [
          { label: "Reviews",    href: "/reviews/settings", icon: <MessageCircle className={ICON_SIZE} />, moduleKey: "reviews:settings" },
          { label: "Google Ads", href: "/ads/settings",     icon: <Megaphone className={ICON_SIZE} />,     moduleKey: "ads:settings" },
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

// Finer module keys carved out of a broader grant, mapped to the parent that
// still satisfies them during transition. Lets us split coarse bundles without
// a data backfill: existing parent-holders keep the carved-out pages until
// their grants are migrated to the finer keys (see canAccess).
const LEGACY_MODULE_FALLBACK: Record<string, string> = {
  "sales:reports": "pickup:settings",
  "loyalty:manual-grant": "loyalty:rewards",
};

export function canAccess(user: UserProfile | undefined, moduleKey?: string): boolean {
  if (!user) return false;
  // Finance module — consolidated cashflow + bank balances + payroll run-rate.
  // Owner/Admin only, no exceptions. The moduleAccess checkbox cannot
  // override this even if it ends up set on a Manager record.
  if (moduleKey?.startsWith("finance:")) {
    return user.role === "ADMIN" || user.role === "OWNER";
  }
  // Payroll (runs / allowances / statutory) is Owner/Admin only — managers never
  // see it in the nav even if the moduleAccess checkbox is set (payroll routes are
  // OWNER/ADMIN-gated too). Keeps pay off managers' screens.
  if (moduleKey === "hr:payroll" || moduleKey === "hr:allowances") {
    return user.role === "ADMIN" || user.role === "OWNER";
  }
  if (user.role === "ADMIN" || user.role === "OWNER") return true;
  if (!moduleKey) return true;
  if (!user.moduleAccess) return false;
  if (user.moduleAccess.includes(moduleKey)) return true;
  // Backward-compat for keys split out of a broader grant: anyone who still
  // holds the original parent keeps access to the carved-out pages, so the
  // split disturbs no existing grant and needs no data backfill. Drop an entry
  // here once its grant has been migrated to the finer key.
  const legacyParent = LEGACY_MODULE_FALLBACK[moduleKey];
  return legacyParent ? user.moduleAccess.includes(legacyParent) : false;
}

// ─── Helpers ────────────────────────────────────────────────────────────

export function getSectionHrefs(section: NavSection): string[] {
  if (section.items) return section.items.map((i) => i.href);
  if (section.subgroups) return section.subgroups.flatMap((sg) => sg.items.map((i) => i.href));
  return [];
}

export function getVisibleItems(section: NavSection, user: UserProfile | undefined): NavItem[] {
  if (section.items) return section.items.filter((item) => canAccess(user, item.moduleKey));
  if (section.subgroups) return section.subgroups.flatMap((sg) => sg.items.filter((item) => canAccess(user, item.moduleKey)));
  return [];
}

export function pathMatchesSection(pathname: string, section: NavSection): boolean {
  // Compute this section's best (longest) matching href against the current
  // pathname, then ensure no other section has a *longer* matching href.
  // Without this, sections sharing a URL prefix (e.g. Catalog's /pickup/menu
  // vs Sales' /pickup/orders vs Settings' /pickup/settings) could light up
  // simultaneously.
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

// Leaf active-state: same longest-match rule as sections — a link is active
// when it's an exact match, or a prefix match with no sibling that matches
// more specifically.
export function leafIsActive(pathname: string, href: string, siblingHrefs: string[]): boolean {
  const exact = pathname === href;
  const prefix = !exact && pathname.startsWith(href + "/");
  const siblingBetter =
    prefix &&
    siblingHrefs.some(
      (h) => h !== href && h.length > href.length && (pathname === h || pathname.startsWith(h + "/")),
    );
  return exact || (prefix && !siblingBetter);
}

// The backoffice home (/dashboard) is the company KPI command centre. Managers
// see it only with the Sales dashboard grant; OWNER/ADMIN always do. Anyone
// without it is routed to their first accessible page instead.
export const DASHBOARD_HOME_MODULE = "sales:dashboard";

// First nav destination a user can actually open, in sidebar order. Used as the
// safe redirect target so a gated page never bounces someone to a home they
// also can't see. Returns undefined only when the user has NO accessible page —
// callers then keep them on /dashboard as the ultimate harbour (never a loop).
export function firstAccessibleHref(user: UserProfile): string | undefined {
  for (const section of NAV_SECTIONS) {
    const items = [
      ...(section.items ?? []),
      ...(section.subgroups?.flatMap((sg) => sg.items) ?? []),
    ];
    for (const item of items) {
      if (canAccess(user, item.moduleKey)) return item.href;
    }
  }
  return undefined;
}
