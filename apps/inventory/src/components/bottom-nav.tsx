"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ClipboardCheck, ShoppingCart, Package, User, ArrowRightLeft, Trash2 } from "lucide-react";

type Tab = { href: string; label: string; icon: typeof Home; minRole?: string };

const allTabs: Tab[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/check", label: "Check", icon: ClipboardCheck },
  { href: "/order", label: "Order", icon: ShoppingCart, minRole: "MANAGER" },
  { href: "/receive", label: "Receive", icon: Package },
  { href: "/transfer", label: "Transfer", icon: ArrowRightLeft, minRole: "MANAGER" },
  { href: "/wastage", label: "Wastage", icon: Trash2, minRole: "MANAGER" },
  { href: "/profile", label: "Profile", icon: User },
];

const ROLE_LEVEL: Record<string, number> = {
  STAFF: 1,
  MANAGER: 2,
  ADMIN: 3,
};

export function BottomNav() {
  const pathname = usePathname();
  const [role, setRole] = useState<string>("STAFF");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => { if (d.role) setRole(d.role); })
      .catch(() => {});
  }, []);

  const userLevel = ROLE_LEVEL[role] || 1;
  const tabs = allTabs.filter((t) => {
    if (!t.minRole) return true;
    return userLevel >= (ROLE_LEVEL[t.minRole] || 1);
  });

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white">
      <div className="mx-auto flex max-w-lg items-center justify-around">
        {tabs.map((tab) => {
          const isActive = pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
                isActive
                  ? "text-terracotta"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              <Icon className={`h-5 w-5 ${isActive ? "stroke-[2.5]" : ""}`} />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
      {/* Safe area for phones with home indicator */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
