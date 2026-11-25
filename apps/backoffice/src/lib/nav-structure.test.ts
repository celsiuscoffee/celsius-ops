import { describe, it, expect } from "vitest";
import { NAV_SECTIONS, locate, railPages, type UserProfile } from "./nav";

// Pins the section/page model described above NAV_SECTIONS: the rail lists one
// entry per section, the open section's pages nest under it, and on a phone
// (and for Settings) those pages scroll as one row of tabs
// (components/office-shell.tsx), so a section must stay small enough for that.

const MAX_TABS = 6;

describe("backoffice nav structure", () => {
  it("every section fits in one row of tabs", () => {
    const tooWide = NAV_SECTIONS.filter((s) => s.label !== "Team") // Team (HR) has its own module tabs
      .map((s) => ({ label: s.label, tabs: s.subgroups ? s.subgroups.length : (s.items ?? []).filter((i) => !i.hidden).length }))
      .filter((s) => s.tabs > MAX_TABS);
    expect(tooWide, `sections with more than ${MAX_TABS} tabs`).toEqual([]);
  });

  it("no page is listed twice", () => {
    const seen = new Map<string, number>();
    for (const s of NAV_SECTIONS) {
      const items = [...(s.items ?? []), ...(s.subgroups?.flatMap((g) => g.items) ?? [])];
      for (const i of items) seen.set(i.href, (seen.get(i.href) ?? 0) + 1);
    }
    expect([...seen].filter(([, n]) => n > 1).map(([h]) => h)).toEqual([]);
  });

  it("section and tab names are unique, so no two pages read the same", () => {
    const sections = NAV_SECTIONS.map((s) => s.label);
    expect(new Set(sections).size).toBe(sections.length);
    for (const s of NAV_SECTIONS) {
      const tabs = s.subgroups?.map((g) => g.label) ?? [];
      expect(new Set(tabs).size, `duplicate tab in ${s.label}`).toBe(tabs.length);
    }
  });

  it("only Settings lives behind the footer gear", () => {
    expect(NAV_SECTIONS.filter((s) => s.placement === "footer").map((s) => s.label)).toEqual(["Settings"]);
  });
});

// The shell (components/office-shell.tsx) nests the open section's pages in the
// rail and shows the current page's views as tabs. These pin where a URL lands.
const owner: UserProfile = { id: "o", name: "Owner", role: "OWNER", outletId: null, moduleAccess: [] };
const section = (label: string) => NAV_SECTIONS.find((s) => s.label === label)!;

describe("shell placement", () => {
  it("a tab URL lights up its page and section", () => {
    const p = locate("/inventory/reconciliation", owner);
    expect(p?.section.label).toBe("Orders");
    expect(p?.page?.label).toBe("Invoices");
    expect(p?.page?.tabs.map((t) => t.label)).toEqual(["Invoices", "Invoice match"]);
  });

  it("a deep URL under a page still lands on that page", () => {
    expect(locate("/inventory/orders/abc-123", owner)?.page?.label).toBe("Supplier orders");
  });

  it("a page links to its first view the user can open", () => {
    const pages = railPages(section("Orders"), owner);
    expect(pages.map((p) => p.label)).toEqual(["Supplier chats", "Supplier orders", "Invoices", "Suppliers"]);
    expect(pages.find((p) => p.label === "Invoices")?.href).toBe("/inventory/invoices");
  });

  it("pages and tabs follow the user's grants", () => {
    const manager: UserProfile = { id: "m", name: "Mgr", role: "MANAGER", outletId: "x", moduleAccess: ["inventory:invoices"] };
    const pages = railPages(section("Orders"), manager);
    expect(pages.map((p) => p.label)).toEqual(["Invoices"]);
    expect(railPages(section("Money"), manager)).toEqual([]); // finance:* is owner/admin only
  });

  it("the menu stays decluttered: one question per section, few pages each", () => {
    // 18 Nov 2026: the menu follows Gosamē Office's sections (owner: "only
    // follow the ones gosame did"; docs/design/backoffice-structure.md §2f).
    // Adding a page means taking one away, or a reason here.
    const rail = NAV_SECTIONS.filter((s) => s.placement !== "footer");
    const pages = rail.reduce((n, s) => n + railPages(s, owner).length, 0);
    expect(pages).toBeLessThanOrEqual(30);
    expect(rail.map((s) => s.label)).toEqual([
      "Agents", "Sales", "Customers", "Food", "Stock", "Orders", "Team", "Money", "Standards",
    ]);
  });

  it("set-up pages live behind the gear, not in the menu", () => {
    for (const href of ["/loyalty/missions", "/loyalty/mystery", "/loyalty/admin-claimables", "/pickup/splash-posters", "/inventory/groups", "/finance/coa"]) {
      expect(locate(href, owner)?.section.label, href).toBe("Settings");
    }
  });

  it("related views share one page", () => {
    expect(locate("/reviews/geogrid", owner)?.page?.label).toBe("Reviews");
    expect(locate("/inventory/transfers", owner)?.page?.label).toBe("Items");
    expect(locate("/inventory/packaging", owner)?.page?.label).toBe("Recipes");
    expect(locate("/inventory/perishables", owner)?.page?.label).toBe("Items");
    expect(locate("/finance/transactions", owner)?.page?.label).toBe("Reports");
  });

  it("Ads stay in the menu under Customers (owner: \"ads: keep\")", () => {
    expect(railPages(section("Customers"), owner).map((p) => p.label)).toEqual(["Profiles", "Rewards", "Reviews", "Messages", "Ads"]);
    expect(locate("/ads/grab", owner)?.page?.tabs.map((t) => t.label)).toEqual(["Google", "Google campaigns", "Optimizer", "GrabFood", "Ad invoices"]);
  });

  it("Money follows Gosamē's pages exactly", () => {
    expect(railPages(section("Money"), owner).map((p) => p.label)).toEqual(["Overview", "Bank inbox", "Cash flow", "Bills", "Reports"]);
    expect(locate("/finance/cashflow", owner)?.page?.tabs.map((t) => t.label)).toEqual(["Cash flow", "Bank statements", "Regular bills"]);
  });

  it("the home page belongs to no section", () => {
    expect(locate("/dashboard", owner)).toBeUndefined();
  });
});
