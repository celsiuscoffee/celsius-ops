"use client";

import { useEffect, useState, Fragment } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  ChevronRight,
  LogOut,
  LayoutDashboard,
  Lock,
  Eye,
  EyeOff,
  Check,
  Loader2,
  Sun,
  Moon,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { useTheme } from "@/components/theme-provider";
import { CommandPalette } from "@/components/command-palette";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useFetch } from "@/lib/use-fetch";
import {
  NAV_SECTIONS,
  DASHBOARD_HOME_MODULE,
  canAccess,
  firstAccessibleHref,
  getVisibleItems,
  leafIsActive,
  pathMatchesSection,
  type NavSection,
  type UserProfile,
} from "@/lib/nav";

// Nav structure, RBAC (canAccess), and active-state helpers live in
// lib/nav.tsx — shared with the ⌘K palette's page index. This file is just
// the chrome: sidebar rendering, auth/redirect guards, and page shell.

// Render a section's leaves into the collapsible sub-menu. Handles both flat
// `items` sections and `subgroups` sections (3rd tier) — subgroups render a
// small uppercase label header, then their items. RBAC + empty-group hiding
// preserved exactly. On mobile, picking a page closes the sidebar sheet so
// the destination is immediately visible.
function SectionLinks({
  section,
  user,
  pathname,
}: {
  section: NavSection;
  user: UserProfile | undefined;
  pathname: string;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  if (section.items) {
    const vis = section.items.filter((item) => canAccess(user, item.moduleKey));
    const hrefs = vis.map((i) => i.href);
    return (
      <>
        {vis.map((item) => (
          <SidebarMenuSubItem key={item.href}>
            <SidebarMenuSubButton asChild isActive={leafIsActive(pathname, item.href, hrefs)}>
              <Link href={item.href} onClick={closeOnMobile}>
                {item.icon}
                <span className="truncate">{item.label}</span>
              </Link>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        ))}
      </>
    );
  }
  if (section.subgroups) {
    return (
      <>
        {section.subgroups.map((sg) => {
          const vis = sg.items.filter((item) => canAccess(user, item.moduleKey));
          if (vis.length === 0) return null;
          const hrefs = vis.map((i) => i.href);
          return (
            <Fragment key={sg.label}>
              <li className="px-2 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40 first:pt-1">
                {sg.label}
              </li>
              {vis.map((item) => (
                <SidebarMenuSubItem key={item.href}>
                  <SidebarMenuSubButton asChild isActive={leafIsActive(pathname, item.href, hrefs)}>
                    <Link href={item.href} onClick={closeOnMobile}>
                      {item.icon}
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
            </Fragment>
          );
        })}
      </>
    );
  }
  return null;
}

// ─── Theme toggle (sidebar footer) ──────────────────────────────────────
function SidebarThemeToggle() {
  const { resolved, setTheme } = useTheme();
  return (
    <button
      onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
      className="flex h-7 w-7 items-center justify-center rounded-md text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
      title={resolved === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {resolved === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

// ─── User footer ────────────────────────────────────────────────────────
function SidebarUserFooter({ user, onLogout }: { user: UserProfile; onLogout: () => void }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <div className="flex items-center gap-2 px-1.5 py-1">
          <Avatar size="sm">
            <AvatarFallback className="bg-sidebar-primary/30 text-sidebar-foreground text-xs">
              {user.name?.slice(0, 2).toUpperCase() || "U"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-xs font-medium text-sidebar-foreground">{user.name}</p>
            <p className="truncate text-[10px] text-sidebar-foreground/50">{user.role}</p>
          </div>
          <div className="flex items-center gap-0.5 group-data-[collapsible=icon]:hidden">
            <SidebarThemeToggle />
            <button
              onClick={onLogout}
              title="Logout"
              className="flex h-7 w-7 items-center justify-center rounded-md text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </SidebarMenuItem>
      <SidebarMenuItem className="group-data-[collapsible=icon]:hidden">
        <div className="px-0.5">
          <PasswordChangeDialog hasPassword={user.hasPassword} />
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

// ─── App Sidebar (single collapsible) ───────────────────────────────────
function AppSidebar({ user, onLogout }: { user: UserProfile; onLogout: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { state, isMobile } = useSidebar();
  const isDashboard = pathname === "/dashboard" || pathname === "/";

  // Which top-level section is expanded (one at a time). Auto-follows the
  // active route; the user can toggle any section without leaving the page.
  const [openSection, setOpenSection] = useState<string | null>(null);

  useEffect(() => {
    if (pathname === "/dashboard" || pathname === "/") {
      setOpenSection(null);
      return;
    }
    for (const section of NAV_SECTIONS) {
      if (pathMatchesSection(pathname, section)) {
        setOpenSection(section.label);
        return;
      }
    }
  }, [pathname]);

  // Clicking a section header expands/collapses it — it never navigates, so
  // browsing the menu can't yank you off the page you're reading. The one
  // exception: with the sidebar collapsed to icons (desktop), the sub-menu
  // can't render, so the icon itself navigates to the section's first page.
  const handleSectionToggle = (section: NavSection) => {
    if (state === "collapsed" && !isMobile) {
      const firstHref = getVisibleItems(section, user)[0]?.href;
      if (firstHref) router.push(firstHref);
      setOpenSection(section.label);
      return;
    }
    setOpenSection((cur) => (cur === section.label ? null : section.label));
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-1.5 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <Image
            src="/images/celsius-logo-sm.jpg"
            alt="Celsius"
            width={32}
            height={32}
            className="rounded-lg shrink-0 group-data-[collapsible=icon]:hidden"
          />
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <p className="font-heading text-sm font-bold leading-tight text-sidebar-foreground">Celsius Ops</p>
            <p className="text-[10px] text-sidebar-foreground/50">Backoffice</p>
          </div>
          {/* Collapse/expand toggle lives in the sidebar (desktop only). When
              collapsed it's the lone centered control; mobile uses the top-bar
              trigger instead, so hide this below md. */}
          <SidebarTrigger className="shrink-0 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground max-md:hidden" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {/* Dashboard — always available */}
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={isDashboard} tooltip="Dashboard">
                <Link href="/dashboard">
                  <LayoutDashboard />
                  <span>Dashboard</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {NAV_SECTIONS.map((section) => {
              const visible = getVisibleItems(section, user);
              if (visible.length === 0) return null;

              const sectionActive = pathMatchesSection(pathname, section);
              const open = openSection === section.label;

              return (
                <Fragment key={section.label}>
                  {section.dividerBefore && (
                    <li aria-hidden className="mx-2 my-1 h-px bg-sidebar-border" />
                  )}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={sectionActive}
                      tooltip={section.label}
                      aria-expanded={open}
                      onClick={() => handleSectionToggle(section)}
                    >
                      {section.icon}
                      <span className="truncate group-data-[collapsible=icon]:hidden">{section.label}</span>
                      <ChevronRight
                        className={`ml-auto shrink-0 transition-transform group-data-[collapsible=icon]:hidden ${open ? "rotate-90" : ""}`}
                      />
                    </SidebarMenuButton>
                    {open && (
                      <SidebarMenuSub>
                        <SectionLinks section={section} user={user} pathname={pathname} />
                      </SidebarMenuSub>
                    )}
                  </SidebarMenuItem>
                </Fragment>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarUserFooter user={user} onLogout={onLogout} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

// ─── Password Change Dialog ─────────────────────────────────────────────

function PasswordChangeDialog({ hasPassword }: { hasPassword?: boolean }) {
  const [open, setOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const reset = () => {
    setCurrentPw("");
    setNewPw("");
    setConfirmPw("");
    setError("");
    setSuccess(false);
    setShowCurrent(false);
    setShowNew(false);
  };

  const handleSave = async () => {
    setError("");
    if (newPw.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (newPw !== confirmPw) { setError("Passwords do not match"); return; }

    setSaving(true);
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: hasPassword ? currentPw : undefined,
          newPassword: newPw,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to save"); setSaving(false); return; }

      setSuccess(true);
      setTimeout(() => { setOpen(false); reset(); }, 1500);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors cursor-pointer"
      >
        <Lock className="h-3 w-3" />
        {hasPassword ? "Change Password" : "Set Password"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{hasPassword ? "Change Password" : "Set Password"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {hasPassword && (
            <div className="relative">
              <input
                type={showCurrent ? "text" : "password"}
                placeholder="Current password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                className="w-full rounded-lg border border-border bg-transparent px-3 py-2 pr-9 text-sm outline-none focus:ring-2 focus:ring-ring/50"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          )}
          <div className="relative">
            <input
              type={showNew ? "text" : "password"}
              placeholder="New password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className="w-full rounded-lg border border-border bg-transparent px-3 py-2 pr-9 text-sm outline-none focus:ring-2 focus:ring-ring/50"
            />
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
            >
              {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <input
            type={showNew ? "text" : "password"}
            placeholder="Confirm new password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/50"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          {success && (
            <p className="flex items-center gap-1 text-xs text-green-600">
              <Check className="h-3 w-3" /> Password saved
            </p>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !newPw || !confirmPw}
            className="flex w-full items-center justify-center rounded-lg bg-terracotta py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Password"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Admin Layout ───────────────────────────────────────────────────────

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const { data: user, isLoading } = useFetch<UserProfile>("/api/auth/me");

  // Redirect to login if not authenticated, or if a STAFF session somehow
  // reached the backoffice (login API only issues sessions to OWNER/ADMIN/
  // MANAGER, but a stale or cross-subdomain cookie could land here).
  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.push("/login");
      return;
    }
    if (!["OWNER", "ADMIN", "MANAGER"].includes(user.role)) {
      router.push("/login?reason=role");
    }
  }, [isLoading, user, router]);

  // Block direct URL access to unauthorized pages
  useEffect(() => {
    if (!user || !pathname) return;
    // OWNER and ADMIN bypass all checks (including the home dashboard).
    if (user.role === "ADMIN" || user.role === "OWNER") return;

    // Home (/dashboard) is now gated on the Sales dashboard grant. A manager
    // without it is routed to their first accessible page; a manager with no
    // accessible page at all stays here — /dashboard remains the ultimate safe
    // harbour, so this can never become a redirect loop. (No "empty moduleAccess
    // = full access" escape: canAccess denies every gated item when moduleAccess
    // is empty, keeping direct-URL access consistent with the sidebar.)
    if (pathname === "/dashboard" || pathname === "/") {
      if (canAccess(user, DASHBOARD_HOME_MODULE)) return;
      const dest = firstAccessibleHref(user);
      if (dest) router.replace(dest);
      return;
    }

    // Match the current path to the MOST SPECIFIC (longest-href) nav item, then
    // gate on that item's module. Longest-match mirrors the sidebar's active-link
    // logic so a broad parent (e.g. the Settings "Hub") can't shadow a specific
    // sibling (e.g. /settings/staff) and wrongly bounce the user.
    let best: { href: string; moduleKey?: string } | undefined;
    for (const section of NAV_SECTIONS) {
      const allItems = [
        ...(section.items ?? []),
        ...(section.subgroups?.flatMap((sg) => sg.items) ?? []),
      ];
      for (const item of allItems) {
        if (pathname === item.href || pathname.startsWith(item.href + "/")) {
          if (!best || item.href.length > best.href.length) best = item;
        }
      }
    }
    if (best?.moduleKey && !canAccess(user, best.moduleKey)) {
      // Send them somewhere they can actually use, not a home they may not hold.
      router.replace(firstAccessibleHref(user) ?? "/dashboard");
    }
  }, [user, pathname, router]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-brand-offwhite">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-terracotta border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <SidebarProvider className="h-svh overflow-hidden print:h-auto print:overflow-visible">
      {/* Sidebar is app chrome — never printed (contents = transparent on screen). */}
      <div className="contents print:hidden">
        <AppSidebar user={user} onLogout={handleLogout} />
      </div>
      <SidebarInset className="min-w-0 bg-brand-offwhite print:overflow-visible">
        {/* Mobile-only top bar — tap the trigger to open the sidebar sheet.
            Desktop has no top chrome: the toggle lives in the sidebar header,
            plus the drag rail and ⌘B. */}
        <header className="flex items-center gap-3 border-b border-border bg-white px-4 py-3 dark:bg-card md:hidden print:hidden">
          <SidebarTrigger className="text-foreground" />
          <Image
            src="/images/celsius-logo-sm.jpg"
            alt="Celsius"
            width={24}
            height={24}
            className="rounded-md"
          />
          <span className="font-heading text-sm font-bold">Celsius Ops</span>
        </header>

        {/* Page content */}
        <PullToRefresh
          onRefresh={async () => { window.location.reload(); }}
          className="flex-1 overflow-y-auto overflow-x-hidden print:overflow-visible print:h-auto"
          disabled={pathname?.startsWith("/inventory/supplier-chats") ?? false}
        >
          {children}
        </PullToRefresh>
      </SidebarInset>
      {/* Global ⌘K palette — toggles via Cmd/Ctrl+K from anywhere */}
      <CommandPalette />
    </SidebarProvider>
  );
}
