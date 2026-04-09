"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import {
  LogOut,
  ChevronRight,
  Shield,
  Loader2,
  ClipboardCheck,
  CheckCircle2,
} from "lucide-react";

type User = {
  id: string;
  name: string;
  role: string;
  outletId: string | null;
  outletName?: string | null;
};

type ChecklistSummary = {
  status: string;
};

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [todayStats, setTodayStats] = useState({ total: 0, completed: 0 });

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.id) setUser(data);
        const today = new Date().toISOString().split("T")[0];
        // For managers, show outlet checklists; for staff, show assigned only
        const isManager = ["OWNER", "ADMIN", "MANAGER"].includes(data.role);
        const params = isManager && data.outletId
          ? `date=${today}&outletId=${data.outletId}`
          : `date=${today}&mine=true`;
        return fetch(`/api/checklists?${params}`);
      })
      .then((r) => r.json())
      .then((cls: ChecklistSummary[]) => {
        if (Array.isArray(cls)) {
          setTodayStats({
            total: cls.length,
            completed: cls.filter((c) => c.status === "COMPLETED").length,
          });
        }
      })
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  const initial = user?.name?.charAt(0)?.toUpperCase() ?? "?";
  const roleLabel =
    user?.role === "OWNER" ? "Owner" :
    user?.role === "ADMIN" ? "Admin" :
    user?.role === "MANAGER" ? "Manager" : "Staff";
  const isManager = user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "OWNER";

  return (
    <div className="px-4 py-4">
      <div className="space-y-4">
        <h1 className="font-heading text-lg font-bold text-brand-dark">Profile</h1>

        {/* User info */}
        <Card className="px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-terracotta/10 text-lg font-bold text-terracotta-dark">
              {initial}
            </div>
            <div className="flex-1">
              <p className="font-semibold text-gray-900">{user?.name ?? "Loading..."}</p>
              <p className="text-sm text-gray-500">{roleLabel}</p>
              {user?.outletName && (
                <p className="text-xs text-gray-400">{user.outletName}</p>
              )}
            </div>
            {isManager && (
              <a
                href="https://backoffice.celsiuscoffee.com"
                className="flex items-center gap-1 rounded-lg bg-terracotta/10 px-2.5 py-1.5 text-xs font-medium text-terracotta-dark"
              >
                <Shield className="h-3 w-3" />
                Admin
              </a>
            )}
          </div>
        </Card>

        {/* Today's stats */}
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Today</h2>
          <div className="grid grid-cols-2 gap-2">
            <Card className="px-3 py-2.5">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-terracotta" />
                <div>
                  <p className="text-[10px] text-gray-400">Checklists</p>
                  <p className="text-base font-bold text-gray-900">{todayStats.total}</p>
                </div>
              </div>
            </Card>
            <Card className="px-3 py-2.5">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <div>
                  <p className="text-[10px] text-gray-400">Completed</p>
                  <p className="text-base font-bold text-gray-900">{todayStats.completed}</p>
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* Links */}
        {isManager && (
          <div className="space-y-1">
            <a
              href="https://backoffice.celsiuscoffee.com"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-gray-50 active:bg-gray-100"
            >
              <Shield className="h-5 w-5 text-gray-400" />
              <span className="flex-1 text-sm text-gray-700">Backoffice</span>
              <ChevronRight className="h-4 w-4 text-gray-300" />
            </a>
          </div>
        )}

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
  );
}
