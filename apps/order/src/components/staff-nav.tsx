"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ShoppingBag, ToggleRight, BarChart2, LogOut } from "lucide-react";
import { clearSession, getSession } from "@/lib/staff-auth";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const TABS = [
  { id: "orders",       href: "/staff/kds",          label: "Orders",       Icon: ShoppingBag  },
  { id: "availability", href: "/staff/availability",  label: "Availability", Icon: ToggleRight  },
  { id: "reports",      href: "/staff/reports",       label: "Reports",      Icon: BarChart2    },
] as const;

type TabId = typeof TABS[number]["id"];

// Anything older than 7 minutes in the preparing state is "overdue"
// (matches the red-bucket threshold on the KDS card).
const OVERDUE_AFTER_SEC = 7 * 60;
const POLL_MS = 30_000;

/** Lightweight watcher used on non-Orders tabs to surface a red dot
 *  when there's an overdue order on the Orders tab. */
function useOverdueIndicator(active: TabId) {
  const [overdue, setOverdue] = useState(0);

  useEffect(() => {
    if (active === "orders") { setOverdue(0); return; }
    const session = getSession();
    if (!session) return;

    const supabase = getSupabaseClient();
    let cancelled = false;

    async function check() {
      if (!session) return;
      const cutoff = new Date(Date.now() - OVERDUE_AFTER_SEC * 1000).toISOString();
      const { count } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("store_id", session.storeId)
        .eq("status", "preparing")
        .lt("created_at", cutoff);
      if (!cancelled) setOverdue(count ?? 0);
    }

    check();
    const t = setInterval(check, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [active]);

  return overdue;
}

export function StaffNav({ active }: { active: TabId }) {
  const router = useRouter();
  const overdue = useOverdueIndicator(active);

  function logout() {
    clearSession();
    router.replace("/staff/login");
  }

  return (
    <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-border/50 flex items-center z-20 safe-area-pb">
      {TABS.map(({ id, href, label, Icon }) => {
        const isActive = active === id;
        const showDot  = id === "orders" && overdue > 0;
        return (
          <Link
            key={id}
            href={href}
            className={`flex-1 flex flex-col items-center py-3 gap-0.5 transition-colors ${
              isActive ? "text-[#160800]" : "text-muted-foreground/50"
            }`}
          >
            <span className="relative">
              <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 1.8} />
              {showDot && (
                <span className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center animate-pulse">
                  {overdue}
                </span>
              )}
            </span>
            <span className={`text-[10px] font-semibold ${isActive ? "font-bold" : ""}`}>{label}</span>
          </Link>
        );
      })}
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
