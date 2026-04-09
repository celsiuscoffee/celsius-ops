"use client";

import Link from "next/link";
import { ShoppingBag, ToggleRight, BarChart2, LogOut } from "lucide-react";
import { clearSession } from "@/lib/staff-auth";
import { useRouter } from "next/navigation";

const TABS = [
  { id: "orders",       href: "/staff/kds",          label: "Orders",       Icon: ShoppingBag  },
  { id: "availability", href: "/staff/availability",  label: "Availability", Icon: ToggleRight  },
  { id: "reports",      href: "/staff/reports",       label: "Reports",      Icon: BarChart2    },
] as const;

type TabId = typeof TABS[number]["id"];

export function StaffNav({ active }: { active: TabId }) {
  const router = useRouter();

  function logout() {
    clearSession();
    router.replace("/staff/login");
  }

  return (
    <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-border/50 flex items-center z-20 safe-area-pb">
      {TABS.map(({ id, href, label, Icon }) => (
        <Link
          key={id}
          href={href}
          className={`flex-1 flex flex-col items-center py-3 gap-0.5 transition-colors ${
            active === id ? "text-[#160800]" : "text-muted-foreground/50"
          }`}
        >
          <Icon className="h-5 w-5" strokeWidth={active === id ? 2.5 : 1.8} />
          <span className={`text-[10px] font-semibold ${active === id ? "font-bold" : ""}`}>{label}</span>
        </Link>
      ))}
      <button
        onClick={logout}
        className="flex-1 flex flex-col items-center py-3 gap-0.5 text-red-400"
      >
        <LogOut className="h-5 w-5" strokeWidth={1.8} />
        <span className="text-[10px] font-semibold">Logout</span>
      </button>
    </nav>
  );
}
