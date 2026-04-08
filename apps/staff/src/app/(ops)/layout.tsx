"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
/* eslint-disable @next/next/no-img-element */
import {
  LogOut,
  Menu,
  ClipboardCheck,
  History,
  ClipboardList,
  Trash2,
  ArrowLeftRight,
  Package,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFetch } from "@/lib/use-fetch";

type UserProfile = {
  id: string;
  name: string;
  role: string;
  outletId: string | null;
  outletName?: string | null;
};

type NavItem = {
  label: string;
  href: string;
  icon: React.ReactNode;
};

const ICON_SIZE = "h-4 w-4";

type NavSection = {
  label: string;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Checklists",
    items: [
      { label: "Today", href: "/checklists", icon: <ClipboardCheck className={ICON_SIZE} /> },
      { label: "History", href: "/checklists/history", icon: <History className={ICON_SIZE} /> },
    ],
  },
  {
    label: "Inventory",
    items: [
      { label: "Stock Count", href: "/stock-count", icon: <ClipboardList className={ICON_SIZE} /> },
      { label: "Receiving", href: "/receiving", icon: <Package className={ICON_SIZE} /> },
      { label: "Wastage", href: "/wastage", icon: <Trash2 className={ICON_SIZE} /> },
      { label: "Transfers", href: "/transfers", icon: <ArrowLeftRight className={ICON_SIZE} /> },
    ],
  },
];

function SidebarContent({
  user,
  pathname,
  onNavigate,
  onLogout,
}: {
  user: UserProfile | undefined;
  pathname: string;
  onNavigate?: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-brand-dark">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <img
          src="/images/celsius-logo-sm.jpg"
          alt="Celsius"
          width={32}
          height={32}
          className="rounded-lg"
        />
        <div>
          <h2 className="font-heading text-sm font-bold text-white">Celsius Staff</h2>
          <p className="text-[10px] text-white/40">Outlet Operations</p>
        </div>
      </div>

      {/* Nav */}
      <ScrollArea className="flex-1 px-3 py-3">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-3">
            <p className="mb-1.5 mt-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-white/30">
              {section.label}
            </p>
            {section.items.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors ${
                    isActive
                      ? "bg-terracotta/20 text-terracotta-light font-medium"
                      : "text-white/50 hover:bg-white/5 hover:text-white/70"
                  }`}
                >
                  {item.icon}
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </ScrollArea>

      {/* User footer */}
      {user && (
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3">
            <Avatar size="sm">
              <AvatarFallback className="bg-terracotta/20 text-terracotta-light text-xs">
                {user.name?.slice(0, 2).toUpperCase() || "U"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="truncate text-xs font-medium text-white">{user.name}</p>
              <p className="truncate text-[10px] text-white/40">{user.role}</p>
            </div>
            <button
              onClick={onLogout}
              className="rounded-md p-1.5 text-white/40 hover:bg-white/10 hover:text-white/70 transition-colors"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: user, isLoading } = useFetch<UserProfile>("/api/auth/me");

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
    }
  }, [isLoading, user, router]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-brand-offwhite">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-terracotta border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-brand-offwhite">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 lg:block">
        <SidebarContent user={user} pathname={pathname} onLogout={handleLogout} />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="relative z-10 h-full w-72">
            <SidebarContent
              user={user}
              pathname={pathname}
              onNavigate={() => setMobileOpen(false)}
              onLogout={handleLogout}
            />
          </aside>
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile header */}
        <header className="flex items-center gap-3 border-b border-border bg-white px-4 py-3 lg:hidden">
          <button onClick={() => setMobileOpen(true)} className="rounded-md p-1.5 hover:bg-muted">
            <Menu className="h-5 w-5" />
          </button>
          <img src="/images/celsius-logo-sm.jpg" alt="Celsius" width={24} height={24} className="rounded-md" />
          <span className="font-heading text-sm font-bold">Celsius Staff</span>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
