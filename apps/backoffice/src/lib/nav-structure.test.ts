import { describe, it, expect } from "vitest";
import { NAV_SECTIONS } from "./nav";

// Pins the section/tab model described above NAV_SECTIONS: the sidebar lists
// one entry per section and each section's pages render as tabs
// (components/section-tabs.tsx), so a section must stay small enough to read
// as one row of tabs.

const MAX_TABS = 6;

describe("backoffice nav structure", () => {
  it("every section fits in one row of tabs", () => {
    const tooWide = NAV_SECTIONS.filter((s) => s.label !== "HR") // HR has its own module tabs
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
