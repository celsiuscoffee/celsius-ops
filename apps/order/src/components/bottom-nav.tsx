"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, User, Gift } from "lucide-react";
import { useCartStore } from "@/store/cart";

export function BottomNav() {
  const pathname      = usePathname();
  const selectedStore = useCartStore((s) => s.selectedStore);

  function navClass(active: boolean) {
    return `flex flex-col items-center gap-1 min-w-[56px] py-1 ${
      active ? "text-[#160800]" : "text-muted-foreground"
    }`;
  }

  const isHome    = pathname === "/";
  const isMenu    = pathname === "/menu";
  const isOrders  = pathname === "/account/orders";
  const isRewards = pathname === "/rewards";
  const isAccount = pathname === "/account";

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-white border-t px-1 py-2.5 flex justify-around z-10 shadow-[0_-1px_6px_rgba(0,0,0,0.06)]">
      <Link href="/" className={navClass(isHome)}>
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill={isHome ? "currentColor" : "none"} stroke="currentColor" strokeWidth={isHome ? "0" : "1.75"}>
          <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
        </svg>
        <span className={`text-[10px] ${isHome ? "font-bold" : "font-medium"}`}>Home</span>
      </Link>

      <Link
        href={selectedStore ? `/menu?store=${selectedStore.id}` : "/store"}
        className={navClass(isMenu)}
      >
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill={isMenu ? "currentColor" : "none"} stroke={isMenu ? "none" : "currentColor"} strokeWidth="1.75">
          {isMenu ? (
            <>
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" fill="currentColor" opacity="0.9" />
              <rect x="9" y="3" width="6" height="4" rx="1" fill="currentColor" />
            </>
          ) : (
            <>
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
              <rect x="9" y="3" width="6" height="4" rx="1" />
              <path d="M9 12h6M9 16h4" />
            </>
          )}
        </svg>
        <span className={`text-[10px] ${isMenu ? "font-bold" : "font-medium"}`}>Menu</span>
      </Link>

      <Link href="/account/orders" className={navClass(isOrders)}>
        <ClipboardList className="h-6 w-6" strokeWidth={isOrders ? 2.5 : 1.75} />
        <span className={`text-[10px] ${isOrders ? "font-bold" : "font-medium"}`}>Orders</span>
      </Link>

      <Link href="/rewards" className={navClass(isRewards)}>
        <Gift className="h-6 w-6" strokeWidth={isRewards ? 2.5 : 1.75} fill={isRewards ? "currentColor" : "none"} />
        <span className={`text-[10px] ${isRewards ? "font-bold" : "font-medium"}`}>Rewards</span>
      </Link>

      <Link href="/account" className={navClass(isAccount)}>
        <User className="h-6 w-6" strokeWidth={isAccount ? 2.5 : 1.75} fill={isAccount ? "currentColor" : "none"} />
        <span className={`text-[10px] ${isAccount ? "font-bold" : "font-medium"}`}>Account</span>
      </Link>
    </nav>
  );
}
