// Canonical registry of grantable backoffice modules.
//
// SINGLE SOURCE OF TRUTH. The Staff & Access editor builds its permission
// toggles from this, and the admin sidebar (app/(admin)/layout.tsx) gates
// nav items on the same `${app}:${key}` keys. A dev-time check in the
// layout warns if a nav moduleKey isn't represented here, so the two can't
// silently drift (which is exactly what hid Reviews/Ads/POS settings from
// the editor before).
//
// NOTE: finance:* is intentionally absent — Finance is OWNER/ADMIN-only and
// cannot be granted to managers, so it's not a "grantable module".

export type ModuleDef = { label: string; key: string };

export const APP_MODULES: Record<string, ModuleDef[]> = {
  pickup: [
    { label: "Orders", key: "orders" },
    { label: "Menu", key: "menu" },
    { label: "Customers", key: "customers" },
    { label: "Settings (Pickup + POS)", key: "settings" },
  ],
  inventory: [
    { label: "Products", key: "products" },
    { label: "Perishables", key: "perishables" },
    { label: "Suppliers", key: "suppliers" },
    { label: "Categories", key: "categories" },
    { label: "Menu & BOM", key: "menus" },
    { label: "Purchase Orders", key: "orders" },
    { label: "Receivings", key: "receivings" },
    { label: "Invoices", key: "invoices" },
    { label: "Payment Requests", key: "pay-and-claim" },
    { label: "Stock Count", key: "stock-count" },
    { label: "Wastage", key: "wastage" },
    { label: "Transfers", key: "transfers" },
    { label: "Par Levels", key: "par-levels" },
    { label: "Reports", key: "reports" },
  ],
  loyalty: [
    { label: "Overview", key: "dashboard" },
    { label: "Members", key: "members" },
    { label: "Rewards", key: "rewards" },
    { label: "Redemptions", key: "redemptions" },
    { label: "Campaigns", key: "campaigns" },
    { label: "Engage", key: "engage" },
  ],
  sales: [
    { label: "Dashboard", key: "dashboard" },
  ],
  settings: [
    { label: "Outlets", key: "outlets" },
    { label: "Staff & Access", key: "staff" },
    { label: "Approval Rules", key: "rules" },
    { label: "Integrations", key: "integrations" },
    { label: "Stock Count", key: "stock-count" },
    { label: "System", key: "system" },
  ],
  ops: [
    { label: "Dashboard & Performance", key: "performance" },
    { label: "Audit", key: "audit" },
    { label: "SOPs", key: "sops" },
    { label: "Categories", key: "categories" },
  ],
  hr: [
    { label: "Dashboard", key: "dashboard" },
    { label: "Attendance", key: "attendance" },
    { label: "Schedules", key: "schedules" },
    { label: "Leave", key: "leave" },
    { label: "Overtime", key: "overtime" },
    { label: "Payroll", key: "payroll" },
    { label: "Employees", key: "employees" },
    { label: "Performance", key: "performance" },
    { label: "Allowances", key: "allowances" },
    { label: "Review Penalties", key: "review-penalties" },
    { label: "Memos", key: "memos" },
    { label: "Settings", key: "settings" },
  ],
  reviews: [
    { label: "All Reviews", key: "list" },
    { label: "Settings", key: "settings" },
  ],
  ads: [
    { label: "Marketing (Google)", key: "overview" },
    { label: "Campaigns", key: "campaigns" },
    { label: "Invoices", key: "invoices" },
    { label: "Ad Settings", key: "settings" },
  ],
};

// Visual sub-groupings for the Staff & Access module picker. Keys map to
// APP_MODULES keys; an app listed here renders grouped sections (with these
// labels, in this order) instead of a flat grid — mirroring the backoffice
// sidebar's information architecture so granting access reads the same way the
// nav does.
//
// INVARIANT: every APP_MODULES[app] key MUST appear in exactly one group below,
// otherwise the editor silently drops the ungrouped toggle (admins could no
// longer grant that module). When you add a module key above, slot it into a
// group here too.
export const MODULE_GROUPS: Record<string, { label: string; keys: string[] }[]> = {
  // Catalog + POS (the customer/register channel app)
  pickup: [
    { label: "Catalog", keys: ["menu"] },
    { label: "Orders & Customers", keys: ["orders", "customers"] },
    { label: "Settings", keys: ["settings"] },
  ],
  // Procurement
  inventory: [
    { label: "Master Data", keys: ["products", "perishables", "suppliers", "categories", "menus"] },
    { label: "Ordering", keys: ["orders", "transfers", "receivings", "invoices", "pay-and-claim"] },
    { label: "Operations", keys: ["stock-count", "wastage", "par-levels"] },
    { label: "Analytics", keys: ["reports"] },
  ],
  // Marketing → Loyalty
  loyalty: [
    { label: "Overview", keys: ["dashboard"] },
    { label: "Members", keys: ["members"] },
    { label: "Rewards & Promotions", keys: ["rewards"] },
    { label: "History", keys: ["redemptions"] },
    { label: "Campaigns", keys: ["campaigns", "engage"] },
  ],
  hr: [
    { label: "Overview", keys: ["dashboard"] },
    { label: "People", keys: ["employees", "performance", "review-penalties"] },
    { label: "Scheduling", keys: ["schedules"] },
    { label: "Time & Attendance", keys: ["attendance", "overtime", "leave"] },
    { label: "Payroll & Compensation", keys: ["payroll", "allowances"] },
    { label: "Communication", keys: ["memos"] },
    { label: "Admin", keys: ["settings"] },
  ],
  settings: [
    { label: "Business", keys: ["outlets", "staff", "rules"] },
    { label: "System", keys: ["integrations", "stock-count", "system"] },
  ],
};

// Order the module-access sections follow in the Staff & Access editor, mirroring
// the sidebar top-to-bottom: Catalog/POS → Procurement → Marketing (Loyalty,
// Reviews, Ads) → Sales → Ops → HR → Settings. Apps not listed sort to the end.
export const APP_ORDER: readonly string[] = [
  "pickup",
  "inventory",
  "loyalty",
  "reviews",
  "ads",
  "sales",
  "ops",
  "hr",
  "settings",
];

// Display label for each app's module-access section header — the sidebar's
// vocabulary instead of the raw app key (e.g. inventory → Procurement).
export const APP_SECTION_LABELS: Record<string, string> = {
  pickup: "POS & Pickup",
  inventory: "Procurement",
  loyalty: "Rewards",
  reviews: "Reviews",
  ads: "Google Ads",
  sales: "Sales",
  ops: "Ops",
  hr: "HR",
  settings: "Settings",
};

// Apps that live INSIDE the backoffice app (gated by their own modules, not a
// separate login). The picker surfaces these whenever a user has "backoffice"
// app access, in addition to the apps listed in their appAccess.
export const BACKOFFICE_SUB_APPS = ["settings", "hr", "reviews", "ads"] as const;

// Every grantable `${app}:${key}`. Used by the sidebar's dev-time drift check.
export const GRANTABLE_MODULE_KEYS: ReadonlySet<string> = new Set(
  Object.entries(APP_MODULES).flatMap(([app, mods]) => mods.map((m) => `${app}:${m.key}`)),
);
