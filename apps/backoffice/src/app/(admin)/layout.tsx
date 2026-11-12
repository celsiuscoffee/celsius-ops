"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Lock, Eye, EyeOff, Check, Loader2 } from "lucide-react";
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from "@/components/ui/sidebar";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { CommandPalette } from "@/components/command-palette";
import { OfficeHeader, PageTabs, PhoneTabBar, Rail } from "@/components/office-shell";

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
  type UserProfile,
} from "@/lib/nav";

// Nav structure, RBAC (canAccess), and active-state helpers live in
// lib/nav.tsx — shared with the ⌘K palette's page index. This file is just
// the chrome: auth/redirect guards and the page shell (components/office-shell.tsx).

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
        className="flex w-full cursor-pointer items-center gap-2 rounded-ctl px-2 py-1.5 text-[11px] text-rail-text-2 transition-colors hover:bg-rail-2 hover:text-rail-text max-md:py-3 max-md:text-[13px]"
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
    <SidebarProvider
      className="h-svh overflow-hidden print:h-auto print:overflow-visible"
      style={{ "--sidebar-width": "236px" } as React.CSSProperties}
    >
      {/* Rail is app chrome — never printed (contents = transparent on screen). */}
      <div className="contents print:hidden">
        <Sidebar collapsible="icon" className="border-r border-rail-line">
          <Rail user={user} onLogout={handleLogout} extra={<PasswordChangeDialog hasPassword={user.hasPassword} />} />
          <SidebarRail />
        </Sidebar>
      </div>
      <SidebarInset className="min-w-0 bg-bg print:overflow-visible">
        <PullToRefresh
          onRefresh={async () => { window.location.reload(); }}
          className="flex-1 overflow-y-auto overflow-x-hidden pb-[calc(76px+env(safe-area-inset-bottom))] md:pb-0 print:overflow-visible print:h-auto print:pb-0"
          disabled={pathname?.startsWith("/inventory/supplier-chats") ?? false}
        >
          <OfficeHeader user={user} />
          <PageTabs user={user} />
          {children}
        </PullToRefresh>
        <PhoneTabBar user={user} />
      </SidebarInset>
      {/* Global ⌘K palette — toggles via Cmd/Ctrl+K, the rail's Jump to, or the phone search */}
      <CommandPalette />
    </SidebarProvider>
  );
}
