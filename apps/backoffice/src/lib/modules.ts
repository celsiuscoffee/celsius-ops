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
    { label: "Recruitment (Indeed)", key: "recruitment" },
  ],
};

// Optional visual groupings for the module picker. Keys map to APP_MODULES
// keys; an app with an entry here renders grouped sections instead of a flat
// grid.
export const MODULE_GROUPS: Record<string, { label: string; keys: string[] }[]> = {
  hr: [
    { label: "People", keys: ["dashboard", "employees"] },
    { label: "Time & Attendance", keys: ["attendance", "schedules", "overtime"] },
    { label: "Leave", keys: ["leave"] },
    { label: "Payroll & Compensation", keys: ["payroll", "allowances"] },
    { label: "Performance", keys: ["performance", "review-penalties"] },
    { label: "Communication", keys: ["memos"] },
    { label: "Admin", keys: ["settings"] },
  ],
};

// Apps that live INSIDE the backoffice app (gated by their own modules, not a
// separate login). The picker surfaces these whenever a user has "backoffice"
// app access, in addition to the apps listed in their appAccess.
export const BACKOFFICE_SUB_APPS = ["settings", "hr", "reviews", "ads"] as const;

// Every grantable `${app}:${key}`. Used by the sidebar's dev-time drift check.
export const GRANTABLE_MODULE_KEYS: ReadonlySet<string> = new Set(
  Object.entries(APP_MODULES).flatMap(([app, mods]) => mods.map((m) => `${app}:${m.key}`)),
);
