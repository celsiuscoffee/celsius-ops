import { describe, it, expect } from "vitest";
import { moduleApps, GRANTABLE_MODULE_KEYS, NAV_TABS, type GrantModule } from "./modules";

// Mirrors the Staff & Access editor's module-visibility rule: a toggle shows
// only when the user holds an app that actually reads the grant.
function moduleVisible(mod: GrantModule, appAccess: string[]): boolean {
  const s = moduleApps(mod.app, mod.key);
  return (
    (s.includes("backoffice") && appAccess.includes("backoffice")) ||
    (s.includes("staff") && appAccess.includes("ops"))
  );
}

function visibleKeys(appAccess: string[]): string[] {
  const out = new Set<string>();
  for (const tab of NAV_TABS)
    for (const g of tab.groups)
      for (const m of g.modules) if (moduleVisible(m, appAccess)) out.add(`${m.app}:${m.key}`);
  return [...out];
}

describe("moduleApps — which app reads a grant", () => {
  it("tags the shared operational keys as backoffice + staff", () => {
    expect(moduleApps("inventory", "stock-count")).toEqual(["backoffice", "staff"]);
    expect(moduleApps("ops", "audit")).toEqual(["backoffice", "staff"]);
    expect(moduleApps("sales", "dashboard")).toEqual(["backoffice", "staff"]);
  });

  it("tags checklists as staff-only", () => {
    expect(moduleApps("ops", "checklists")).toEqual(["staff"]);
  });

  it("defaults to backoffice-only for untagged and unknown keys", () => {
    expect(moduleApps("inventory", "products")).toEqual(["backoffice"]);
    expect(moduleApps("hr", "payroll")).toEqual(["backoffice"]);
    expect(moduleApps("loyalty", "members")).toEqual(["backoffice"]);
    expect(moduleApps("nope", "nope")).toEqual(["backoffice"]);
  });
});

describe("ops:checklists drift fix", () => {
  it("is now grantable (present in the registry)", () => {
    expect(GRANTABLE_MODULE_KEYS.has("ops:checklists")).toBe(true);
  });
});

describe("editor visibility matrix", () => {
  it("a Staff-App-only user sees the staff operational modules, not backoffice-only ones", () => {
    const staff = visibleKeys(["ops"]);
    expect(staff).toContain("inventory:stock-count");
    expect(staff).toContain("ops:checklists");
    expect(staff).toContain("sales:dashboard");
    expect(staff).not.toContain("hr:payroll");
    expect(staff).not.toContain("inventory:products");
    expect(staff).not.toContain("loyalty:members");
  });

  it("a Back-Office user sees the full admin registry", () => {
    const bo = visibleKeys(["backoffice"]);
    expect(bo).toContain("hr:payroll");
    expect(bo).toContain("inventory:products");
    expect(bo).toContain("inventory:stock-count");
  });

  it("a POS-only user sees no module toggles (POS reads no module grants)", () => {
    expect(visibleKeys(["pos"])).toHaveLength(0);
  });
});
