"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ClipboardCheck, Package, User, ClipboardList } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type Tab = { href: string; label: string; icon: typeof Home };
type UserProfile = { id: string; name: string; role: string; moduleAccess?: Record<string, boolean> };

const baseTabs: Tab[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/checklists", label: "Checklists", icon: ClipboardCheck },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/profile", label: "Profile", icon: User },
];

const auditTab: Tab = { href: "/audit", label: "Audit", icon: ClipboardList };

export function BottomNav() {
  const pathname = usePathname();
  const { data: me } = useFetch<UserProfile>("/api/auth/me");

  // Show audit tab if user has audit access in moduleAccess or is OWNER/ADMIN
  // moduleAccess format: { ops: ["audit", "sops", ...] } or { audit: true }
  const ma = me?.moduleAccess as Record<string, unknown> | undefined;
  const hasAuditAccess =
    me?.role === "OWNER" ||
    me?.role === "ADMIN" ||
    (ma && (
      ma.audit === true ||
      Array.isArray(ma.audit) ||
      (Array.isArray(ma.ops) && (ma.ops as string[]).includes("audit"))
    ));

  const tabs = hasAuditAccess
    ? [baseTabs[0], baseTabs[1], auditTab, baseTabs[2], baseTabs[3]]
    : baseTabs;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
      <div className="mx-auto flex max-w-lg items-center justify-around">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href || pathname.startsWith(tab.href + "/")
            || (tab.href === "/inventory" && (pathname === "/claims" || pathname.startsWith("/claims/")));
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-1 flex-col items-center gap-1 py-3 text-[11px] font-medium transition-colors active:scale-95 ${
                isActive
                  ? "text-terracotta"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              <Icon className={`h-6 w-6 ${isActive ? "stroke-[2.5]" : ""}`} />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
