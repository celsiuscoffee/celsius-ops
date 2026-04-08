"use client";

import { useState, useEffect } from "react";
import {
  RefreshCw,
  MapPin,
  Shield,
  Users,
  CheckCircle2,
  Store,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

const avatarColors = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-purple-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-indigo-500",
  "bg-teal-500",
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

interface StaffItem {
  id: string;
  name: string;
  email: string;
  role: string;
  outlet_name: string;
  outlet_ids: string[];
  is_active: boolean;
  created_at: string;
}

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/staff?brand_id=brand-celsius")
      .then((r) => r.json())
      .then((data) => {
        setStaff(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const totalStaff = staff.length;
  const activeStaff = staff.filter((s) => s.is_active).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="h-6 w-6 animate-spin text-[#C2452D]" />
          <p className="text-sm text-gray-400 dark:text-neutral-500">Loading staff...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Staff Directory
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
          Staff with loyalty portal access (read-only)
        </p>
      </div>

      {/* Banner */}
      <div className="rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/5 px-4 py-3">
        <div className="flex items-start gap-3">
          <ExternalLink className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="text-sm text-amber-800 dark:text-amber-300">
            <p className="font-medium">Staff are managed centrally from Backoffice</p>
            <p className="mt-0.5 text-amber-600 dark:text-amber-400/70">
              Go to Backoffice &rarr; Settings &rarr; Staff to add, edit, or remove staff members.
            </p>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-500/10">
              <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-neutral-400">Total Staff</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{totalStaff}</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-500/10">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-neutral-400">Active</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{activeStaff}</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-500/10">
              <Store className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-neutral-400">With Portal Access</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{totalStaff}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Staff Table */}
      <div className="rounded-2xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
        {/* Desktop */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-neutral-800 text-left">
                <th className="px-5 py-3.5 font-semibold text-gray-500 dark:text-neutral-400">Name</th>
                <th className="px-5 py-3.5 font-semibold text-gray-500 dark:text-neutral-400">Outlet</th>
                <th className="px-5 py-3.5 font-semibold text-gray-500 dark:text-neutral-400">Role</th>
                <th className="px-5 py-3.5 font-semibold text-gray-500 dark:text-neutral-400">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-neutral-800">
              {staff.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50/50 dark:hover:bg-neutral-800/50 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className={cn("flex h-9 w-9 items-center justify-center rounded-full text-white text-sm font-bold flex-shrink-0", getAvatarColor(s.name))}>
                        {s.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{s.name}</p>
                        {s.email && <p className="text-xs text-gray-400 dark:text-neutral-500">{s.email}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    {s.outlet_name ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-neutral-800 px-2 py-0.5 text-xs font-medium text-gray-700 dark:text-neutral-300">
                        <MapPin className="h-3 w-3 text-gray-400 dark:text-neutral-500" />
                        {s.outlet_name}
                      </span>
                    ) : (
                      <span className="text-gray-400 dark:text-neutral-500">—</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <span className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                      s.role === "MANAGER" || s.role === "manager"
                        ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400"
                        : s.role === "ADMIN" || s.role === "admin" || s.role === "OWNER" || s.role === "owner"
                        ? "bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400"
                        : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                    )}>
                      <Shield className="h-3 w-3" />
                      {s.role.charAt(0).toUpperCase() + s.role.slice(1).toLowerCase()}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
                      s.is_active
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                        : "bg-gray-100 text-gray-500 dark:bg-neutral-800 dark:text-neutral-500"
                    )}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", s.is_active ? "bg-emerald-500" : "bg-gray-400")} />
                      {s.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
              {staff.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center text-gray-400 dark:text-neutral-500">
                    No staff with loyalty access found. Add staff in Backoffice and enable &quot;loyalty&quot; app access.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-gray-100 dark:divide-neutral-800">
          {staff.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3">
              <div className={cn("flex h-10 w-10 items-center justify-center rounded-full text-white text-sm font-bold flex-shrink-0", getAvatarColor(s.name))}>
                {s.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 dark:text-white truncate">{s.name}</p>
                <p className="text-xs text-gray-400 dark:text-neutral-500">
                  {s.outlet_name || "No outlet"} &middot; {s.role.charAt(0).toUpperCase() + s.role.slice(1).toLowerCase()}
                </p>
              </div>
              <span className={cn("h-2 w-2 rounded-full flex-shrink-0", s.is_active ? "bg-emerald-500" : "bg-gray-400")} />
            </div>
          ))}
          {staff.length === 0 && (
            <div className="px-4 py-12 text-center text-sm text-gray-400 dark:text-neutral-500">
              No staff with loyalty access found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
