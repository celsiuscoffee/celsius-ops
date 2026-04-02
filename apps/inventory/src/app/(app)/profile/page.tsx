"use client";

import { useState, useEffect } from "react";
import { TopBar } from "@/components/top-bar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  Bell,
  FileBarChart,
  Settings,
  LogOut,
  ChevronRight,
  TrendingDown,
  AlertTriangle,
  DollarSign,
  Shield,
  Loader2,
} from "lucide-react";

type User = {
  id: string;
  name: string;
  role: string;
  branchId: string | null;
};

const QUICK_STATS = [
  { label: "COGS This Week", value: "RM 4,580", target: "Budget: RM 4,200", status: "over" as const, icon: DollarSign },
  { label: "Waste This Week", value: "RM 23.10", target: "0.5% of revenue", status: "ok" as const, icon: TrendingDown },
  { label: "Low Stock Items", value: "7", target: "Across all outlets", status: "warn" as const, icon: AlertTriangle },
];

const MENU_ITEMS = [
  { label: "Switch Branch", icon: Building2, href: "#" },
  { label: "Notifications", icon: Bell, href: "#", badge: "3" },
  { label: "Reports", icon: FileBarChart, href: "#" },
  { label: "Settings", icon: Settings, href: "#" },
];

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => { if (data.id) setUser(data); })
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  const initial = user?.name?.charAt(0)?.toUpperCase() ?? "?";
  const roleLabel = user?.role === "ADMIN" ? "Admin" : user?.role === "BRANCH_MANAGER" ? "Branch Manager" : "Staff";

  return (
    <>
      <TopBar title="Profile" />

      <div className="px-4 py-3">
        <div className="mx-auto max-w-lg space-y-4">
          {/* User info */}
          <Card className="px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-terracotta/10 text-lg font-bold text-terracotta-dark">
                {initial}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900">{user?.name ?? "Loading..."}</p>
                <p className="text-sm text-gray-500">{roleLabel}</p>
              </div>
              {user?.role === "ADMIN" && (
                <a href="/admin" className="flex items-center gap-1 rounded-lg bg-terracotta/10 px-2.5 py-1.5 text-xs font-medium text-terracotta-dark">
                  <Shield className="h-3 w-3" />
                  Admin
                </a>
              )}
            </div>
          </Card>

          {/* Quick stats */}
          <div>
            <h2 className="mb-2 text-sm font-semibold text-gray-900">This Week</h2>
            <div className="space-y-1.5">
              {QUICK_STATS.map((stat) => {
                const Icon = stat.icon;
                return (
                  <Card key={stat.label} className="px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                          stat.status === "over"
                            ? "bg-red-100 text-red-600"
                            : stat.status === "warn"
                              ? "bg-terracotta/10 text-terracotta"
                              : "bg-green-100 text-green-600"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs text-gray-500">{stat.label}</p>
                        <p className="text-sm font-semibold text-gray-900">{stat.value}</p>
                      </div>
                      <p className="text-xs text-gray-400">{stat.target}</p>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Menu */}
          <div className="space-y-1">
            {MENU_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-gray-50 active:bg-gray-100"
                >
                  <Icon className="h-5 w-5 text-gray-400" />
                  <span className="flex-1 text-sm text-gray-700">{item.label}</span>
                  {item.badge && (
                    <Badge className="bg-red-500 text-[10px]">{item.badge}</Badge>
                  )}
                  <ChevronRight className="h-4 w-4 text-gray-300" />
                </button>
              );
            })}
          </div>

          {/* Logout */}
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-red-500 hover:bg-red-50 disabled:opacity-50"
          >
            {loggingOut ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogOut className="h-5 w-5" />}
            <span className="text-sm font-medium">Log Out</span>
          </button>
        </div>
      </div>
    </>
  );
}
