import { describe, it, expect } from "vitest";
import { menuViews, pageLabel, pageOf, summarise, type UsageRow } from "./usage";

describe("which page a path counts as", () => {
  it("a record under a menu page counts as that page", () => {
    expect(pageOf("/inventory/orders/3f2b1c4d-1111-2222-3333-444455556666")).toBe("/inventory/orders");
    expect(pageOf("/hr/employees/abc?tab=pay")).toBe("/hr/employees");
  });
  it("the most specific registered view wins", () => {
    expect(pageOf("/inventory/menus/cards")).toBe("/inventory/menus/cards");
    expect(pageOf("/reviews/geogrid")).toBe("/reviews/geogrid");
  });
  it("an unregistered path keeps its shape, with ids folded", () => {
    expect(pageOf("/pos/z-report/12345")).toBe("/pos/z-report/:id");
  });
  it("names a page by where it sits in the menu", () => {
    expect(pageLabel("/inventory/reconciliation")).toEqual({ label: "Invoice match", where: "Orders › Invoices" });
    expect(pageLabel("/dashboard").label).toBe("Today");
    expect(pageLabel("/nowhere").where).toBe("Off the menu");
  });
  it("hidden views are not counted as menu pages nobody opened", () => {
    expect(menuViews()).toContain("/hr/roster");
    expect(menuViews()).not.toContain("/loyalty/points-log");
  });
});

describe("the 30-day summary", () => {
  const now = new Date("2026-11-17T04:00:00Z"); // 12:00 PM MYT
  const at = (iso: string) => new Date(iso);
  const rows: UsageRow[] = [
    { userId: "a", page: "/inbox", viewport: "phone", at: at("2026-11-16T02:00:00Z") },
    { userId: "a", page: "/inbox", viewport: "desktop", at: at("2026-11-10T02:00:00Z") },
    { userId: "b", page: "/inbox", viewport: "desktop", at: at("2026-11-01T02:00:00Z") },
    { userId: "b", page: "/hr/roster", viewport: "desktop", at: at("2026-11-02T02:00:00Z") },
    { userId: "c", page: "/hr/roster", viewport: "desktop", at: at("2026-10-01T02:00:00Z") }, // previous period
  ];
  const s = summarise(rows, { days: 30, now, names: new Map([["a", "Aina"], ["b", "Ben"]]), menuPages: ["/inbox", "/hr/roster", "/ads/grab"] });

  it("counts views, people and phone use in the period, and the period before", () => {
    expect(s.totals).toEqual({ views: 4, people: 2, phoneViews: 1, desktopViews: 3 });
    expect(s.previous).toEqual({ views: 1, people: 1 });
  });
  it("ranks pages and lists the menu pages nobody opened", () => {
    expect(s.pages.map((p) => [p.page, p.views, p.people])).toEqual([["/inbox", 3, 2], ["/hr/roster", 1, 1]]);
    expect(s.unopened.map((u) => u.page)).toEqual(["/ads/grab"]);
  });
  it("lists people, most active first, and names someone who left", () => {
    expect(s.people.map((p) => [p.name, p.views])).toEqual([["Aina", 2], ["Ben", 2]]);
  });
});
