"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Loader2, ScrollText, Search, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";

type LogEntry = {
  id: string;
  action: string;
  module: string;
  details: string | null;
  targetId: string | null;
  targetName: string | null;
  userName: string;
  userRole: string;
  createdAt: string;
};

const MODULE_LABELS: Record<string, string> = {
  orders: "Purchase Orders",
  receivings: "Receivings",
  invoices: "Invoices",
  products: "Products",
  suppliers: "Suppliers",
  categories: "Categories",
  menus: "Menus",
  staff: "Staff",
  branches: "Branches",
  auth: "Authentication",
  settings: "Settings",
};

const ACTION_COLORS: Record<string, string> = {
  create: "bg-green-100 text-green-700",
  update: "bg-blue-100 text-blue-700",
  delete: "bg-red-100 text-red-700",
  login: "bg-violet-100 text-violet-700",
  logout: "bg-gray-100 text-gray-600",
  approve: "bg-amber-100 text-amber-700",
  send: "bg-teal-100 text-teal-700",
  receive: "bg-indigo-100 text-indigo-700",
};

export default function SystemLogPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [moduleFilter, setModuleFilter] = useState("");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(100);

  const loadLogs = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (moduleFilter) params.set("module", moduleFilter);
    params.set("limit", String(limit));
    fetch(`/api/activity-log?${params}`)
      .then((r) => r.json())
      .then((data) => { setLogs(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadLogs(); }, [moduleFilter, limit]);

  const filtered = logs.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      l.userName.toLowerCase().includes(q) ||
      l.action.toLowerCase().includes(q) ||
      l.module.toLowerCase().includes(q) ||
      (l.targetName || "").toLowerCase().includes(q) ||
      (l.details || "").toLowerCase().includes(q)
    );
  });

  const modules = [...new Set(logs.map((l) => l.module))].sort();

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 172800000) return "Yesterday";
    return d.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  };

  const actionColor = (action: string) => {
    const key = action.toLowerCase().split("_")[0];
    return ACTION_COLORS[key] || "bg-gray-100 text-gray-600";
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">System Log</h2>
          <p className="mt-0.5 text-sm text-gray-500">Track all actions across the system</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-600"
          >
            <option value={50}>Last 50</option>
            <option value={100}>Last 100</option>
            <option value={200}>Last 200</option>
            <option value={500}>Last 500</option>
          </select>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Search logs..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-gray-400" />
          <button
            onClick={() => setModuleFilter("")}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${!moduleFilter ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
          >
            All
          </button>
          {modules.map((m) => (
            <button
              key={m}
              onClick={() => setModuleFilter(m)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${moduleFilter === m ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
            >
              {MODULE_LABELS[m] || m}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-8 flex flex-col items-center justify-center py-12 text-gray-400">
          <ScrollText className="h-10 w-10 mb-2" />
          <p className="text-sm">No activity logs yet</p>
          <p className="text-xs mt-1">Actions will appear here as users interact with the system</p>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left font-medium text-gray-500">Time</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">User</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Action</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Module</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Target</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((log) => (
                <tr key={log.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap" title={new Date(log.createdAt).toLocaleString()}>
                    {formatTime(log.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-terracotta/10 text-[10px] font-bold text-terracotta-dark">
                        {log.userName.charAt(0)}
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-900">{log.userName}</p>
                        <p className="text-[10px] text-gray-400">{log.userRole === "ADMIN" ? "Admin" : log.userRole === "BRANCH_MANAGER" ? "Manager" : "Staff"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={`text-[10px] ${actionColor(log.action)}`}>
                      {log.action.replace(/_/g, " ")}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {MODULE_LABELS[log.module] || log.module}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 font-medium">
                    {log.targetName || "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 max-w-[200px] truncate" title={log.details || ""}>
                    {log.details || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
