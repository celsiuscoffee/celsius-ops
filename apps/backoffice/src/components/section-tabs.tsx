"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  NAV_SECTIONS,
  canAccess,
  pathMatchesSection,
  type NavItem,
  type NavSection,
  type UserProfile,
} from "@/lib/nav";

// Section tab strip, rendered by (admin)/layout.tsx above every page. The
// sidebar picks the section; this strip moves between the section's pages.
//
// Driven entirely by lib/nav.tsx:
//   - a subgroup section → one tab per subgroup (link = its first visible
//     page); the active subgroup's pages form a lighter second row when it
//     has more than one.
//   - a flat-items section → one tab per visible item.
// A strip with a single tab and no second row isn't drawn.
//
// HR is skipped: it has its own module tabs (components/hr/module-tabs.tsx),
// pinned to nav.tsx by hr-nav-drift.test.ts.

type Tab = { label: string; href: string; items: NavItem[]; allHrefs: string[] };

const show = (user: UserProfile | undefined) => (item: NavItem) =>
  !item.hidden && canAccess(user, item.moduleKey);

// Longest href (hidden items included) that the pathname sits under.
function bestMatch(pathname: string, hrefs: string[]): string | undefined {
  let best: string | undefined;
  for (const h of hrefs) {
    if (pathname === h || pathname.startsWith(h + "/")) {
      if (!best || h.length > best.length) best = h;
    }
  }
  return best;
}

export function buildTabs(section: NavSection, user: UserProfile | undefined): Tab[] {
  if (section.subgroups) {
    return section.subgroups
      .map((sg) => {
        const items = sg.items.filter(show(user));
        return { label: sg.label, href: items[0]?.href ?? "", items, allHrefs: sg.items.map((i) => i.href) };
      })
      .filter((t) => t.items.length > 0);
  }
  return (section.items ?? [])
    .filter(show(user))
    .map((i) => ({ label: i.label, href: i.href, items: [i], allHrefs: [i.href] }));
}

export function SectionTabs({ user }: { user: UserProfile | undefined }) {
  const pathname = usePathname() ?? "";
  if (pathname === "/" || pathname === "/dashboard") return null;

  const section = NAV_SECTIONS.find((s) => pathMatchesSection(pathname, s));
  if (!section || section.label === "HR") return null;

  const tabs = buildTabs(section, user);
  const current = bestMatch(pathname, tabs.flatMap((t) => t.allHrefs));
  const activeTab = tabs.find((t) => current && t.allHrefs.includes(current));
  const secondRow = activeTab && activeTab.items.length > 1 ? activeTab.items : [];

  if (tabs.length <= 1 && secondRow.length === 0) return null;

  return (
    <nav aria-label={`${section.label} pages`} className="border-b bg-card/50 print:hidden">
      <div className="flex items-center gap-1 overflow-x-auto px-4 pt-2 sm:px-6 lg:px-8">
        <span className="mr-2 hidden pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:block">
          {section.label}
        </span>
        {tabs.map((t) => {
          const active = t === activeTab;
          return (
            <Link
              key={t.label}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={
                "whitespace-nowrap border-b-2 px-3 pb-2 pt-1 text-sm font-medium transition " +
                (active
                  ? "border-terracotta text-terracotta"
                  : "border-transparent text-muted-foreground hover:border-gray-300 hover:text-foreground")
              }
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      {secondRow.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto px-4 py-1.5 sm:px-6 lg:px-8">
          {secondRow.map((i) => {
            const active = i.href === current;
            return (
              <Link
                key={i.href}
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={
                  "whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium transition " +
                  (active
                    ? "bg-terracotta/10 text-terracotta"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground")
                }
              >
                {i.label}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
