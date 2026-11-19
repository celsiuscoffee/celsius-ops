"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ClipboardCheck, CalendarDays, Package, ClipboardList } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";
import { hasAccess } from "@/lib/access";

/* Staff app tab bar (docs/design/staff-app-structure.md): one tab per job.
   Today: what to do next (clock in, the day's tasks). Checklists: the
   shift's SOP checklists (opening the tab also creates the day's lists).
   Shifts: when I work, my time, leave and pay. Stock: count, receive, waste,
   transfer, claim. Audit: managers' spot checks. Me opens from the button
   at the top right of Today.
   `also` lists the pages a tab owns, so the tab stays lit inside them; the
   longest matching path wins. */
type Tab = { href: string; label: string; icon: typeof Home; moduleKey?: string; also?: string[] };
type UserProfile = { id: string; name: string; role: string; moduleAccess?: Record<string, unknown> };

const allTabs: Tab[] = [
  { href: "/home", label: "Today", icon: Home, also: ["/profile"] },
  { href: "/checklists", label: "Checklists", icon: ClipboardCheck, moduleKey: "ops:checklists" },
  { href: "/hr", label: "Shifts", icon: CalendarDays, moduleKey: "hr" },
  {
    href: "/inventory", label: "Stock", icon: Package, moduleKey: "inventory",
    also: ["/stock-count", "/receiving", "/wastage", "/transfers", "/claims"],
  },
  { href: "/audit", label: "Audit", icon: ClipboardList, moduleKey: "ops:audit" },
];

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");

function activeTab(pathname: string, tabs: Tab[]): string | undefined {
  let best: { href: string; len: number } | undefined;
  for (const tab of tabs) {
    for (const p of [tab.href, ...(tab.also ?? [])]) {
      if (under(pathname, p) && (!best || p.length > best.len)) best = { href: tab.href, len: p.length };
    }
  }
  return best?.href;
}

export function BottomNav() {
  const pathname = usePathname();
  const { data: me } = useFetch<UserProfile>("/api/auth/me");

  const tabs = allTabs.filter((tab) => hasAccess(me?.role, me?.moduleAccess, tab.moduleKey));
  const active = activeTab(pathname, tabs);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-line bg-tab">
      <div className="mx-auto flex max-w-lg items-stretch justify-around px-1 pt-1">
        {tabs.map((tab) => {
          const isActive = tab.href === active;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className={`flex min-h-[52px] flex-1 flex-col items-center justify-center gap-[3px] text-[11px] transition-colors active:opacity-70 ${
                isActive ? "font-semibold text-brand-text" : "font-medium text-text-3"
              }`}
            >
              <Icon className="h-6 w-6" strokeWidth={isActive ? 2 : 1.8} />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
