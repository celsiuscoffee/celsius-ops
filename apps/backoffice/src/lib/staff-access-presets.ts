// Position-based STAFF-APP access presets — the source of truth for what each
// job position can see in the staff apps (staff-native + apps/staff).
//
// Why this exists: access was hand-set per employee, so staff silently ended up
// with gaps (e.g. baristas missing the Checklists tab). A preset keyed on the
// employee's HR position makes provisioning deterministic: set the position and
// the person gets the right staff-app modules; a normalize pass flags/fixes
// anyone who drifted from their position's preset.
//
// SCOPING (important): this system OWNS only the staff-app module surface
// (STAFF_MANAGED_APPS / STAFF_MANAGED_MODULE_KEYS below). Applying a preset
// PRESERVES every other grant a user has — backoffice, ads, reviews, finance,
// loyalty admin, kds, pickup — so it never strips an HQ/admin/manager's
// non-floor access. Presets describe the FLOOR app, nothing else.
//
// Keys mirror the staff apps' moduleKeys (apps/staff-native/app/(staff)/_layout.tsx,
// apps/staff/src/components/bottom-nav.tsx, apps/staff/src/lib/access.ts):
//   ops:        checklists, sops, categories, audit   (Home tab gates on bare "ops")
//   inventory:  stock-count, wastage, transfers, receivings, pay-and-claim, orders, invoices
//   sales:      stored as moduleAccess.sales = true    (existing staff convention)
//   hr:         attendance, leave, schedules, employees (HR tab gates on bare "hr")

export type ModuleAccess = Record<string, true | string[]>;
export type StaffAccess = { appAccess: string[]; moduleAccess: ModuleAccess };

// The apps whose appAccess membership this preset system manages. Anything NOT
// listed here (backoffice, kds, pickup, loyalty) is left exactly as-is.
export const STAFF_MANAGED_APPS = ["ops", "inventory", "sales"] as const;
// The moduleAccess namespaces this preset system manages. Other keys are kept.
export const STAFF_MANAGED_MODULE_KEYS = ["ops", "inventory", "sales", "hr"] as const;

// Access tiers — the reusable bundles positions map onto.
const INVENTORY_BASIC = ["stock-count", "wastage", "transfers", "receivings"];
const INVENTORY_FULL = [...INVENTORY_BASIC, "pay-and-claim", "orders", "invoices"];

type Tier = "crew" | "lead" | "manager" | "hq";

const TIER_ACCESS: Record<Tier, ModuleAccess> = {
  // Floor crew: do + tick checklists, view SOPs, day-to-day inventory, own HR.
  crew: {
    ops: ["checklists", "sops", "categories"],
    inventory: INVENTORY_BASIC,
    hr: ["attendance", "leave"],
  },
  // Station/shift leads: crew + audits + full inventory/procurement + team roster.
  lead: {
    ops: ["checklists", "sops", "categories", "audit"],
    inventory: INVENTORY_FULL,
    hr: ["attendance", "leave", "schedules"],
  },
  // Outlet managers: everything the floor app offers + sales.
  manager: {
    ops: ["checklists", "sops", "categories", "audit"],
    inventory: INVENTORY_FULL,
    sales: true,
    hr: ["attendance", "leave", "schedules", "employees"],
  },
  // HQ / office roles: they live in the backoffice, not the floor app. Only own
  // HR (clock/leave). Their backoffice access is granted separately and is
  // preserved untouched by the scoping above.
  hq: {
    hr: ["attendance", "leave"],
  },
};

// Position (lowercased hr_employee_profiles.position) → tier. Unlisted positions
// fall back to "crew" (safest floor default) — see tierForPosition.
const POSITION_TIER: Record<string, Tier> = {
  barista: "crew",
  cashier: "crew",
  "kitchen crew": "crew",
  "barista lead": "lead",
  "kitchen lead": "lead",
  "shift lead": "lead",
  supervisor: "lead",
  manager: "manager",
  "area manager": "manager",
  hod: "hq",
  "head of department": "hq",
  accountant: "hq",
  executive: "hq",
  director: "hq",
};

export function tierForPosition(position: string | null | undefined): Tier {
  const key = (position ?? "").trim().toLowerCase();
  return POSITION_TIER[key] ?? "crew";
}

// The managed staff-app moduleAccess bundle for a position (no other keys).
export function presetModuleAccess(position: string | null | undefined): ModuleAccess {
  return TIER_ACCESS[tierForPosition(position)];
}

// The managed appAccess entries implied by a position's preset (subset of
// STAFF_MANAGED_APPS). "sales" is included when the preset grants sales.
export function presetManagedApps(position: string | null | undefined): string[] {
  const ma = presetModuleAccess(position);
  return STAFF_MANAGED_APPS.filter((app) => {
    const v = ma[app];
    return v === true || (Array.isArray(v) && v.length > 0);
  });
}

const arrEq = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

const moduleValEq = (a: true | string[] | undefined, b: true | string[] | undefined) => {
  if (a === undefined || b === undefined) return a === b;
  if (a === true || b === true) return a === b;
  return arrEq(a, b);
};

// Apply a position's preset to a user's CURRENT access, preserving everything
// outside the managed staff-app surface. Returns the new {appAccess, moduleAccess}.
export function applyStaffPreset(current: StaffAccess, position: string | null | undefined): StaffAccess {
  const preset = presetModuleAccess(position);
  const managedApps = presetManagedApps(position);

  // moduleAccess: keep unmanaged keys, replace managed keys from the preset
  // (drop a managed key entirely if the preset doesn't grant it).
  const moduleAccess: ModuleAccess = {};
  for (const [k, v] of Object.entries(current.moduleAccess ?? {})) {
    if (!STAFF_MANAGED_MODULE_KEYS.includes(k as (typeof STAFF_MANAGED_MODULE_KEYS)[number])) {
      moduleAccess[k] = v;
    }
  }
  for (const k of STAFF_MANAGED_MODULE_KEYS) {
    if (preset[k] !== undefined) moduleAccess[k] = preset[k];
  }

  // appAccess: keep unmanaged apps, set managed apps from the preset.
  const kept = (current.appAccess ?? []).filter(
    (a) => !STAFF_MANAGED_APPS.includes(a as (typeof STAFF_MANAGED_APPS)[number]),
  );
  const appAccess = [...new Set([...kept, ...managedApps])];

  return { appAccess, moduleAccess };
}

// Does a user's current access already match their position's preset (on the
// managed surface only)? Used by the deviation report.
export function matchesStaffPreset(current: StaffAccess, position: string | null | undefined): boolean {
  const next = applyStaffPreset(current, position);
  const curApps = new Set(current.appAccess ?? []);
  const nextApps = new Set(next.appAccess);
  if (curApps.size !== nextApps.size || [...nextApps].some((a) => !curApps.has(a))) return false;
  // Compare only the managed module keys (others are preserved so always equal).
  return STAFF_MANAGED_MODULE_KEYS.every((k) =>
    moduleValEq((current.moduleAccess ?? {})[k], next.moduleAccess[k]),
  );
}

// Human-readable diff of managed keys for the normalize preview.
export function staffPresetDiff(current: StaffAccess, position: string | null | undefined): string[] {
  const next = applyStaffPreset(current, position);
  const lines: string[] = [];
  const fmt = (v: true | string[] | undefined) => (v === true ? "ALL" : v && v.length ? v.join(", ") : "—");
  for (const k of STAFF_MANAGED_MODULE_KEYS) {
    const before = (current.moduleAccess ?? {})[k];
    const after = next.moduleAccess[k];
    if (!moduleValEq(before, after)) lines.push(`${k}: [${fmt(before)}] → [${fmt(after)}]`);
  }
  return lines;
}
