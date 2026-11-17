// Office usage (Settings › Office Usage, declutter 17 Nov 2026): which pages
// people open, and on which device, so the menu follows what is really used.
// Ported from Gosamē Office's usage page. Views are recorded by the shell
// (components/usage-tracker.tsx) into ActivityLog as module "usage", action
// "view", targetName = the page, details = { path, viewport }: no schema
// change, no outside service. This file holds the pure parts.
import { NAV_SECTIONS } from "@/lib/nav";

export const USAGE_MODULE = "usage";
export const USAGE_ACTION = "view";
export type Viewport = "phone" | "desktop";

type Entry = { href: string; label: string; where: string; hidden: boolean };

// Every registered view, plus the two pages that sit above the sections.
function entries(): Entry[] {
  const out: Entry[] = [
    { href: "/dashboard", label: "Today", where: "Today", hidden: false },
    { href: "/inbox", label: "Inbox", where: "Inbox", hidden: false },
  ];
  for (const s of NAV_SECTIONS) {
    if (s.subgroups) {
      for (const g of s.subgroups) for (const i of g.items) {
        out.push({ href: i.href, label: i.label, where: g.label === i.label ? s.label : `${s.label} › ${g.label}`, hidden: !!i.hidden });
      }
    } else {
      for (const i of s.items ?? []) out.push({ href: i.href, label: i.label, where: s.label, hidden: !!i.hidden });
    }
  }
  return out;
}

const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|c[a-z0-9]{20,}|\d+|[A-Za-z0-9_-]{24,})$/i;

/**
 * The page a path counts as: the registered view it sits under
 * ("/inventory/orders/3f…" → "/inventory/orders"), else the path with record
 * ids written as ":id", so a thousand records are one page.
 */
export function pageOf(path: string): string {
  const clean = (path.split(/[?#]/)[0] || "/").replace(/\/+$/, "") || "/";
  let best = "";
  for (const e of entries()) {
    if ((clean === e.href || clean.startsWith(`${e.href}/`)) && e.href.length > best.length) best = e.href;
  }
  if (best) return best;
  return clean.split("/").map((seg) => (seg && ID_SEGMENT.test(seg) ? ":id" : seg)).join("/");
}

/** The menu's name for a page, with where it sits ("Procurement › Invoices"). */
export function pageLabel(page: string): { label: string; where: string } {
  const e = entries().find((x) => x.href === page);
  return e ? { label: e.label, where: e.where } : { label: page, where: "Off the menu" };
}

/** Views a person can reach from the menu (not hidden), for "nobody opened". */
export function menuViews(): string[] {
  return [...new Set(entries().filter((e) => !e.hidden).map((e) => e.href))];
}

export type UsageRow = { userId: string; page: string; viewport: Viewport; at: Date };

export type UsageSummary = {
  days: number;
  from: string;
  to: string;
  totals: { views: number; people: number; phoneViews: number; desktopViews: number };
  /** the same numbers for the period before, as the reference */
  previous: { views: number; people: number };
  pages: { page: string; label: string; where: string; views: number; people: number; phoneViews: number }[];
  unopened: { page: string; label: string; where: string }[];
  /** people with at least one view, most active first */
  people: { userId: string; name: string; views: number; pages: number; lastAt: string }[];
};

const MYT_MS = 8 * 3600_000;
const mytDay = (d: Date) => new Date(d.getTime() + MYT_MS).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/**
 * Summarise `rows` (views from `days` × 2 back to now) for the last `days`
 * days (Malaysia dates), with the `days` before as the reference.
 */
export function summarise(rows: UsageRow[], { days, now, names, menuPages }: { days: number; now: Date; names: Map<string, string>; menuPages: string[] }): UsageSummary {
  const to = mytDay(now);
  const from = addDays(to, -(days - 1));
  const prevFrom = addDays(from, -days);
  const cur = rows.filter((r) => mytDay(r.at) >= from && mytDay(r.at) <= to);
  const prev = rows.filter((r) => { const d = mytDay(r.at); return d >= prevFrom && d < from; });

  const pageMap = new Map<string, { views: number; people: Set<string>; phoneViews: number }>();
  for (const r of cur) {
    const p = pageMap.get(r.page) ?? { views: 0, people: new Set<string>(), phoneViews: 0 };
    p.views++;
    p.people.add(r.userId);
    if (r.viewport === "phone") p.phoneViews++;
    pageMap.set(r.page, p);
  }
  const pages = [...pageMap.entries()]
    .map(([page, p]) => ({ page, ...pageLabel(page), views: p.views, people: p.people.size, phoneViews: p.phoneViews }))
    .sort((a, b) => b.views - a.views || b.people - a.people || a.label.localeCompare(b.label));
  const unopened = menuPages.filter((p) => !pageMap.has(p)).map((page) => ({ page, ...pageLabel(page) }));

  const personMap = new Map<string, { views: number; pages: Set<string>; lastAt: Date }>();
  for (const r of cur) {
    const p = personMap.get(r.userId) ?? { views: 0, pages: new Set<string>(), lastAt: r.at };
    p.views++;
    p.pages.add(r.page);
    if (r.at > p.lastAt) p.lastAt = r.at;
    personMap.set(r.userId, p);
  }
  const people = [...personMap.entries()]
    .map(([userId, p]) => ({ userId, name: names.get(userId) ?? "Someone who left", views: p.views, pages: p.pages.size, lastAt: p.lastAt.toISOString() }))
    .sort((a, b) => b.views - a.views);

  const phoneViews = cur.filter((r) => r.viewport === "phone").length;
  return {
    days, from, to,
    totals: { views: cur.length, people: personMap.size, phoneViews, desktopViews: cur.length - phoneViews },
    previous: { views: prev.length, people: new Set(prev.map((r) => r.userId)).size },
    pages, unopened, people,
  };
}
