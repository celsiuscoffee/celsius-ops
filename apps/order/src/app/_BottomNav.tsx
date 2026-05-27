import Link from "next/link";
import { Home, Gift, ClipboardList, User } from "lucide-react";

/**
 * Persistent BottomNav for the customer-facing Next.js routes. Each
 * page passes the active tab so the corresponding label/icon weight
 * gets the espresso-on-grey treatment matching apps/pickup-native/
 * components/BottomNav.tsx.
 *
 * Inner SPA routes (the ones whose Next.js page hasn't shipped yet)
 * still render <BottomNav> from the SPA when active there — for now
 * the two implementations coexist. Once every customer route is a
 * Next.js page, the SPA's BottomNav can go.
 */
type Tab = "home" | "rewards" | "menu" | "orders" | "account";

export function BottomNav({ active }: { active: Tab }) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#EBE5DE] flex items-stretch z-20"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="Primary"
    >
      <NavTab href="/" label="Home" Icon={Home} active={active === "home"} />
      <NavTab href="/rewards" label="Rewards" Icon={Gift} active={active === "rewards"} />
      <NavMenuPuck href="/menu" active={active === "menu"} />
      <NavTab href="/orders" label="Orders" Icon={ClipboardList} active={active === "orders"} />
      <NavTab href="/account" label="Account" Icon={User} active={active === "account"} />
    </nav>
  );
}

function NavTab({
  href,
  label,
  Icon,
  active,
}: {
  href: string;
  label: string;
  Icon: typeof Home;
  active: boolean;
}) {
  const color = active ? "#160800" : "#8E8E93";
  return (
    <Link href={href} className="flex-1 flex flex-col items-center justify-center gap-1 py-2 active:opacity-60">
      <Icon size={24} color={color} strokeWidth={active ? 2.4 : 1.75} />
      <span
        className="text-[12.5px]"
        style={{ color, fontWeight: active ? 700 : 600, letterSpacing: 0.2 }}
      >
        {label}
      </span>
    </Link>
  );
}

function NavMenuPuck({ href, active }: { href: string; active: boolean }) {
  return (
    <Link href={href} className="flex-1 flex flex-col items-center active:opacity-80" aria-label="Menu tab">
      <span
        className="-mt-4 flex items-center justify-center"
        style={{
          width: 52,
          height: 52,
          borderRadius: 26,
          backgroundColor: active ? "#160800" : "#8E8E93",
          border: "3px solid #FFFFFF",
          boxShadow: "0 3px 8px rgba(0,0,0,0.2)",
        }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 3h12l-1 9a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4z" />
          <path d="M9 21h6" />
          <path d="M12 17v4" />
        </svg>
      </span>
      <span
        className="text-[12.5px] mt-0.5"
        style={{
          color: active ? "#160800" : "#8E8E93",
          fontWeight: active ? 700 : 600,
          letterSpacing: 0.2,
        }}
      >
        Menu
      </span>
    </Link>
  );
}
