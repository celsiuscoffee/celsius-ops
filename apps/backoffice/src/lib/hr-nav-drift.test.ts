import { describe, it, expect } from "vitest";
import { NAV_SECTIONS } from "./nav";
import { TAB_GROUPS } from "@/components/hr/module-tabs";

// The HR module has two navigation sources: the sidebar registry (lib/nav.tsx,
// which also drives the route gate and module grants) and the in-module tab
// strip (components/hr/module-tabs.tsx). They are hand-maintained and had
// drifted twice (nav.tsx:243-245 records one). This pins them together: every
// HR page the sidebar knows must sit in exactly one tab group, and every tab
// must be a page the sidebar knows — so a new page is added to both or CI
// says which one was forgotten.

const hrSection = NAV_SECTIONS.find((s) => s.label === "HR");
const navHrefs = new Set((hrSection?.items ?? []).map((i) => i.href));

// Pages that deliberately have no tab strip: the hub itself, analytics
// (linked from the hub), and the settings tree (own SettingsNav).
const NO_TAB = new Set(["/hr", "/hr/analytics"]);
const isSettings = (href: string) => href.startsWith("/hr/settings");

describe("HR navigation sources agree", () => {
  it("the sidebar has an HR section", () => {
    expect(hrSection).toBeDefined();
    expect(navHrefs.size).toBeGreaterThan(10);
  });

  it("every HR sidebar page is in exactly one tab group (or is a known no-tab page)", () => {
    const tabCount = new Map<string, number>();
    for (const g of TAB_GROUPS) for (const t of g.tabs) tabCount.set(t.href, (tabCount.get(t.href) ?? 0) + 1);
    const missing = [...navHrefs].filter((h) => !NO_TAB.has(h) && !isSettings(h) && !tabCount.has(h));
    const doubled = [...tabCount.entries()].filter(([, n]) => n > 1).map(([h]) => h);
    expect(missing, "sidebar pages with no tab").toEqual([]);
    expect(doubled, "tabs listed in more than one group").toEqual([]);
  });

  it("every tab is a page the sidebar registry knows (or a settings cross-link)", () => {
    const unknown = TAB_GROUPS.flatMap((g) => g.tabs)
      .map((t) => t.href)
      .filter((h) => !navHrefs.has(h) && !isSettings(h) && h !== "/hr/payroll/weekly");
    expect(unknown, "tabs pointing at pages missing from lib/nav.tsx").toEqual([]);
  });
});
