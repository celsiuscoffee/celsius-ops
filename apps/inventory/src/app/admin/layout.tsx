"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Package,
  Truck,
  Tags,
  LayoutDashboard,
  Building2,
  Settings,
  Users,
  Coffee,
  ShieldCheck,
  FileText,
  CreditCard,
  DollarSign,
  FileBarChart,
  ArrowRightLeft,
  Plug,
  ShoppingCart,
  TrendingDown,
  LogOut,
  Loader2,
  Menu,
  X,
} from "lucide-react";

const sidebarSections = [
  {
    label: "Overview",
    items: [
      { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Master Data",
    items: [
      { href: "/admin/products", label: "Products", icon: Package },
      { href: "/admin/suppliers", label: "Suppliers", icon: Truck },
      { href: "/admin/categories", label: "Categories", icon: Tags },
      { href: "/admin/menus", label: "Menu & BOM", icon: Coffee },
    ],
  },
  {
    label: "Ordering",
    items: [
      { href: "/admin/orders", label: "Purchase Orders", icon: ShoppingCart },
      { href: "/admin/receivings", label: "Receivings", icon: ArrowRightLeft },
      { href: "/admin/invoices", label: "Invoices", icon: FileText },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/admin/branches", label: "Branches", icon: Building2 },
      { href: "/admin/staff", label: "Staff", icon: Users },
      { href: "/admin/rules", label: "Approval Rules", icon: ShieldCheck },
      { href: "/admin/par-levels", label: "Par Levels", icon: TrendingDown },
    ],
  },
  {
    label: "Integrations",
    items: [
      { href: "/admin/integrations", label: "StoreHub & Bukku", icon: Plug },
    ],
  },
  {
    label: "Analytics",
    items: [
      { href: "/admin/reports", label: "Reports", icon: FileBarChart },
    ],
  },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [userName, setUserName] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => { if (d.name) setUserName(d.name); })
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <div className="flex h-screen">
      {/* Mobile header */}
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center gap-3 border-b border-border bg-brand-dark px-4 py-3 md:hidden">
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-white/70 hover:text-white">
          {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <h1 className="font-heading text-sm font-bold text-white">Celsius Inventory</h1>
      </div>

      {/* Sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-brand-dark text-brand-offwhite transition-transform md:static md:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} mt-12 md:mt-0`}>
        <div className="border-b border-white/10 px-4 py-4">
          <div className="flex items-center gap-2.5">
            <Image
              src="/images/celsius-logo-sm.jpg"
              alt="Celsius Coffee"
              width={28}
              height={28}
              className="rounded-md"
            />
            <div>
              <h1 className="font-heading text-base font-bold text-white">Celsius Inventory</h1>
              <p className="text-[10px] text-white/50">Admin Panel</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {sidebarSections.map((section) => (
            <div key={section.label} className="mb-3">
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-white/30">{section.label}</p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <Link key={item.href} href={item.href} onClick={() => setSidebarOpen(false)} className={`flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${isActive ? "bg-terracotta/20 font-medium text-terracotta-light" : "text-white/60 hover:bg-white/5 hover:text-white"}`}>
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 px-4 py-3 space-y-2">
          {userName && (
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-terracotta/20 text-xs font-bold text-terracotta-light">
                {userName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white/80 truncate">{userName}</p>
                <p className="text-[10px] text-white/40">Admin</p>
              </div>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white/70"
                title="Log out"
              >
                {loggingOut ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
              </button>
            </div>
          )}
          <Link href="/home" className="block text-xs text-terracotta-light hover:underline">
            ← Back to App
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-gray-50 pt-12 md:pt-0">
        {children}
      </main>
    </div>
  );
}
