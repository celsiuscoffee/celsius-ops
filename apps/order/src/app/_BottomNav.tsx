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
    <Link href={href} className="flex-1 flex flex-col items-center justify-center gap-1 py-1.5 active:opacity-60">
      <Icon
        size={26}
        color={color}
        strokeWidth={active ? 2.4 : 1.75}
        fill={active ? color : "transparent"}
        fillOpacity={active ? 0.08 : 0}
      />
      <span
        className="text-[12.5px]"
        style={{ color, fontWeight: active ? 700 : 600, letterSpacing: 0.2 }}
      >
        {label}
      </span>
    </Link>
  );
}

// Celsius cup mark — same SVG geometry as apps/pickup-native/components
// /brand/CelsiusCup.tsx (Lid + tapered trapezoid body + "C" wordmark).
// Hand-authored so it sits centred in the bottom-nav puck and reads as
// the brand mark rather than a stock coffee glyph.
function CelsiusCupMark({ size = 28, color = "#FFFFFF" }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="2.5"
        y="2"
        width="19"
        height="3"
        rx="1"
        fill="transparent"
        stroke={color}
        strokeWidth={2.4}
      />
      <path
        d="M3 5.5 H21 L19.3 22 a1.5 1.5 0 0 1 -1.5 1.3 H6.2 a1.5 1.5 0 0 1 -1.5 -1.3 Z"
        fill="transparent"
        stroke={color}
        strokeWidth={2.4}
        strokeLinejoin="round"
      />
      <text
        x="12"
        y="17.5"
        fontSize="12"
        textAnchor="middle"
        fill={color}
        stroke={color}
        strokeWidth={0.6}
        fontFamily="Peachi-Bold, serif"
      >
        C
      </text>
    </svg>
  );
}

function NavMenuPuck({ href, active }: { href: string; active: boolean }) {
  return (
    <Link href={href} className="flex-1 flex flex-col items-center active:opacity-80" aria-label="Menu tab">
      <span
        className="flex items-center justify-center"
        style={{
          width: 52,
          height: 52,
          borderRadius: 26,
          marginTop: -18,
          backgroundColor: active ? "#160800" : "#8E8E93",
          border: "3px solid #FFFFFF",
          boxShadow: "0 3px 8px rgba(0,0,0,0.2)",
        }}
      >
        <CelsiusCupMark size={28} color="#FFFFFF" />
      </span>
      <span
        className="text-[12.5px]"
        style={{
          marginTop: 2,
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
