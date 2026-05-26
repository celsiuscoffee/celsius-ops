"use client";

import { usePOS } from "@/lib/pos-context";
import { displayRM } from "@/types/database";
import { format } from "date-fns";
import {
  CreditCard,
  ClipboardList,
  Receipt,
  BarChart3,
  Settings,
  Briefcase,
  LogOut,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (page: string) => void;
  activePage: string;
};

export function POSSidebar({ isOpen, onClose, onNavigate, activePage }: Props) {
  const { staff, outlet, register, currentShift, isShiftOpen, openOrders, completedOrders, logout } = usePOS();

  if (!isOpen) return null;

  const completedCount = completedOrders.filter((o) => o.status === "completed").length;
  const totalSales = completedOrders
    .filter((o) => o.status === "completed")
    .reduce((sum, o) => sum + o.total, 0);

  const navItems: { id: string; label: string; Icon: LucideIcon; badge: number | null }[] = [
    { id: "register",     label: "Register",      Icon: CreditCard,    badge: null },
    { id: "orders",       label: "Open Orders",   Icon: ClipboardList, badge: openOrders.length > 0 ? openOrders.length : null },
    { id: "transactions", label: "Transactions",  Icon: Receipt,       badge: completedCount > 0 ? completedCount : null },
    { id: "shift",        label: "Shift Report",  Icon: BarChart3,     badge: null },
    { id: "settings",     label: "Settings",      Icon: Settings,      badge: null },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
      />

      {/* Sidebar */}
      <div className="fixed inset-y-0 left-0 z-50 w-72 bg-surface shadow-2xl">
        {/* Header */}
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <img
              src="/images/celsius-logo-sm.jpg"
              alt="Celsius"
              width={36}
              height={36}
              className="rounded-lg"
            />
            <div>
              <p className="text-sm font-semibold">{outlet?.name ?? "—"}</p>
              <p className="text-xs text-text-muted">{register?.name ?? "—"}</p>
            </div>
          </div>
          {staff && (
            <div className="mt-3 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
                {staff.name.charAt(0)}
              </div>
              <div>
                <p className="text-xs font-medium">{staff.name}</p>
                <p className="text-[10px] capitalize text-text-dim">{staff.role}</p>
              </div>
            </div>
          )}
        </div>

        {/* Shift status */}
        <div className="border-b border-border px-5 py-3">
          {isShiftOpen && currentShift ? (
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-success" />
                <span className="text-xs font-medium text-success">Shift Open</span>
              </div>
              <p className="mt-1 text-xs text-text-muted">
                Since {format(new Date(currentShift.opened_at), "h:mm a")}
              </p>
              <div className="mt-2 flex justify-between text-xs">
                <span className="text-text-muted">Sales</span>
                <span className="font-medium">{displayRM(totalSales)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-muted">Orders</span>
                <span className="font-medium">{completedCount}</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-danger" />
              <span className="text-xs font-medium text-danger">No Active Shift</span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-3">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onNavigate(item.id);
                onClose();
              }}
              className={`mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors ${
                activePage === item.id
                  ? "bg-brand/15 font-medium text-brand"
                  : "text-text-muted hover:bg-surface-hover hover:text-text"
              }`}
            >
              <div className="flex items-center gap-3">
                <item.Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[10px] font-bold text-white">
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Bottom actions */}
        <div className="border-t border-border px-3 py-3">
          {/* BackOffice opens the unified backoffice (products, staff,
              rewards live there now). External target so a kiosk POS doesn't
              navigate away from the register. */}
          <a
            href="https://backoffice.celsiuscoffee.com"
            target="_blank"
            rel="noopener noreferrer"
            className="mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-muted hover:bg-surface-hover hover:text-text"
          >
            <Briefcase className="h-4 w-4" />
            <span className="flex-1 text-left">BackOffice</span>
            <ArrowUpRight className="h-3 w-3 text-text-dim" />
          </a>
          <button
            onClick={() => {
              logout();
              window.location.href = "/login";
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-danger hover:bg-danger/10"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </>
  );
}
