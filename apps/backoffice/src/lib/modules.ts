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

// Which real app(s) actually read this module grant at runtime. Omitted =
// backoffice-only. Purely ADDITIVE metadata — no reader consumes it yet. It
// exists to become the single source of truth for "which app does this grant
// affect", so that fact stops living only in scattered reader code (staff
// access.ts route maps, native tab configs). Drives the future editor
// grouping/badges and the withAuth({ app, module }) enforcement wrapper.
export type AppSurface = "backoffice" | "staff";
export type ModuleDef = { label: string; key: string; apps?: AppSurface[] };

export const APP_MODULES: Record<string, ModuleDef[]> = {
  pickup: [
    { label: "Orders", key: "orders" },
    { label: "Menu", key: "menu" },
    // "Customers" was consolidated into the Rewards → Members page (gated by
    // loyalty:members); the thin /pickup/customers page now redirects there.
    // Grant customer access via loyalty:members instead.
    { label: "Settings (Pickup + POS)", key: "settings" },
  ],
  inventory: [
    { label: "Products", key: "products" },
    { label: "Perishables", key: "perishables" },
    { label: "Packaging", key: "packaging" },
    { label: "Suppliers", key: "suppliers" },
    { label: "Categories", key: "categories" },
    { label: "Menu & BOM", key: "menus" },
    { label: "Purchase Orders", key: "orders", apps: ["backoffice", "staff"] },
    { label: "Receivings", key: "receivings", apps: ["backoffice", "staff"] },
    { label: "Invoices", key: "invoices", apps: ["backoffice", "staff"] },
    { label: "Payment Requests", key: "pay-and-claim", apps: ["backoffice", "staff"] },
    { label: "Stock Count", key: "stock-count", apps: ["backoffice", "staff"] },
    { label: "Wastage", key: "wastage", apps: ["backoffice", "staff"] },
    { label: "Transfers", key: "transfers", apps: ["backoffice", "staff"] },
    { label: "Par Levels", key: "par-levels" },
    { label: "Reports", key: "reports" },
  ],
  loyalty: [
    { label: "Overview", key: "dashboard" },
    { label: "Members", key: "members" },
    { label: "Rewards", key: "rewards" },
    // Split out of loyalty:rewards: issuing points/vouchers by hand is a
    // sensitive action worth granting (or withholding) on its own.
    { label: "Manual Grant", key: "manual-grant" },
    { label: "Redemptions", key: "redemptions" },
    { label: "Campaigns", key: "campaigns" },
    { label: "Engage", key: "engage" },
  ],
  sales: [
    { label: "Dashboard", key: "dashboard", apps: ["backoffice", "staff"] },
    // Split out of pickup:settings so Reports/Cashier Performance can be granted
    // without also handing over POS/printer configuration.
    { label: "Reports & Cashier Performance", key: "reports" },
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
    { label: "Audit", key: "audit", apps: ["backoffice", "staff"] },
    { label: "SOPs", key: "sops", apps: ["backoffice", "staff"] },
    { label: "Categories", key: "categories", apps: ["backoffice", "staff"] },
    // Staff-only: the staff app gates /checklists and /schedules on
    // ops:checklists, but the key was missing from this registry — so it could
    // never be granted and Checklists was effectively OWNER/ADMIN-only. Adding
    // it here (and to NAV_TABS below) makes it grantable. Additive: nothing is
    // auto-granted; access is unchanged until an admin ticks it.
    { label: "Checklists & Schedules", key: "checklists", apps: ["staff"] },
    { label: "Ops Workspace", key: "chat-inbox" },
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
    { label: "GrabFood Marketing", key: "grab" },
  ],
};

// ─── Tab-mirrored view (Staff & Access editor) ───────────────────────────
//
// The Staff & Access editor presents grantable modules grouped EXACTLY the way
// the backoffice sidebar is (NAV_SECTIONS in app/(admin)/layout.tsx): one card
// per sidebar tab (Catalog, Sales, Procurement, Rewards, …), with the same
// sub-group headings. Granting access then reads the same way the nav looks,
// instead of being grouped by the underlying app.
//
// A grantable `${app}:${key}` is referenced here by app + key; the editor still
// writes toggles into moduleAccess[app] (storage is unchanged). Because the
// sidebar reuses one permission for several pages (e.g. pickup:settings powers
// both Sales → Reports and Settings → POS), a single key can legitimately
// appear in more than one tab — toggling it anywhere updates it everywhere.
//
// INVARIANT (enforced by the dev-time check below): every entry's `${app}:${key}`
// must be grantable (present in GRANTABLE_MODULE_KEYS), and every grantable key
// must appear in at least one tab — otherwise the editor silently drops a
// toggle and admins lose the ability to grant that module. finance:* is
// intentionally absent (OWNER/ADMIN-only, not grantable).

export type GrantModule = { app: string; key: string; label: string };
export type GrantGroup = { label?: string; modules: GrantModule[] };
export type GrantTab = { label: string; groups: GrantGroup[] };

const m = (app: string, key: string, label: string): GrantModule => ({ app, key, label });

export const NAV_TABS: GrantTab[] = [
  {
    label: "Catalog",
    groups: [
      {
        modules: [
          m("pickup", "menu", "Products & Splash Posters"),
          m("inventory", "menus", "Menu & BOM"),
          m("inventory", "packaging", "Packaging"),
        ],
      },
    ],
  },
  {
    label: "Sales",
    groups: [
      {
        modules: [
          m("sales", "dashboard", "Dashboard & Compare"),
          m("pickup", "orders", "Orders"),
          m("loyalty", "members", "Customers"),
          m("sales", "reports", "Reports & Cashier Performance"),
        ],
      },
    ],
  },
  {
    label: "Procurement",
    groups: [
      {
        label: "Master Data",
        modules: [
          m("inventory", "products", "Ingredients & Dashboard"),
          m("inventory", "perishables", "Perishables"),
          m("inventory", "packaging", "Packaging"),
          m("inventory", "suppliers", "Suppliers"),
          m("inventory", "categories", "Groups & Storage"),
        ],
      },
      {
        label: "Ordering",
        modules: [
          m("inventory", "orders", "Purchase Orders"),
          m("inventory", "transfers", "Transfers"),
          m("inventory", "receivings", "Receivings"),
          m("inventory", "invoices", "Invoices"),
          m("inventory", "pay-and-claim", "Payment Requests"),
        ],
      },
      {
        label: "Operations",
        modules: [
          m("inventory", "stock-count", "Stock Count"),
          m("inventory", "wastage", "Wastage"),
          m("inventory", "par-levels", "Par Levels"),
        ],
      },
      {
        label: "Analytics",
        modules: [m("inventory", "reports", "Reports")],
      },
    ],
  },
  {
    label: "Rewards",
    groups: [
      {
        label: "Overview",
        modules: [m("loyalty", "dashboard", "Area Scorecard")],
      },
      {
        label: "Rewards & Promotions",
        modules: [
          m("loyalty", "rewards", "Challenges, Mystery & Setup"),
          m("loyalty", "manual-grant", "Manual Grant (issue points/vouchers)"),
        ],
      },
      {
        label: "History",
        modules: [m("loyalty", "redemptions", "Vouchers, Redemptions & Points Log")],
      },
      {
        label: "Campaigns",
        modules: [
          m("loyalty", "campaigns", "Campaigns"),
          m("loyalty", "engage", "Engage"),
        ],
      },
    ],
  },
  {
    label: "Marketing",
    groups: [
      {
        label: "Reviews",
        modules: [m("reviews", "list", "All Reviews")],
      },
      {
        label: "Google Ads",
        modules: [
          m("ads", "overview", "Overview"),
          m("ads", "campaigns", "Campaigns"),
          m("ads", "invoices", "Invoices"),
        ],
      },
      {
        label: "GrabFood",
        modules: [
          m("ads", "grab", "Campaigns & Ad Spend"),
        ],
      },
    ],
  },
  {
    label: "Ops",
    groups: [
      {
        modules: [
          m("ops", "performance", "Dashboard & Performance"),
          m("ops", "audit", "Audits"),
          m("ops", "sops", "SOPs & Templates"),
          m("ops", "categories", "Categories"),
          m("ops", "checklists", "Checklists & Schedules"),
          m("ops", "chat-inbox", "Ops Workspace"),
        ],
      },
    ],
  },
  {
    label: "HR",
    groups: [
      {
        label: "Overview",
        modules: [m("hr", "dashboard", "Dashboard & Analytics")],
      },
      {
        label: "People",
        modules: [
          m("hr", "employees", "Employees & Certifications"),
          m("hr", "memos", "Memos"),
        ],
      },
      {
        label: "Leave",
        modules: [m("hr", "leave", "Leave Requests")],
      },
      {
        label: "Time & Attendance",
        modules: [
          m("hr", "attendance", "Attendance"),
          m("hr", "overtime", "Overtime"),
        ],
      },
      {
        label: "Scheduling",
        modules: [m("hr", "schedules", "Schedules, Availability & Coverage")],
      },
      {
        label: "Payroll",
        modules: [
          m("hr", "payroll", "Payroll Runs & Statutory"),
          m("hr", "allowances", "Allowances"),
        ],
      },
      {
        label: "Performance",
        modules: [
          m("hr", "performance", "Monthly Scores"),
          m("hr", "review-penalties", "Review Penalties"),
        ],
      },
    ],
  },
  {
    label: "Settings",
    groups: [
      {
        label: "Business",
        modules: [
          m("settings", "outlets", "Hub & Outlets"),
          m("settings", "staff", "Staff & Access"),
          m("settings", "rules", "Approval Rules"),
        ],
      },
      {
        label: "POS & Pickup",
        modules: [m("pickup", "settings", "POS, Printers, Table QR & Pickup Settings")],
      },
      {
        label: "Loyalty",
        modules: [m("loyalty", "rewards", "Tiers, Discount Engine & Rewards Setup")],
      },
      {
        label: "Marketing",
        modules: [
          m("reviews", "settings", "Reviews Settings"),
          m("ads", "settings", "Google Ads Settings"),
        ],
      },
      {
        label: "People",
        modules: [m("hr", "settings", "HR Settings")],
      },
      {
        label: "System",
        modules: [
          m("settings", "stock-count", "Stock Count"),
          m("settings", "integrations", "Integrations"),
          m("settings", "system", "System"),
        ],
      },
    ],
  },
];

// Apps that live INSIDE the backoffice app (gated by their own modules, not a
// separate login). The picker surfaces these whenever a user has "backoffice"
// app access, in addition to the apps listed in their appAccess.
export const BACKOFFICE_SUB_APPS = ["settings", "hr", "reviews", "ads"] as const;

// Every grantable `${app}:${key}`. Used by the sidebar's dev-time drift check.
export const GRANTABLE_MODULE_KEYS: ReadonlySet<string> = new Set(
  Object.entries(APP_MODULES).flatMap(([app, mods]) => mods.map((mod) => `${app}:${mod.key}`)),
);

// Which real app surface(s) actually read a given `${app}:${key}` grant.
// Defaults to backoffice-only when the module doesn't declare `apps`. The
// Staff & Access editor uses this to (a) show a module toggle only when the
// user holds the app that consumes it and (b) badge grants that also drive the
// staff phone app. It's the read side of the ModuleDef.apps metadata.
export function moduleApps(app: string, key: string): AppSurface[] {
  const def = APP_MODULES[app]?.find((m) => m.key === key);
  return def?.apps ?? ["backoffice"];
}

// Dev-time guard: keep NAV_TABS and the grantable registry in lock-step. A
// stray key here (typo / removed module) would render a dead toggle; a missing
// key would hide a grantable module from the editor entirely.
if (process.env.NODE_ENV !== "production") {
  const tabKeys = new Set(
    NAV_TABS.flatMap((t) => t.groups.flatMap((g) => g.modules.map((mod) => `${mod.app}:${mod.key}`))),
  );
  const unknown = [...tabKeys].filter((k) => !GRANTABLE_MODULE_KEYS.has(k));
  const uncovered = [...GRANTABLE_MODULE_KEYS].filter((k) => !tabKeys.has(k));
  if (unknown.length) {
    console.warn("[perms] NAV_TABS references non-grantable keys (fix lib/modules.ts):", unknown);
  }
  if (uncovered.length) {
    console.warn("[perms] grantable modules missing from NAV_TABS (add a tab entry):", uncovered);
  }
}
