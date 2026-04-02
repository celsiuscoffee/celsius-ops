"use client";

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

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="flex w-60 flex-col border-r border-border bg-brand-dark text-brand-offwhite">
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
                    <Link key={item.href} href={item.href} className={`flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${isActive ? "bg-terracotta/20 font-medium text-terracotta-light" : "text-white/60 hover:bg-white/5 hover:text-white"}`}>
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 px-4 py-3">
          <Link href="/check" className="text-xs text-terracotta-light hover:underline">
            ← Back to App
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-gray-50">
        {children}
      </main>
    </div>
  );
}
