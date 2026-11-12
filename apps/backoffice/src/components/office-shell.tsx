"use client";

// Celsius Office shell: the rail, the page header, the page tabs and the
// phone tab bar. Gosamē UI's Office rules with Celsius brand values
// (styles/celsius-ui/tokens.css; owner-approved 11 Nov 2026):
//   - Rail 236 px, paper in light mode. One row per section, grouped (Sell,
//     Make and supply, Run the business); the open section's pages nest under
//     it. Active section: raised fill, 1 px line, terracotta dot.
//   - Header 56 px with the crumb (Section / Page).
//   - Page tabs: the current page's related views as underline tabs, only when
//     it has more than one. On a phone the section's pages scroll above them.
//   - Phone: a top bar and a 4-tab bar (Today · Sales · Procurement · More);
//     More opens the rail as a sheet.
// Everything is read from lib/nav.tsx, so the rail, the crumb, the tabs, ⌘K and
// the route gate can never disagree. URLs and permissions are untouched.

import Link from "next/link";
import Image from "next/image";
import { Fragment } from "react";
import { usePathname } from "next/navigation";
import { LayoutDashboard, LogOut, Moon, Search, Settings, Sun, Menu as MenuIcon, BarChart3, Truck } from "lucide-react";
import { SidebarContent, SidebarFooter, SidebarHeader, useSidebar } from "@/components/ui/sidebar";
import { useTheme } from "@/components/theme-provider";
import {
  NAV_SECTIONS,
  getVisibleItems,
  locate,
  pathMatchesSection,
  railPages,
  type NavSection,
  type UserProfile,
} from "@/lib/nav";

export const openCommandPalette = () => window.dispatchEvent(new Event("celsius:open-palette"));

const isHome = (p: string) => p === "/" || p === "/dashboard";

// ─── Rail ───────────────────────────────────────────────────────────────

function RailRow({
  href, icon, label, active, onNavigate, count,
}: { href: string; icon: React.ReactNode; label: string; active: boolean; onNavigate: () => void; count?: number }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={label}
      className={
        "relative flex h-7 items-center gap-2.5 rounded-ctl px-2.5 text-sm transition-colors max-md:h-11 " +
        "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 " +
        "[&_svg]:size-[17px] [&_svg]:shrink-0 " +
        (active
          ? "bg-rail-2 font-medium text-rail-text shadow-[0_0_0_1px_var(--rail-line)]"
          : "text-rail-text-2 hover:bg-rail-2 hover:text-rail-text")
      }
    >
      {icon}
      <span className="truncate group-data-[collapsible=icon]:hidden">{label}</span>
      {count ? (
        <span className="ml-auto rounded-full bg-danger-soft px-1.5 font-mono text-[11px] font-semibold leading-[18px] text-danger-text group-data-[collapsible=icon]:hidden">
          {count}
        </span>
      ) : active ? (
        <span aria-hidden className="ml-auto size-[7px] shrink-0 rounded-full bg-brand group-data-[collapsible=icon]:hidden" />
      ) : null}
    </Link>
  );
}

export function Rail({ user, onLogout, extra }: { user: UserProfile; onLogout: () => void; extra?: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const { isMobile, setOpenMobile } = useSidebar();
  const close = () => { if (isMobile) setOpenMobile(false); };
  const placement = locate(pathname, user);
  const rail = NAV_SECTIONS.filter((s) => s.placement !== "footer");
  const settings = NAV_SECTIONS.find((s) => s.placement === "footer");
  const settingsHref = settings ? getVisibleItems(settings, user)[0]?.href : undefined;
  const settingsOn = settings ? pathMatchesSection(pathname, settings) : false;
  const visibleRail = rail.filter((s) => getVisibleItems(s, user)[0]);

  return (
    <>
      <SidebarHeader className="px-3 pt-4 pb-0">
        <div className="flex items-center gap-2.5 px-1.5 pb-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <Image src="/images/celsius-logo-sm.jpg" alt="Celsius" width={32} height={32} className="size-8 shrink-0 rounded-ctl" />
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <p className="font-heading text-base font-bold leading-[18px] text-rail-text">Celsius</p>
            <p className="text-xs text-rail-text-2">Office</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { close(); openCommandPalette(); }}
          className="mb-3 flex h-8 items-center justify-between rounded-ctl border border-rail-line bg-rail-2 px-2.5 text-[13px] text-rail-text-2 hover:text-rail-text group-data-[collapsible=icon]:hidden max-md:h-11"
        >
          <span className="flex items-center gap-2"><Search className="size-3.5" />Jump to…</span>
          <kbd className="font-mono text-[11px] max-md:hidden">⌘K</kbd>
        </button>
      </SidebarHeader>

      <SidebarContent className="scrollbar-thin px-3 pb-3">
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          <RailRow href="/dashboard" icon={<LayoutDashboard />} label="Today" active={isHome(pathname)} onNavigate={close} />

          {visibleRail.map((section: NavSection, i) => {
            const first = getVisibleItems(section, user)[0]?.href;
            if (!first) return null;
            const open = pathMatchesSection(pathname, section);
            const pages = open ? railPages(section, user) : [];
            const groupLabel = section.group && section.group !== visibleRail[i - 1]?.group ? section.group : undefined;
            return (
              <Fragment key={section.label}>
                {groupLabel && (
                  <p className="px-2.5 pt-4 pb-1.5 font-mono text-[11px] font-semibold uppercase leading-[14px] tracking-[0.06em] text-rail-text-2 group-data-[collapsible=icon]:hidden">
                    {groupLabel}
                  </p>
                )}
                {section.dividerBefore && !section.group && <div aria-hidden className="mx-2.5 my-2 h-px bg-rail-line" />}
                <RailRow href={first} icon={section.icon} label={section.label} active={open} onNavigate={close} />
                {open && pages.length > 1 && (
                  <div className="flex flex-col group-data-[collapsible=icon]:hidden">
                    {pages.map((p) => {
                      const current = placement?.page === p;
                      return (
                        <Link
                          key={p.label}
                          href={p.href}
                          onClick={close}
                          aria-current={current ? "page" : undefined}
                          className={
                            "flex h-[26px] items-center truncate rounded-ctl pl-[37px] pr-2.5 text-[13px] max-md:h-10 " +
                            (current ? "font-medium text-rail-text" : "text-rail-text-2 hover:text-rail-text")
                          }
                        >
                          {p.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </Fragment>
            );
          })}
        </nav>
      </SidebarContent>

      <SidebarFooter className="px-3 pb-3">
        <div className="border-t border-rail-line pt-2.5">
          <div className="flex items-center gap-2.5 group-data-[collapsible=icon]:justify-center">
            <div className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-rail-2 text-xs font-semibold text-rail-text shadow-[0_0_0_1px_var(--rail-line)]">
              {user.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <p className="truncate text-[13px] font-medium text-rail-text">{user.name}</p>
              <p className="truncate text-xs text-rail-text-2">{user.outletName ?? (user.role === "OWNER" || user.role === "ADMIN" ? "All outlets" : user.role)}</p>
            </div>
            {settingsHref && (
              <Link
                href={settingsHref}
                onClick={close}
                title="Settings"
                aria-label="Settings"
                aria-current={settingsOn ? "page" : undefined}
                className={
                  "flex size-7 shrink-0 items-center justify-center rounded-ctl text-rail-text-2 hover:bg-rail-2 hover:text-rail-text max-md:size-11 group-data-[collapsible=icon]:hidden " +
                  (settingsOn ? "bg-rail-2 text-rail-text shadow-[0_0_0_1px_var(--rail-line)]" : "")
                }
              >
                <Settings className="size-[17px]" />
              </Link>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-1 group-data-[collapsible=icon]:hidden">
            <div className="min-w-0 flex-1">{extra}</div>
            <ThemeButton />
            <button
              type="button"
              onClick={onLogout}
              title="Sign out"
              aria-label="Sign out"
              className="flex size-7 shrink-0 items-center justify-center rounded-ctl text-rail-text-2 hover:bg-rail-2 hover:text-rail-text max-md:size-11"
            >
              <LogOut className="size-[17px]" />
            </button>
          </div>
        </div>
      </SidebarFooter>
    </>
  );
}

function ThemeButton() {
  const { resolved, setTheme } = useTheme();
  const dark = resolved === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      title={dark ? "Light mode" : "Dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="flex size-7 shrink-0 items-center justify-center rounded-ctl text-rail-text-2 hover:bg-rail-2 hover:text-rail-text max-md:size-11"
    >
      {dark ? <Sun className="size-[17px]" /> : <Moon className="size-[17px]" />}
    </button>
  );
}

// ─── Header (desktop) and top bar (phone) ───────────────────────────────

export function OfficeHeader({ user }: { user: UserProfile }) {
  const pathname = usePathname() ?? "";
  const placement = locate(pathname, user);
  const sectionLabel = isHome(pathname) ? "Today" : placement?.section.label;
  const pageLabel = placement?.page && placement.pages.length > 1 ? placement.page.label : undefined;
  const title = pageLabel ?? sectionLabel ?? "Celsius Office";

  return (
    <header className="sticky top-0 z-20 flex min-h-14 items-center gap-3 border-b border-line bg-bg/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-bg/80 md:px-8 print:hidden">
      {/* Phone: logo tile + where you are + search */}
      <Image src="/images/celsius-logo-sm.jpg" alt="" width={30} height={30} className="size-[30px] rounded-ctl md:hidden" />
      <p className="min-w-0 flex-1 truncate text-[17px] font-semibold text-text md:hidden">{title}</p>
      <button
        type="button"
        onClick={openCommandPalette}
        aria-label="Search pages and people"
        className="flex size-10 items-center justify-center rounded-full border border-line bg-surface text-text md:hidden"
      >
        <Search className="size-[18px]" />
      </button>
      {/* Desktop: crumb */}
      <nav aria-label="Breadcrumb" className="hidden min-w-0 flex-1 truncate text-[13px] text-text-3 md:block">
        {pageLabel ? (
          <>
            {sectionLabel} / <span className="font-medium text-text">{pageLabel}</span>
          </>
        ) : (
          <span className="font-medium text-text">{sectionLabel ?? "Celsius Office"}</span>
        )}
      </nav>
    </header>
  );
}

// ─── Page tabs ──────────────────────────────────────────────────────────

const tabClass = (on: boolean) =>
  "flex h-9 shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-[13px] transition-colors -mb-px " +
  (on ? "border-text font-semibold text-text" : "border-transparent text-text-2 hover:text-text");

export function PageTabs({ user }: { user: UserProfile }) {
  const pathname = usePathname() ?? "";
  if (isHome(pathname)) return null;
  const placement = locate(pathname, user);
  if (!placement) return null;
  const { section, page, href, pages } = placement;
  // HR keeps its own module tabs (components/hr/module-tabs.tsx).
  const isHr = section.label === "HR";
  const footer = section.placement === "footer";
  const tabs = !isHr && page && page.tabs.length > 1 ? page.tabs : [];
  // On a phone the rail is hidden, so the section's pages scroll above the
  // tabs. Settings (behind the gear) shows its groups this way on every size.
  const showPages = pages.length > 1 && !isHr;

  if (!showPages && tabs.length === 0) return null;
  return (
    <div className="print:hidden">
      {showPages && (
        <nav aria-label={`${section.label} pages`} className={"scrollbar-none flex overflow-x-auto border-b border-line px-4 md:px-8 " + (footer ? "" : "md:hidden")}>
          {pages.map((p) => (
            <Link key={p.label} href={p.href} aria-current={p === page ? "page" : undefined} className={tabClass(p === page)}>
              {p.label}
            </Link>
          ))}
        </nav>
      )}
      {tabs.length > 0 && (
        <nav aria-label={`${page?.label} views`} className="scrollbar-none flex overflow-x-auto border-b border-line px-4 md:px-8">
          {tabs.map((t) => (
            <Link key={t.href} href={t.href} aria-current={t.href === href ? "page" : undefined} className={tabClass(t.href === href)}>
              {t.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

// ─── Phone tab bar ──────────────────────────────────────────────────────

export function PhoneTabBar({ user }: { user: UserProfile }) {
  const pathname = usePathname() ?? "";
  const { setOpenMobile, openMobile } = useSidebar();
  const sectionHref = (label: string) => {
    const s = NAV_SECTIONS.find((x) => x.label === label);
    return s ? { s, href: getVisibleItems(s, user)[0]?.href } : undefined;
  };
  const sales = sectionHref("Sales");
  const procurement = sectionHref("Procurement");
  const item = (on: boolean) =>
    "flex flex-1 flex-col items-center gap-[3px] pt-2 text-[11px] " + (on ? "font-semibold text-text" : "text-text-2");

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-tab pb-[max(env(safe-area-inset-bottom),12px)] md:hidden print:hidden"
    >
      <Link href="/dashboard" className={item(isHome(pathname))} aria-current={isHome(pathname) ? "page" : undefined}>
        <LayoutDashboard className="size-6" strokeWidth={isHome(pathname) ? 2 : 1.8} />Today
      </Link>
      {sales?.href && (
        <Link href={sales.href} className={item(pathMatchesSection(pathname, sales.s))}>
          <BarChart3 className="size-6" strokeWidth={1.8} />Sales
        </Link>
      )}
      {procurement?.href && (
        <Link href={procurement.href} className={item(pathMatchesSection(pathname, procurement.s))}>
          <Truck className="size-6" strokeWidth={1.8} />Procurement
        </Link>
      )}
      <button type="button" onClick={() => setOpenMobile(!openMobile)} className={item(openMobile)} aria-expanded={openMobile}>
        <MenuIcon className="size-6" strokeWidth={1.8} />More
      </button>
    </nav>
  );
}
