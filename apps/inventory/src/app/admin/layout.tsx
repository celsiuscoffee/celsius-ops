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
  Users,
  Coffee,
  ShieldCheck,
  FileText,
  FileBarChart,
  ArrowRightLeft,
  Plug,
  ShoppingCart,
  TrendingDown,
  LogOut,
  Loader2,
  Menu,
  X,
  Gift,
  UserCheck,
  RotateCcw,
  Megaphone,
  MessageSquare,
  Sparkles,
  ScrollText,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; adminOnly?: boolean; module?: string };
type NavSection = { label: string; items: NavItem[]; adminOnly?: boolean; module?: string };

const sidebarSections: NavSection[] = [
  {
    label: "Overview",
    module: "dashboard",
    items: [
      { href: "/admin", label: "Dashboard", icon: LayoutDashboard, module: "dashboard" },
    ],
  },
  {
    label: "Inventory",
    adminOnly: true,
    module: "master_data",
    items: [
      { href: "/admin/products", label: "Products", icon: Package, module: "master_data" },
      { href: "/admin/suppliers", label: "Suppliers", icon: Truck, module: "master_data" },
      { href: "/admin/categories", label: "Categories", icon: Tags, module: "master_data" },
      { href: "/admin/menus", label: "Menu & BOM", icon: Coffee, module: "master_data" },
    ],
  },
  {
    label: "Procurement",
    module: "ordering",
    items: [
      { href: "/admin/orders", label: "Purchase Orders", icon: ShoppingCart, module: "ordering" },
      { href: "/admin/receivings", label: "Receivings", icon: ArrowRightLeft, module: "ordering" },
      { href: "/admin/invoices", label: "Invoices", icon: FileText, module: "ordering" },
    ],
  },
  {
    label: "Stock",
    items: [
      { href: "/admin/transfers", label: "Transfers", icon: ArrowRightLeft },
      { href: "/admin/par-levels", label: "Par Levels", icon: TrendingDown, adminOnly: true, module: "par_levels" },
      { href: "/admin/reports/stock-valuation", label: "Stock Valuation", icon: FileBarChart, adminOnly: true, module: "reports" },
    ],
  },
  {
    label: "Loyalty",
    items: [
      { href: "/admin/loyalty/members", label: "Members", icon: UserCheck },
      { href: "/admin/loyalty/rewards", label: "Rewards", icon: Gift },
      { href: "/admin/loyalty/redemptions", label: "Redemptions", icon: RotateCcw },
      { href: "/admin/loyalty/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/admin/loyalty/engage", label: "Engage", icon: MessageSquare },
      { href: "/admin/loyalty/insights", label: "AI Insights", icon: Sparkles, adminOnly: true },
    ],
  },
  {
    label: "Operations",
    adminOnly: true,
    items: [
      { href: "/admin/outlets", label: "Outlets", icon: Building2, module: "staff" },
      { href: "/admin/staff", label: "Staff & Access", icon: Users, adminOnly: true, module: "staff" },
      { href: "/admin/rules", label: "Approval Rules", icon: ShieldCheck, adminOnly: true, module: "approval_rules" },
    ],
  },
  {
    label: "Integrations",
    adminOnly: true,
    module: "integrations",
    items: [
      { href: "/admin/integrations", label: "StoreHub & Bukku", icon: Plug, module: "integrations" },
    ],
  },
  {
    label: "Analytics",
    module: "reports",
    items: [
      { href: "/admin/reports", label: "Reports", icon: FileBarChart, module: "reports" },
    ],
  },
  {
    label: "System",
    adminOnly: true,
    items: [
      { href: "/admin/system-log", label: "System Log", icon: ScrollText, adminOnly: true },
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
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [loggingOut, setLoggingOut] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isAdmin = userRole === "OWNER" || userRole === "ADMIN";
  const roleLoaded = userRole !== null;

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.name) setUserName(d.name);
        if (d.role) setUserRole(d.role);
        if (d.permissions) setUserPermissions(d.permissions);
      })
      .catch(() => {});
  }, []);

  const hasModule = (mod?: string) => {
    if (isAdmin) return true;
    if (!mod) return true;
    return userPermissions.includes(mod);
  };

  // Filter sidebar based on role + permissions
  const visibleSections = sidebarSections
    .filter((s) => (!s.adminOnly || isAdmin) && hasModule(s.module))
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => (!i.adminOnly || isAdmin) && hasModule(i.module)),
    }))
    .filter((s) => s.items.length > 0);

  const handleLogout = async () => {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/staff";
  };

  return (
    <div className="flex h-screen">
      {/* Mobile header */}
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center gap-3 border-b border-border bg-brand-dark px-4 py-3 md:hidden">
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-white/70 hover:text-white">
          {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <h1 className="font-heading text-sm font-bold text-white">Celsius Ops</h1>
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
              <h1 className="font-heading text-base font-bold text-white">Celsius Ops</h1>
              <p className="text-[10px] text-white/50">Backoffice</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {!roleLoaded && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-white/30" />
            </div>
          )}
          {roleLoaded && visibleSections.map((section) => (
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
                <p className="text-[10px] text-white/40">{userRole === "OWNER" ? "Owner" : userRole === "ADMIN" ? "Admin" : userRole === "MANAGER" ? "Manager" : "Staff"}</p>
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
