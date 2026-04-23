"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Loader2, Eye, EyeOff, Key, Lock, Hash, Check, X, Search, Trash2, RotateCcw } from "lucide-react";

type ModuleAccess = Record<string, string[]>;

type Staff = {
  id: string; name: string; role: string; outlet: string; outletId: string | null; outletCode: string;
  outletIds: string[]; outletNames: string[];
  phone: string; email: string; username: string | null;
  hasPassword: boolean; hasPin: boolean;
  status: string; addedDate: string;
  appAccess: string[];
  moduleAccess: ModuleAccess;
};

type OutletOption = { id: string; name: string };

type StaffForm = {
  name: string; role: string; outletId: string; outletIds: string[];
  phone: string; email: string;
  username: string; password: string;
  pin: string;
  appAccess: string[];
  moduleAccess: ModuleAccess;
};

const emptyForm: StaffForm = {
  name: "", role: "STAFF", outletId: "", outletIds: [],
  phone: "", email: "",
  username: "", password: "",
  pin: "",
  appAccess: [],
  moduleAccess: {},
};

// Module definitions per app
const APP_MODULES: Record<string, { label: string; key: string }[]> = {
  pickup: [
    { label: "Orders", key: "orders" },
    { label: "Menu", key: "menu" },
    { label: "Analytics", key: "analytics" },
    { label: "Customers", key: "customers" },
  ],
  inventory: [
    { label: "Products", key: "products" },
    { label: "Suppliers", key: "suppliers" },
    { label: "Categories", key: "categories" },
    { label: "Menu & BOM", key: "menus" },
    { label: "Purchase Orders", key: "orders" },
    { label: "Receivings", key: "receivings" },
    { label: "Invoices", key: "invoices" },
    { label: "Stock Count", key: "stock-count" },
    { label: "Wastage", key: "wastage" },
    { label: "Transfers", key: "transfers" },
    { label: "Par Levels", key: "par-levels" },
    { label: "Reports", key: "reports" },
  ],
  loyalty: [
    { label: "Members", key: "members" },
    { label: "Rewards", key: "rewards" },
    { label: "Redemptions", key: "redemptions" },
    { label: "Campaigns", key: "campaigns" },
    { label: "Engage", key: "engage" },
    { label: "AI Insights", key: "insights" },
  ],
  sales: [
    { label: "Dashboard", key: "dashboard" },
  ],
  settings: [
    { label: "Outlets", key: "outlets" },
    { label: "Staff & Access", key: "staff" },
    { label: "Approval Rules", key: "rules" },
    { label: "Integrations", key: "integrations" },
    { label: "System", key: "system" },
  ],
  ops: [
    { label: "SOPs", key: "sops" },
    { label: "Categories", key: "categories" },
    { label: "Checklists", key: "checklists" },
    { label: "Audit", key: "audit" },
    { label: "Dashboard", key: "dashboard" },
  ],
  hr: [
    { label: "Dashboard", key: "dashboard" },
    { label: "Attendance", key: "attendance" },
    { label: "Schedules", key: "schedules" },
    { label: "Leave", key: "leave" },
    { label: "Overtime", key: "overtime" },
    { label: "Payroll", key: "payroll" },
    { label: "Employees", key: "employees" },
    { label: "Performance", key: "performance" },
    { label: "Allowances", key: "allowances" },
    { label: "Review Penalties", key: "review-penalties" },
    { label: "Settings", key: "settings" },
  ],
};

// Optional visual groupings for the module picker. Keys map to APP_MODULES keys.
// When an app has an entry here, the picker renders grouped sections instead of a flat grid.
const MODULE_GROUPS: Record<string, { label: string; keys: string[] }[]> = {
  hr: [
    { label: "People", keys: ["dashboard", "employees"] },
    { label: "Time & Attendance", keys: ["attendance", "schedules", "overtime"] },
    { label: "Leave", keys: ["leave"] },
    { label: "Payroll & Compensation", keys: ["payroll", "allowances"] },
    { label: "Performance", keys: ["performance", "review-penalties"] },
    { label: "Admin", keys: ["settings"] },
  ],
};

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "ACTIVE" | "DEACTIVATED">("all");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [outletFilter, setOutletFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [form, setForm] = useState<StaffForm>(emptyForm);
  const [outlets, setOutlets] = useState<OutletOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [activeTab, setActiveTab] = useState<"details" | "access" | "security">("details");
  const pinLength = 6;

  const loadStaff = () => {
    fetch("/api/settings/staff")
      .then((res) => res.json())
      .then((data) => { setStaff(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    loadStaff();
    fetch("/api/settings/outlets").then((r) => r.json()).then(setOutlets);
  }, []);

  const filtered = staff.filter((s) => {
    const matchStatus = filter === "all" || s.status === filter;
    const matchSearch = !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.phone.includes(search);
    const matchRole = roleFilter === "all" || s.role === roleFilter;
    const matchOutlet = outletFilter === "all" || s.outletId === outletFilter || (s.outletIds || []).includes(outletFilter);
    return matchStatus && matchSearch && matchRole && matchOutlet;
  });

  const openAdd = () => {
    setForm(emptyForm);
    setEditingId(null);
    setEditingStaff(null);
    setActiveTab("details");
    setShowPassword(false);
    setSaveError("");
    setDialogOpen(true);
  };

  const openEdit = (s: Staff) => {
    setForm({
      name: s.name,
      role: s.role,
      outletId: s.outletId || "",
      outletIds: s.outletIds || [],
      phone: s.phone,
      email: s.email,
      username: s.username || "",
      password: "",
      pin: "",
      appAccess: s.appAccess || [],
      moduleAccess: s.moduleAccess || {},
    });
    setEditingId(s.id);
    setEditingStaff(s);
    setActiveTab("details");
    setShowPassword(false);
    setSaveError("");
    setDialogOpen(true);
  };

  const toggleOutlet = (outletId: string) => {
    setForm((prev) => ({
      ...prev,
      outletIds: prev.outletIds.includes(outletId)
        ? prev.outletIds.filter((id) => id !== outletId)
        : [...prev.outletIds, outletId],
    }));
  };

  const handleSubmit = async () => {
    if (!form.name || !form.phone) return;
    setSaving(true);
    setSaveError("");
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        phone: form.phone,
        email: form.email || null,
        role: form.role,
        outletId: form.outletId || null,
        outletIds: form.outletIds,
        username: form.username || null,
        appAccess: isOwnerOrAdmin ? ["backoffice", "inventory", "sales", "loyalty", "pickup", "ops"] : form.appAccess,
        moduleAccess: isOwnerOrAdmin ? {} : form.moduleAccess,
      };

      // Only send password if set
      if (form.password && form.password.length >= 6) {
        payload.password = form.password;
      }

      // Only send PIN if set (must match configured pinLength)
      if (form.pin && form.pin.length === pinLength) {
        payload.pin = form.pin;
      }

      const url = editingId ? `/api/settings/staff/${editingId}` : "/api/settings/staff";
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error || `Failed to save (${res.status})`);
        return;
      }
      setDialogOpen(false);
      loadStaff();
    } catch {
      setSaveError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (s: Staff) => {
    const newStatus = s.status === "ACTIVE" ? "DEACTIVATED" : "ACTIVE";
    await fetch(`/api/settings/staff/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    loadStaff();
  };

  const roleLabel = (role: string) => {
    if (role === "OWNER") return "Owner";
    if (role === "ADMIN") return "Admin";
    if (role === "MANAGER") return "Manager";
    return "Staff";
  };

  const roleColor = (role: string) => {
    if (role === "OWNER") return "border-amber-500 text-amber-600";
    if (role === "ADMIN") return "border-terracotta text-terracotta";
    if (role === "MANAGER") return "border-blue-500 text-blue-600";
    return "border-gray-300 text-gray-500";
  };

  const isAdminOrManager = form.role === "OWNER" || form.role === "ADMIN" || form.role === "MANAGER";

  const availableApps = ["backoffice", "inventory", "sales", "loyalty", "pickup", "ops"] as const;
  const appLabel: Record<string, string> = { backoffice: "BO", inventory: "INV", sales: "SALES", loyalty: "LOY", pickup: "PU", ops: "OPS" };
  const appColor: Record<string, string> = {
    backoffice: "bg-slate-100 text-slate-600",
    inventory: "bg-emerald-50 text-emerald-600",
    sales: "bg-blue-50 text-blue-600",
    loyalty: "bg-purple-50 text-purple-600",
    pickup: "bg-orange-50 text-orange-600",
    ops: "bg-terracotta/10 text-terracotta",
  };
  const isOwnerOrAdmin = form.role === "OWNER" || form.role === "ADMIN";

  const toggleAppAccess = (app: string) => {
    setForm((prev) => ({
      ...prev,
      appAccess: prev.appAccess.includes(app)
        ? prev.appAccess.filter((a) => a !== app)
        : [...prev.appAccess, app],
    }));
  };

  const toggleModule = (app: string, mod: string) => {
    setForm((prev) => {
      const current = prev.moduleAccess[app] || [];
      const updated = current.includes(mod)
        ? current.filter((m) => m !== mod)
        : [...current, mod];
      return {
        ...prev,
        moduleAccess: { ...prev.moduleAccess, [app]: updated },
      };
    });
  };

  const toggleAllModules = (app: string) => {
    const modules = APP_MODULES[app] || [];
    const current = form.moduleAccess[app] || [];
    const allSelected = modules.every((m) => current.includes(m.key));
    setForm((prev) => ({
      ...prev,
      moduleAccess: {
        ...prev.moduleAccess,
        [app]: allSelected ? [] : modules.map((m) => m.key),
      },
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Staff</h2>
          <p className="mt-0.5 text-sm text-gray-500">{filtered.length === staff.length ? staff.length : `${filtered.length} of ${staff.length}`} members across {new Set(staff.map((s) => s.outlet).filter(Boolean)).size} locations</p>
        </div>
        <Button onClick={openAdd} className="bg-terracotta hover:bg-terracotta-dark"><Plus className="mr-1.5 h-4 w-4" />Add User</Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Search by name or phone..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 outline-none focus:border-terracotta">
          <option value="all">All Roles</option>
          <option value="OWNER">Owner</option>
          <option value="ADMIN">Admin</option>
          <option value="MANAGER">Manager</option>
          <option value="STAFF">Staff</option>
        </select>
        <select value={outletFilter} onChange={(e) => setOutletFilter(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 outline-none focus:border-terracotta">
          <option value="all">All Outlets</option>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <div className="flex gap-1.5">
          {(["all", "ACTIVE", "DEACTIVATED"] as const).map((t) => (
            <button key={t} onClick={() => setFilter(t)} className={`rounded-full border px-3 py-1 text-xs capitalize transition-colors ${filter === t ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500"}`}>
              {t === "all" ? "All" : t.toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left font-medium text-gray-500">User</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Role</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Outlet Access</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Apps</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Phone</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Login</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-terracotta/10 text-xs font-bold text-terracotta-dark">{s.name.charAt(0)}</div>
                    <div>
                      <p className="font-medium text-gray-900">{s.name}</p>
                      {s.username && <p className="text-[10px] text-gray-400">@{s.username}</p>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className={`text-[10px] ${roleColor(s.role)}`}>{roleLabel(s.role)}</Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {s.outlet && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">{s.outlet}</span>}
                    {s.outletNames.filter((n) => n !== s.outlet).map((name) => (
                      <span key={name} className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">{name}</span>
                    ))}
                    {!s.outlet && s.outletNames.length === 0 && <span className="text-xs text-gray-400">All outlets</span>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {(s.role === "OWNER" || s.role === "ADMIN"
                      ? ["backoffice", "inventory", "sales", "loyalty", "pickup", "ops"]
                      : (s.appAccess || [])
                    ).map((app) => (
                      <span key={app} className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${appColor[app] || "bg-gray-100 text-gray-500"}`}>
                        {appLabel[app] || app}
                      </span>
                    ))}
                    {s.role !== "OWNER" && s.role !== "ADMIN" && (!s.appAccess || s.appAccess.length === 0) && (
                      <span className="text-[10px] text-gray-300">None</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{s.phone || "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    {s.hasPassword && (
                      <span className="flex items-center gap-0.5 rounded bg-green-50 px-1.5 py-0.5 text-[10px] text-green-600">
                        <Lock className="h-2.5 w-2.5" />Password
                      </span>
                    )}
                    {s.hasPin && (
                      <span className="flex items-center gap-0.5 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-600">
                        <Hash className="h-2.5 w-2.5" />PIN
                      </span>
                    )}
                    {!s.hasPassword && !s.hasPin && <span className="text-[10px] text-gray-300">No login</span>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => toggleStatus(s)} className="cursor-pointer">
                    <Badge variant="outline" className={`text-[10px] ${s.status === "ACTIVE" ? "border-green-300 text-green-600" : "border-gray-300 text-gray-400"}`}>
                      {s.status === "ACTIVE" ? "Active" : "Inactive"}
                    </Badge>
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openEdit(s)}>Edit</Button>
                    {s.status === "ACTIVE" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 w-7 p-0 text-red-400 border-red-200 hover:bg-red-50 hover:text-red-600 hover:border-red-300"
                        title="Deactivate staff"
                        onClick={() => {
                          if (!confirm(`Deactivate ${s.name}? They will lose all access.`)) return;
                          fetch(`/api/settings/staff/${s.id}`, { method: "DELETE" }).then(() => loadStaff());
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 w-7 p-0 text-green-500 border-green-200 hover:bg-green-50 hover:text-green-600 hover:border-green-300"
                        title="Reactivate staff"
                        onClick={() => {
                          fetch(`/api/settings/staff/${s.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ status: "ACTIVE" }),
                          }).then(() => loadStaff());
                        }}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Staff Edit/Add Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? "Edit Staff" : "Add Staff Member"}</DialogTitle></DialogHeader>

          {/* Tabs */}
          <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
            {(["details", "access", "security"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${activeTab === tab ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
              >
                {tab === "details" ? "Details" : tab === "access" ? "Access" : "Login & Security"}
              </button>
            ))}
          </div>

          {/* Tab: Details */}
          {activeTab === "details" && (
            <div className="grid gap-4 py-2">
              <div>
                <label className="text-sm font-medium">Name</label>
                <Input className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Role</label>
                  <select className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                    <option value="OWNER">Owner</option>
                    <option value="ADMIN">Company Admin</option>
                    <option value="MANAGER">Manager</option>
                    <option value="STAFF">Staff</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">Primary Outlet</label>
                  <select className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm" value={form.outletId} onChange={(e) => setForm({ ...form, outletId: e.target.value })}>
                    <option value="">None (Company)</option>
                    {outlets.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm font-medium">Phone</label><Input className="mt-1" placeholder="+60..." value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div><label className="text-sm font-medium">Email</label><Input className="mt-1" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              </div>
            </div>
          )}

          {/* Tab: Access */}
          {activeTab === "access" && (
            <div className="py-2">
              {/* App Access */}
              <div className="mb-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-1">App Access</h3>
                <p className="text-xs text-gray-400 mb-3">
                  {isOwnerOrAdmin ? "Owner and Admin roles have full access to all apps." : "Select which apps this user can access."}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {availableApps.map((app) => {
                    const isSelected = isOwnerOrAdmin || form.appAccess.includes(app);
                    return (
                      <button
                        key={app}
                        onClick={() => { if (!isOwnerOrAdmin) toggleAppAccess(app); }}
                        disabled={isOwnerOrAdmin}
                        className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                          isSelected
                            ? "border-terracotta/30 bg-terracotta/5"
                            : "border-gray-200 hover:bg-gray-50"
                        } ${isOwnerOrAdmin ? "cursor-default opacity-75" : "cursor-pointer"}`}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`flex h-5 w-5 items-center justify-center rounded ${isSelected ? "bg-terracotta text-white" : "border border-gray-300"}`}>
                            {isSelected && <Check className="h-3 w-3" />}
                          </div>
                          <span className={`capitalize ${isSelected ? "font-medium text-gray-900" : "text-gray-600"}`}>{app}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Module Access — per-app toggles */}
              {!isOwnerOrAdmin && form.appAccess.length > 0 && (
                <div className="mb-5">
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">Module Access</h3>
                  <p className="text-xs text-gray-400 mb-3">Control which modules this user can see within each app. Empty = full access.</p>
                  <div className="space-y-4">
                    {[...form.appAccess.filter((app) => APP_MODULES[app]), ...(form.appAccess.includes("backoffice") ? ["settings", "hr"].filter((a) => APP_MODULES[a]) : [])].map((app) => {
                      const modules = APP_MODULES[app];
                      const selected = form.moduleAccess[app] || [];
                      const allSelected = modules.every((m) => selected.includes(m.key));
                      const noneSelected = selected.length === 0;
                      const groups = MODULE_GROUPS[app];
                      const modByKey = new Map(modules.map((m) => [m.key, m]));
                      const renderToggle = (mod: { key: string; label: string }) => {
                        const isOn = selected.includes(mod.key);
                        return (
                          <button
                            key={mod.key}
                            type="button"
                            onClick={() => toggleModule(app, mod.key)}
                            className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                              isOn
                                ? "bg-terracotta/5 text-gray-900"
                                : "text-gray-400 hover:bg-gray-50"
                            }`}
                          >
                            <div className={`flex h-4 w-4 items-center justify-center rounded ${isOn ? "bg-terracotta text-white" : "border border-gray-300"}`}>
                              {isOn && <Check className="h-2.5 w-2.5" />}
                            </div>
                            {mod.label}
                          </button>
                        );
                      };
                      return (
                        <div key={app} className="rounded-lg border border-gray-200 p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">{app}</span>
                            <button
                              type="button"
                              onClick={() => toggleAllModules(app)}
                              className="text-[10px] text-terracotta hover:underline"
                            >
                              {allSelected ? "Deselect all" : noneSelected ? "Full access (no restriction)" : "Select all"}
                            </button>
                          </div>
                          {noneSelected && (
                            <p className="text-[10px] text-gray-400 mb-2 italic">No restrictions — full access to all modules</p>
                          )}
                          {groups ? (
                            <div className="space-y-2">
                              {groups.map((g) => {
                                const groupMods = g.keys.map((k) => modByKey.get(k)).filter((m): m is { key: string; label: string } => !!m);
                                if (groupMods.length === 0) return null;
                                return (
                                  <div key={g.label}>
                                    <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400 mb-1">{g.label}</p>
                                    <div className="grid grid-cols-2 gap-1">
                                      {groupMods.map(renderToggle)}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-1">
                              {modules.map(renderToggle)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Outlet Access */}
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Outlet Access</h3>
              <p className="text-sm text-gray-500 mb-3">Select which outlets this user can access. Primary outlet is always included.</p>
              <div className="space-y-1.5">
                {outlets.map((b) => {
                  const isPrimary = form.outletId === b.id;
                  const isSelected = isPrimary || form.outletIds.includes(b.id);
                  return (
                    <button
                      key={b.id}
                      onClick={() => { if (!isPrimary) toggleOutlet(b.id); }}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                        isSelected
                          ? "border-terracotta/30 bg-terracotta/5"
                          : "border-gray-200 hover:bg-gray-50"
                      } ${isPrimary ? "cursor-default" : "cursor-pointer"}`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`flex h-5 w-5 items-center justify-center rounded ${isSelected ? "bg-terracotta text-white" : "border border-gray-300"}`}>
                          {isSelected && <Check className="h-3 w-3" />}
                        </div>
                        <span className={isSelected ? "font-medium text-gray-900" : "text-gray-600"}>{b.name}</span>
                      </div>
                      {isPrimary && <span className="text-[10px] text-terracotta font-medium">Primary</span>}
                    </button>
                  );
                })}
              </div>
              {outlets.length === 0 && <p className="py-4 text-center text-sm text-gray-400">No outlets found</p>}
            </div>
          )}

          {/* Tab: Login & Security */}
          {activeTab === "security" && (
            <div className="grid gap-5 py-2">
              {/* Username & Password — for Admin/Manager */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Key className="h-4 w-4 text-gray-400" />
                  <h3 className="text-sm font-semibold text-gray-900">Username & Password</h3>
                  {!isAdminOrManager && <span className="text-[10px] text-gray-400">(Admin/Manager only)</span>}
                </div>
                {isAdminOrManager ? (
                  <div className="grid gap-3">
                    <div>
                      <label className="text-xs text-gray-500">Username</label>
                      <Input
                        className="mt-1"
                        placeholder="e.g. admin.ammar"
                        value={form.username}
                        onChange={(e) => setForm({ ...form, username: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">
                        {editingStaff?.hasPassword ? "New Password (leave blank to keep)" : "Set Password"}
                      </label>
                      <div className="relative mt-1">
                        <Input
                          type={showPassword ? "text" : "password"}
                          placeholder={editingStaff?.hasPassword ? "Leave blank to keep current" : "Min 6 characters"}
                          value={form.password}
                          onChange={(e) => setForm({ ...form, password: e.target.value })}
                          className="pr-9"
                        />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2.5 top-2 text-gray-400">
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      {form.password && form.password.length > 0 && form.password.length < 6 && (
                        <p className="mt-1 text-[10px] text-red-500">Min 6 characters</p>
                      )}
                    </div>
                    {editingStaff?.hasPassword && (
                      <p className="flex items-center gap-1 text-[10px] text-green-600">
                        <Check className="h-3 w-3" />Password is set
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="rounded-lg bg-gray-50 px-3 py-2.5 text-xs text-gray-400">
                    Change role to Admin or Manager to enable username/password login.
                  </p>
                )}
              </div>

              <div className="border-t border-gray-100" />

              {/* PIN — for all staff */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Hash className="h-4 w-4 text-gray-400" />
                  <h3 className="text-sm font-semibold text-gray-900">PIN Code</h3>
                  <span className="text-[10px] text-gray-400">(Quick outlet login)</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex gap-1.5">
                    {Array.from({ length: pinLength }).map((_, i) => (
                      <input
                        key={i}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={form.pin[i] || ""}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, "");
                          const newPin = form.pin.split("");
                          newPin[i] = val;
                          const joined = newPin.join("").slice(0, pinLength);
                          setForm({ ...form, pin: joined });
                          // Auto-advance
                          if (val && i < pinLength - 1) {
                            const next = e.target.parentElement?.children[i + 1] as HTMLInputElement;
                            next?.focus();
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Backspace" && !form.pin[i] && i > 0) {
                            const prev = (e.target as HTMLElement).parentElement?.children[i - 1] as HTMLInputElement;
                            prev?.focus();
                          }
                        }}
                        className="h-10 w-10 rounded-lg border border-gray-200 text-center text-lg font-bold text-gray-900 focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta/30"
                      />
                    ))}
                  </div>
                  <div className="flex-1">
                    {editingStaff?.hasPin && !form.pin && (
                      <p className="flex items-center gap-1 text-[10px] text-green-600">
                        <Check className="h-3 w-3" />PIN is set
                      </p>
                    )}
                    {form.pin && form.pin.length === pinLength && (
                      <p className="flex items-center gap-1 text-[10px] text-blue-600">
                        <Key className="h-3 w-3" />New PIN will be saved
                      </p>
                    )}
                    {form.pin.length > 0 && (
                      <button onClick={() => setForm({ ...form, pin: "" })} className="mt-0.5 flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-red-500">
                        <X className="h-2.5 w-2.5" />Clear
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-[10px] text-gray-400">{pinLength}-digit PIN for staff login at inventory &amp; rewards portal.</p>
              </div>
            </div>
          )}

          {saveError && <p className="text-xs text-red-500 px-1">{saveError}</p>}
          <DialogFooter className="flex !justify-between">
            {editingId && editingStaff ? (
              <Button
                variant="outline"
                className="text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600"
                onClick={async () => {
                  if (!confirm(`Deactivate ${editingStaff.name}? They will lose access.`)) return;
                  await fetch(`/api/settings/staff/${editingId}`, { method: "DELETE" });
                  setDialogOpen(false);
                  loadStaff();
                }}
              >
                <X className="mr-1 h-3.5 w-3.5" />Deactivate
              </Button>
            ) : <div />}
            <Button onClick={handleSubmit} disabled={saving || !form.name || !form.phone} className="bg-terracotta hover:bg-terracotta-dark disabled:opacity-50">
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {editingId ? "Save Changes" : "Add Staff"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
