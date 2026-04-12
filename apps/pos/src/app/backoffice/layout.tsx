"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/backoffice", label: "Dashboard", icon: "📊" },
  { divider: true, label: "Products" },
  { href: "/backoffice/products", label: "Products", icon: "📦" },
  { href: "/backoffice/categories", label: "Categories", icon: "🏷️" },
  { href: "/backoffice/promotions", label: "Promotions", icon: "🎫" },
  { divider: true, label: "Operations" },
  { href: "/backoffice/staff", label: "Staff", icon: "👥" },
  { href: "/backoffice/reports", label: "Reports", icon: "📈" },
  { href: "/backoffice/table-qr", label: "Table QR Codes", icon: "📱" },
  { href: "/backoffice/settings", label: "Settings", icon: "⚙️" },
  { divider: true },
  { href: "/register", label: "POS Register", icon: "💳" },
  { href: "/kds", label: "Kitchen Display", icon: "🍳" },
];

export default function BackofficeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen bg-surface">
      <aside className="flex w-56 flex-col border-r border-border bg-surface">
        <div className="flex items-center gap-3 px-4 py-4">
          <Image src="/images/celsius-logo-sm.jpg" alt="Celsius" width={32} height={32} className="rounded-lg" />
          <div>
            <Image src="/images/celsius-wordmark-white.png" alt="Celsius Coffee" width={90} height={20} />
            <p className="text-[10px] text-text-dim">BackOffice</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-2">
          {NAV_ITEMS.map((item, i) => {
            if ("divider" in item && !item.href) {
              return (
                <div key={i} className="mt-3 mb-1">
                  {item.label && <p className="px-3 text-[9px] font-bold uppercase tracking-wider text-text-dim">{item.label}</p>}
                  {!item.label && <div className="border-t border-border" />}
                </div>
              );
            }
            const isActive = item.href === "/backoffice" ? pathname === "/backoffice" : pathname!.startsWith(item.href!);
            return (
              <Link key={item.href} href={item.href!}
                className={`mb-0.5 flex items-center gap-3 rounded-lg px-3 py-1.5 text-xs transition-colors ${isActive ? "bg-brand/15 font-medium text-brand" : "text-text-muted hover:bg-surface-hover hover:text-text"}`}>
                <span className="text-sm">{item.icon}</span>{item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border px-4 py-3">
          <p className="text-xs text-text-dim">Celsius Coffee Shah Alam</p>
          <p className="text-xs text-text-dim">Admin: Ammar</p>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
