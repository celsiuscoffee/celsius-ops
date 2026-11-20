// Backoffice navigation registry — the single source of truth for the sidebar
// tree, the ⌘K palette's page index, and the client-side route gate in
// (admin)/layout.tsx. Page URLs never change here; only labels/grouping do,
// so deep links and bookmarks always survive a nav reshuffle.
//
// Section order and the tab model are described above NAV_SECTIONS.
// (Dashboard sits above all sections; it's rendered separately by the layout.)

import {
  ShoppingBag,
  Bot,
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
  ChefHat,
  ListChecks,
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
  // Hidden items stay in the registry — findable via ⌘K, gated by the route
  // guard, counted by the perms dev-guard — but don't render in the sidebar.
  // Use for pages reachable from a sibling page (in-page tabs/links) or
  // rarely-visited config, so the sidebar stays short without orphaning URLs
  // or fine-grained grants.
  hidden?: boolean;
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
  dividerBefore?: boolean; // start of a new rail cluster (no group label)
  // Rail group label shown above the first section of each group
  // ("Sell", "Make and supply", "Run the business").
  group?: string;
  // "footer" = not listed in the rail; reached from the gear in the sidebar
  // footer (Settings). Defaults to the rail.
  placement?: "rail" | "footer";
};

const ICON_SIZE = "h-4 w-4";

// Structure (2026-11-11 restructure, docs/design/backoffice-structure.md):
// the rail lists ONE entry per section and the open section's pages nest under
// it (components/office-shell.tsx, Celsius UI step 2, 12 Nov). Each subgroup is
// one page (link = its first view the user can open); a subgroup with more than
// one view shows them as underline tabs under the header. Keep it to 6 pages.
//
// Sections follow the life of each thing the business runs (declutter,
// 17 Nov 2026, docs/design/backoffice-structure.md §2c): a customer is sold to
// and kept; an ingredient is made into an item, held, bought and paid for; a
// person is rostered, paid and scored; an outlet is held to standard.
//   sell             → Sales · Customers · Marketing
//   make and supply  → Menu · Stock · Procurement
//   run the business → Team · Money · Standards
//   Agents, then Settings (behind the gear in the sidebar footer).
// Floor work (counts, wastage, receiving, checklists, claims) is done in the
// staff apps (lib/staff-access-presets.ts); the backoffice is for HQ to
// review and decide.
//
// Page URLs and moduleKeys never change here; only labels/grouping do, so deep
// links, bookmarks and grants always survive a reshuffle.
export const NAV_SECTIONS: NavSection[] = [
  // Structure follows Gosamē Office's menu (owner, 18 Nov 2026: "only follow
  // the ones gosame did"): Agents on top, then Sell (Sales, Customers), Make and
  // supply (Food, Stock, Orders), Run the business (Team, Money, Standards).
  // Celsius-only pages with no Gosamē home are hidden (still open by URL / ⌘K).
  // Agents — what the AI agents are doing and why (Gosamē: Colony).
  {
    label: "Agents",
    icon: <Bot className={ICON_SIZE} />,
    items: [
      { label: "AI agents", href: "/agents", icon: <Bot className={ICON_SIZE} />, moduleKey: "settings:system" },
    ],
  },
  // Sales — how much did we sell? One page; its views are tabs.
  {
    label: "Sales",
    group: "Sell",
    icon: <BarChart3 className={ICON_SIZE} />,
    subgroups: [
      {
        label: "Sales",
        items: [
          { label: "Sales",               href: "/sales/dashboard",         icon: <LayoutDashboard className={ICON_SIZE} />, moduleKey: "sales:dashboard" },
          { label: "Compare",             href: "/sales/compare",           icon: <Scale className={ICON_SIZE} />,           moduleKey: "sales:dashboard" },
          { label: "Orders",              href: "/pickup/orders",           icon: <ClipboardList className={ICON_SIZE} />,   moduleKey: "pickup:orders" },
          { label: "Reports",             href: "/pos/reports",             icon: <BarChart3 className={ICON_SIZE} />,       moduleKey: "sales:reports" },
          // Per-cashier till numbers (docs/design/cashier-performance-dashboard.md).
          { label: "Cashier performance", href: "/pos/cashier-performance", icon: <Users className={ICON_SIZE} />,           moduleKey: "sales:reports" },
          // Pickup app orders, revenue and engagement (the old /pickup dashboard redirects here).
          { label: "Pickup app",          href: "/pickup/analytics",        icon: <ShoppingBag className={ICON_SIZE} />,     moduleKey: "sales:reports" },
        ],
      },
    ],
  },
  // Customers — who are they, are they happy, do they come back?
  {
    label: "Customers",
    group: "Sell",
    icon: <Users className={ICON_SIZE} />,
    subgroups: [
      {
        label: "Profiles",
        items: [
          { label: "Profiles",     href: "/loyalty/members",      icon: <Users className={ICON_SIZE} />,     moduleKey: "loyalty:members" },
          { label: "Manual grant", href: "/loyalty/manual-grant", icon: <HandCoins className={ICON_SIZE} />, moduleKey: "loyalty:manual-grant" },
        ],
      },
      {
        label: "Rewards",
        items: [
          { label: "Rewards",     href: "/loyalty/vouchers",    icon: <TicketPercent className={ICON_SIZE} />, moduleKey: "loyalty:redemptions" },
          { label: "Redemptions", href: "/loyalty/redemptions", icon: <Receipt className={ICON_SIZE} />,       moduleKey: "loyalty:redemptions" },
          // Raw per-transaction points ledger — audit-grade, reached via ⌘K.
          { label: "Points log",  href: "/loyalty/points-log",  icon: <Coins className={ICON_SIZE} />,         moduleKey: "loyalty:redemptions", hidden: true },
        ],
      },
      {
        label: "Reviews",
        items: [
          { label: "Reviews",         href: "/reviews",            icon: <Star className={ICON_SIZE} />,          moduleKey: "reviews:list" },
          { label: "Feedback",        href: "/reviews/feedback",   icon: <MessageSquare className={ICON_SIZE} />, moduleKey: "reviews:list" },
          { label: "Search position", href: "/reviews/geogrid",    icon: <MapPinned className={ICON_SIZE} />,     moduleKey: "reviews:list" },
          { label: "Scoreboard",      href: "/reviews/scoreboard", icon: <Target className={ICON_SIZE} />,        moduleKey: "reviews:list" },
        ],
      },
      {
        // Gosamē: WhatsApp. Celsius sends SMS and push; campaigns are the
        // automated sends (the legacy /loyalty/campaigns editor redirects there).
        label: "Messages",
        items: [
          { label: "Messages",  href: "/loyalty/engage", icon: <MessageSquare className={ICON_SIZE} />, moduleKey: "loyalty:engage" },
          { label: "Campaigns", href: "/loyalty/loops",  icon: <Repeat className={ICON_SIZE} />,        moduleKey: "loyalty:campaigns" },
        ],
      },
      {
        // Ads have no Gosamē home, but the owner keeps them in the menu
        // (19 Nov 2026: "ads: keep").
        label: "Ads",
        items: [
          { label: "Google",           href: "/ads",           icon: <LayoutDashboard className={ICON_SIZE} />, moduleKey: "ads:overview" },
          { label: "Google campaigns", href: "/ads/campaigns", icon: <BarChart3 className={ICON_SIZE} />,       moduleKey: "ads:campaigns" },
          { label: "Optimizer",        href: "/ads/optimizer", icon: <Scissors className={ICON_SIZE} />,        moduleKey: "ads:campaigns" },
          { label: "GrabFood",         href: "/ads/grab",      icon: <Megaphone className={ICON_SIZE} />,       moduleKey: "ads:grab" },
          { label: "Ad invoices",      href: "/ads/invoices",  icon: <Receipt className={ICON_SIZE} />,         moduleKey: "ads:invoices" },
        ],
      },
    ],
  },
  // Food — what do we sell, how is it made, what does it earn? Celsius has no
  // central kitchen, so Gosamē's CK section has no counterpart.
  {
    label: "Food",
    group: "Make and supply",
    icon: <UtensilsCrossed className={ICON_SIZE} />,
    subgroups: [
      {
        label: "Menu",
        items: [
          // Shared by POS, the pickup app and Grab.
          { label: "Menu",        href: "/pickup/menu",           icon: <UtensilsCrossed className={ICON_SIZE} />, moduleKey: "pickup:menu" },
          // Store open/closed and items switched off, per outlet and channel.
          { label: "Menu status", href: "/pos/store-menu-status", icon: <Power className={ICON_SIZE} />,           moduleKey: "pickup:settings" },
        ],
      },
      {
        label: "Recipes",
        items: [
          { label: "Recipes",      href: "/inventory/menus",        icon: <BookOpen className={ICON_SIZE} />,    moduleKey: "inventory:menus" },
          // Printable per-item BOM — linked from the Recipes page.
          { label: "Recipe cards", href: "/inventory/menus/cards",  icon: <Printer className={ICON_SIZE} />,     moduleKey: "inventory:menus", hidden: true },
          // Prep sub-recipes made at the outlets (raw → prepped).
          { label: "Prep recipes", href: "/inventory/prep-recipes", icon: <ChefHat className={ICON_SIZE} />,     moduleKey: "inventory:menus" },
          { label: "Packaging",    href: "/inventory/packaging",    icon: <PackageOpen className={ICON_SIZE} />, moduleKey: "inventory:packaging" },
        ],
      },
    ],
  },
  // Stock — what do we hold, where, and where does it leak? Counts, waste and
  // transfers are done on the floor in the staff app; this is the HQ view.
  {
    label: "Stock",
    group: "Make and supply",
    icon: <Boxes className={ICON_SIZE} />,
    subgroups: [
      {
        label: "Food cost",
        items: [
          { label: "Food cost", href: "/inventory/dashboard", icon: <LayoutDashboard className={ICON_SIZE} />, moduleKey: "inventory:products" },
          { label: "Reports",   href: "/inventory/reports",   icon: <LineChart className={ICON_SIZE} />,       moduleKey: "inventory:reports" },
        ],
      },
      {
        label: "Items",
        items: [
          { label: "Items",          href: "/inventory/products",    icon: <Package className={ICON_SIZE} />,        moduleKey: "inventory:products" },
          { label: "Reserve levels", href: "/inventory/par-levels",  icon: <TrendingUp className={ICON_SIZE} />,     moduleKey: "inventory:par-levels" },
          // Same item list, filtered to itemType PERISHABLE.
          { label: "Perishables",    href: "/inventory/perishables", icon: <Box className={ICON_SIZE} />,            moduleKey: "inventory:perishables" },
          // Outlet-to-outlet moves (Gosamē moves stock only from its CK).
          { label: "Transfers",      href: "/inventory/transfers",   icon: <ArrowLeftRight className={ICON_SIZE} />, moduleKey: "inventory:transfers" },
        ],
      },
      {
        label: "Counts",
        items: [
          { label: "Counts", href: "/inventory/stock-count", icon: <ClipboardCheck className={ICON_SIZE} />, moduleKey: "inventory:stock-count" },
        ],
      },
      {
        label: "Waste",
        items: [
          { label: "Waste", href: "/inventory/wastage", icon: <Trash2 className={ICON_SIZE} />, moduleKey: "inventory:wastage" },
        ],
      },
    ],
  },
  // Orders (was Procurement) — right items, right price, paid correctly?
  {
    label: "Orders",
    group: "Make and supply",
    icon: <Truck className={ICON_SIZE} />,
    subgroups: [
      {
        label: "Supplier chats",
        items: [
          { label: "Supplier chats", href: "/inventory/supplier-chats", icon: <MessageCircle className={ICON_SIZE} />, moduleKey: "inventory:orders" },
        ],
      },
      {
        label: "Supplier orders",
        items: [
          { label: "Supplier orders", href: "/inventory/orders",     icon: <FileText className={ICON_SIZE} />, moduleKey: "inventory:orders" },
          { label: "Deliveries",      href: "/inventory/receivings", icon: <Receipt className={ICON_SIZE} />,  moduleKey: "inventory:receivings" },
        ],
      },
      {
        label: "Invoices",
        items: [
          { label: "Invoices",      href: "/inventory/invoices",       icon: <ClipboardList className={ICON_SIZE} />, moduleKey: "inventory:invoices" },
          // Invoice ↔ PO matching (not bank matching: that is Money → Bank inbox).
          { label: "Invoice match", href: "/inventory/reconciliation", icon: <Scale className={ICON_SIZE} />,         moduleKey: "inventory:invoices" },
        ],
      },
      {
        label: "Suppliers",
        items: [
          { label: "Suppliers", href: "/inventory/suppliers", icon: <Truck className={ICON_SIZE} />, moduleKey: "inventory:suppliers" },
        ],
      },
    ],
  },
  // Team (was HR) — right people, on time, paid right, performing. The rail
  // shows four pages; the in-module tab strip (components/hr/module-tabs.tsx)
  // reaches every sibling, so those are `hidden` here (⌘K + route gate +
  // grants intact). URLs unchanged.
  {
    label: "Team",
    group: "Run the business",
    icon: <Users className={ICON_SIZE} />,
    items: [
      // Roster: the week's shifts, clock-ins, leave, swaps and overtime in one
      // place; its tab strip reaches schedules, clock-ins, overtime, swaps, leave.
      { label: "Roster",      href: "/hr/roster",    icon: <CalendarDays className={ICON_SIZE} />,    moduleKey: "hr:schedules" },
      { label: "Schedules",   href: "/hr/schedules", icon: <CalendarDays className={ICON_SIZE} />,    moduleKey: "hr:schedules", hidden: true },
      { label: "Attendance",  href: "/hr/attendance", icon: <Clock className={ICON_SIZE} />,          moduleKey: "hr:attendance", hidden: true },
      { label: "Overtime",    href: "/hr/overtime",   icon: <Clock className={ICON_SIZE} />,          moduleKey: "hr:overtime", hidden: true },
      { label: "Shift swaps", href: "/hr/shift-swaps", icon: <ArrowLeftRight className={ICON_SIZE} />, moduleKey: "hr:schedules", hidden: true },
      { label: "Leave",       href: "/hr/leave",     icon: <CalendarOff className={ICON_SIZE} />,     moduleKey: "hr:leave", hidden: true },
      { label: "Roster attendance", href: "/hr/roster-attendance", icon: <Clock className={ICON_SIZE} />, moduleKey: "hr:schedules", hidden: true },
      { label: "PT hours",    href: "/hr/pt-hours",  icon: <Clock className={ICON_SIZE} />,           moduleKey: "hr:attendance", hidden: true },
      { label: "Availability",   href: "/hr/availability", icon: <Clock className={ICON_SIZE} />,     moduleKey: "hr:schedules", hidden: true },
      { label: "Coverage rules", href: "/hr/coverage",     icon: <Flame className={ICON_SIZE} />,     moduleKey: "hr:schedules", hidden: true },
      { label: "Payroll",     href: "/hr/payroll",   icon: <Banknote className={ICON_SIZE} />,        moduleKey: "hr:payroll" },
      // Read-only view of what the levers scored. Corrections live on
      // /hr/performance; this stays as the plain company-wide readout.
      { label: "Allowances",  href: "/hr/allowances", icon: <Banknote className={ICON_SIZE} />,       moduleKey: "hr:allowances", hidden: true },
      { label: "Statutory calendar", href: "/hr/compliance", icon: <CalendarClock className={ICON_SIZE} />, moduleKey: "hr:payroll", hidden: true },
      // One screen, two tabs: Allowance (levers, deductions, corrections) and
      // Scorecard (attendance/ops/reviews). Deliberately NOT keyed on
      // hr:allowances, which canAccess hard-restricts to OWNER/ADMIN — a
      // staffing manager needs to waive a wrongly-docked absence for their own
      // team, and the API scopes them to their subtree and to line waivers.
      { label: "Performance", href: "/hr/performance", icon: <TrendingUp className={ICON_SIZE} />,    moduleKey: "hr:performance" },
      { label: "Review penalties", href: "/hr/review-penalties", icon: <AlertTriangle className={ICON_SIZE} />, moduleKey: "hr:review-penalties", hidden: true },
      // People: the staff list; its tab strip holds the HR overview, PT rates,
      // app access, certificates and memos.
      { label: "People",      href: "/hr/employees", icon: <UserCog className={ICON_SIZE} />,         moduleKey: "hr:employees" },
      { label: "Overview",    href: "/hr",           icon: <LayoutDashboard className={ICON_SIZE} />, moduleKey: "hr:dashboard", hidden: true },
      { label: "Analytics",   href: "/hr/analytics", icon: <BarChart3 className={ICON_SIZE} />,       moduleKey: "hr:dashboard", hidden: true },
      // Keyed on hr:employees, not hr:payroll — a PT staffing manager sets hourly
      // rates without getting the payroll module (runs, payslips, bank files).
      { label: "PT rates",    href: "/hr/pt-rates",  icon: <Banknote className={ICON_SIZE} />,        moduleKey: "hr:employees", hidden: true },
      { label: "App access",  href: "/hr/access-presets", icon: <ShieldCheck className={ICON_SIZE} />, moduleKey: "hr:employees", hidden: true },
      { label: "Certifications", href: "/hr/certifications", icon: <ShieldCheck className={ICON_SIZE} />, moduleKey: "hr:employees", hidden: true },
      { label: "Memos",       href: "/hr/memos",     icon: <FileText className={ICON_SIZE} />,        moduleKey: "hr:memos", hidden: true },
    ],
  },


  // Money (was Finance) — where is our cash, and are the books right?
  // moduleKeys start with "finance:", which canAccess hard-restricts to
  // OWNER/ADMIN regardless of moduleAccess.
  {
    label: "Money",
    group: "Run the business",
    icon: <Coins className={ICON_SIZE} />,
    subgroups: [
      {
        // Gosamē's Money starts with Today (owner, 20 Nov 2026): one list of
        // money decisions, Tax & close under it.
        label: "Today",
        items: [
          { label: "Today",       href: "/finance/today",      icon: <ListChecks className={ICON_SIZE} />,      moduleKey: "finance:reports" },
          { label: "Tax & close", href: "/finance/compliance", icon: <CalendarClock className={ICON_SIZE} />,   moduleKey: "finance:reports" },
        ],
      },
      {
        label: "Overview",
        items: [
          { label: "Overview",    href: "/finance",            icon: <LayoutDashboard className={ICON_SIZE} />, moduleKey: "finance:reports" },
        ],
      },
      {
        label: "Bank inbox",
        items: [
          // Bank ↔ books.
          { label: "Bank inbox", href: "/finance/recon", icon: <Scale className={ICON_SIZE} />, moduleKey: "finance:reports" },
        ],
      },
      {
        label: "Cash flow",
        items: [
          { label: "Cash flow",       href: "/finance/cashflow",           icon: <LineChart className={ICON_SIZE} />,       moduleKey: "finance:cashflow" },
          { label: "Bank statements", href: "/finance/bank-statements",    icon: <FileText className={ICON_SIZE} />,        moduleKey: "finance:cashflow" },
          { label: "Regular bills",   href: "/finance/recurring-expenses", icon: <Repeat className={ICON_SIZE} />,          moduleKey: "finance:cashflow" },
          // Not in Gosamē's Money (owner 19 Nov 2026: "follow exactly how
          // gosame did"): off the menu, still open by URL and ⌘K.
          { label: "Cash tracking",   href: "/finance/cash-tracking",      icon: <TableProperties className={ICON_SIZE} />, moduleKey: "finance:cash-tracking", hidden: true },
          { label: "Monthly",         href: "/finance/monthly-cashflow",   icon: <CalendarDays className={ICON_SIZE} />,    moduleKey: "finance:cashflow", hidden: true },
        ],
      },
      {
        // Gosamē: Bills (with Staff claims). Celsius has one page for both:
        // supplier payment requests and staff claims.
        label: "Bills",
        items: [
          { label: "Bills", href: "/inventory/pay-and-claim", icon: <HandCoins className={ICON_SIZE} />, moduleKey: "inventory:pay-and-claim" },
        ],
      },
      {
        label: "Reports",
        items: [
          { label: "Reports",      href: "/finance/reports",      icon: <TrendingUp className={ICON_SIZE} />, moduleKey: "finance:reports" },
          { label: "Ledger",       href: "/finance/transactions", icon: <FileText className={ICON_SIZE} />,   moduleKey: "finance:transactions" },
          { label: "Fixed assets", href: "/finance/fixed-assets", icon: <Landmark className={ICON_SIZE} />,   moduleKey: "finance:reports" },
        ],
      },
    ],
  },
  // Standards (was Ops) — is every outlet running to standard?
  {
    label: "Standards",
    group: "Run the business",
    icon: <ClipboardCheck className={ICON_SIZE} />,
    subgroups: [
      {
        label: "Checklists",
        items: [
          // Recurring SOP checklists per outlet and staff, with Coverage on top
          // (the old /ops/compliance page redirects here).
          { label: "Checklists", href: "/ops/schedules", icon: <CalendarClock className={ICON_SIZE} />, moduleKey: "ops:checklists" },
        ],
      },
      {
        label: "What happened",
        items: [
          // Incidents, messages and reminders.
          { label: "What happened", href: "/ops/chat-inbox", icon: <MessageSquare className={ICON_SIZE} />, moduleKey: "ops:chat-inbox" },
        ],
      },
      {
        label: "Audits",
        items: [
          { label: "Audits",           href: "/ops/audit",         icon: <ClipboardCheck className={ICON_SIZE} />, moduleKey: "ops:audit" },
          // Both outlet scores; the old /ops/dashboard redirects here.
          { label: "Outlet scorecard", href: "/ops/performance",   icon: <BarChart3 className={ICON_SIZE} />,      moduleKey: "ops:performance" },
          // The scores the ops scoreboard job sends out (/api/scorecard).
          { label: "Area scorecard",   href: "/loyalty/dashboard", icon: <Trophy className={ICON_SIZE} />,         moduleKey: "loyalty:dashboard" },
        ],
      },
      {
        label: "SOPs",
        items: [
          { label: "SOPs", href: "/ops/sops", icon: <BookOpen className={ICON_SIZE} />, moduleKey: "ops:sops" },
        ],
      },
    ],
  },
  // ── Settings — rendered behind the gear in the sidebar footer, not in the
  // rail (placement: "footer"). Set-up you touch rarely, grouped by domain.
  // RBAC is per-item; empty groups auto-hide.
  {
    label: "Settings",
    icon: <SlidersHorizontal className={ICON_SIZE} />,
    placement: "footer",
    subgroups: [
      {
        label: "Outlet",
        items: [
          { label: "POS settings",    href: "/pos/settings",          icon: <CreditCard className={ICON_SIZE} />,  moduleKey: "pickup:settings" },
          { label: "Printers",        href: "/pos/printers",          icon: <Printer className={ICON_SIZE} />,     moduleKey: "pickup:settings" },
          { label: "Table QR codes",  href: "/pos/table-qr",          icon: <QrCode className={ICON_SIZE} />,      moduleKey: "pickup:settings" },
          { label: "Pickup settings", href: "/pickup/settings",       icon: <ShoppingBag className={ICON_SIZE} />, moduleKey: "pickup:settings" },
          { label: "Splash posters",  href: "/pickup/splash-posters", icon: <ImagePlus className={ICON_SIZE} />,   moduleKey: "pickup:menu" },
        ],
      },
      {
        label: "Company and people",
        items: [
          { label: "Outlet details",    href: "/settings/outlets", icon: <Building2 className={ICON_SIZE} />,   moduleKey: "settings:outlets" },
          { label: "Staff access",      href: "/settings/staff",   icon: <UserCog className={ICON_SIZE} />,     moduleKey: "settings:staff" },
          { label: "Approvals",         href: "/settings/rules",   icon: <ShieldCheck className={ICON_SIZE} />, moduleKey: "settings:rules" },
          { label: "HR policies",       href: "/hr/settings",      icon: <UserCog className={ICON_SIZE} />,     moduleKey: "hr:settings" },
          { label: "Accounts",          href: "/finance/coa",      icon: <BookOpen className={ICON_SIZE} />,    moduleKey: "finance:reports" },
        ],
      },
      {
        label: "Stock",
        items: [
          { label: "Item groups",      href: "/inventory/groups",     icon: <Tags className={ICON_SIZE} />,           moduleKey: "inventory:categories" },
          { label: "Count days",       href: "/settings/stock-count", icon: <ClipboardCheck className={ICON_SIZE} />, moduleKey: "settings:stock-count" },
        ],
      },
      {
        // Ordered to mirror the pickup app's rewards screen first, then the
        // programme rules.
        label: "Customers",
        items: [
          { label: "Reviews",    href: "/reviews/settings", icon: <MessageCircle className={ICON_SIZE} />, moduleKey: "reviews:settings" },
          { label: "Google ads", href: "/ads/settings",     icon: <Megaphone className={ICON_SIZE} />,     moduleKey: "ads:settings" },
          { label: "Challenges",       href: "/loyalty/missions",         icon: <Target className={ICON_SIZE} />,   moduleKey: "loyalty:rewards" },
          { label: "Mystery pool",     href: "/loyalty/mystery",          icon: <Sparkles className={ICON_SIZE} />, moduleKey: "loyalty:rewards" },
          { label: "Admin claimables", href: "/loyalty/admin-claimables", icon: <Gift className={ICON_SIZE} />,     moduleKey: "loyalty:rewards" },
          { label: "All rewards",      href: "/loyalty/all-rewards",      icon: <Ticket className={ICON_SIZE} />,   moduleKey: "loyalty:rewards" },
          { label: "Tiers",            href: "/loyalty/tiers",            icon: <Crown className={ICON_SIZE} />,    moduleKey: "loyalty:rewards" },
          { label: "Discount engine",  href: "/loyalty/promotions",       icon: <Tag className={ICON_SIZE} />,      moduleKey: "loyalty:rewards" },
          // Code-bound reward shapes; rarely edited — hidden, reachable via ⌘K.
          { label: "Outcome types",    href: "/loyalty/reward-kinds",     icon: <Layers className={ICON_SIZE} />,   moduleKey: "loyalty:rewards", hidden: true },
          { label: "Birthday treats",  href: "/loyalty/birthday",         icon: <Cake className={ICON_SIZE} />,     moduleKey: "loyalty:rewards" },
          { label: "Earn rate",        href: "/loyalty/settings",         icon: <Coins className={ICON_SIZE} />,    moduleKey: "loyalty:rewards" },
        ],
      },
      {
        label: "Office",
        items: [
          { label: "SOP categories", href: "/ops/categories",        icon: <Tags className={ICON_SIZE} />,   moduleKey: "ops:categories" },
          { label: "Integrations",   href: "/settings/integrations", icon: <Plug className={ICON_SIZE} />,   moduleKey: "settings:integrations" },
          { label: "Office usage",   href: "/settings/usage",        icon: <BarChart3 className={ICON_SIZE} />, moduleKey: "settings:staff" },
          { label: "System",         href: "/settings/system",       icon: <Wrench className={ICON_SIZE} />, moduleKey: "settings:system" },
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

// Items the sidebar actually renders for this user: accessible AND not hidden.
export function getVisibleItems(section: NavSection, user: UserProfile | undefined): NavItem[] {
  const show = (item: NavItem) => !item.hidden && canAccess(user, item.moduleKey);
  if (section.items) return section.items.filter(show);
  if (section.subgroups) return section.subgroups.flatMap((sg) => sg.items.filter(show));
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
  // Prefer a sidebar-visible destination; fall back to hidden entries so a
  // user whose only grants map to hidden pages still lands somewhere useful.
  let hiddenFallback: string | undefined;
  for (const section of NAV_SECTIONS) {
    const items = [
      ...(section.items ?? []),
      ...(section.subgroups?.flatMap((sg) => sg.items) ?? []),
    ];
    for (const item of items) {
      if (!canAccess(user, item.moduleKey)) continue;
      if (!item.hidden) return item.href;
      hiddenFallback ??= item.href;
    }
  }
  return hiddenFallback;
}

// ─── Shell placement (rail pages, header crumb, page tabs) ──────────────
// The Celsius UI shell (components/office-shell.tsx) shows, for the section
// the current URL sits in: its PAGES nested under the section in the rail,
// and the current page's related views as underline tabs under the header.
// A subgroup is one page (link = its first page the user can open) and its
// items are the tabs; in a flat section (HR, Agents) every visible item is a
// page with no tabs. Longest-prefix matching over ALL items, hidden included,
// so a hidden deep page still lights up the page it belongs to.

export type RailPage = { label: string; href: string; hrefs: string[]; tabs: NavItem[] };

export function railPages(section: NavSection, user: UserProfile | undefined): RailPage[] {
  const visible = (i: NavItem) => !i.hidden && canAccess(user, i.moduleKey);
  if (section.subgroups) {
    return section.subgroups
      .map((sg) => {
        const tabs = sg.items.filter(visible);
        return { label: sg.label, href: tabs[0]?.href ?? "", hrefs: sg.items.map((i) => i.href), tabs };
      })
      .filter((p) => p.tabs.length > 0);
  }
  return (section.items ?? []).filter(visible).map((i) => ({ label: i.label, href: i.href, hrefs: [i.href], tabs: [i] }));
}

function longestMatch(pathname: string, hrefs: string[]): string | undefined {
  let best: string | undefined;
  for (const h of hrefs) {
    if (pathname === h || pathname.startsWith(h + "/")) {
      if (!best || h.length > best.length) best = h;
    }
  }
  return best;
}

export type Placement = { section: NavSection; page?: RailPage; href?: string; pages: RailPage[] };

export function locate(pathname: string, user: UserProfile | undefined): Placement | undefined {
  const section = NAV_SECTIONS.find((s) => pathMatchesSection(pathname, s));
  if (!section) return undefined;
  const pages = railPages(section, user);
  const href = longestMatch(pathname, getSectionHrefs(section));
  let page = href ? pages.find((p) => p.hrefs.includes(href)) : undefined;
  // A page kept off the menu (every item hidden) is not in `pages`, but when
  // you are on it you still get its name and its views as tabs.
  if (!page && href && section.subgroups) {
    const sg = section.subgroups.find((g) => g.items.some((i) => i.href === href));
    const tabs = sg?.items.filter((i) => canAccess(user, i.moduleKey)) ?? [];
    if (sg && tabs.length) page = { label: sg.label, href: tabs[0].href, hrefs: sg.items.map((i) => i.href), tabs };
  }
  return { section, page, href, pages };
}
