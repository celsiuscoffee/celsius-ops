"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Loader2, Eye, EyeOff, Key, Lock, Hash, Check, X, Search } from "lucide-react";

type Staff = {
  id: string; name: string; role: string; branch: string; branchId: string | null; branchCode: string;
  branchIds: string[]; branchNames: string[];
  phone: string; email: string; username: string | null;
  hasPassword: boolean; hasPin: boolean;
  status: string; addedDate: string;
};

type BranchOption = { id: string; name: string };

type StaffForm = {
  name: string; role: string; branchId: string; branchIds: string[];
  phone: string; email: string;
  username: string; password: string;
  pin: string;
};

const emptyForm: StaffForm = {
  name: "", role: "STAFF", branchId: "", branchIds: [],
  phone: "", email: "",
  username: "", password: "",
  pin: "",
};

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "ACTIVE" | "DEACTIVATED">("all");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [form, setForm] = useState<StaffForm>(emptyForm);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [activeTab, setActiveTab] = useState<"details" | "access" | "security">("details");

  const loadStaff = () => {
    fetch("/api/staff")
      .then((res) => res.json())
      .then((data) => { setStaff(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    loadStaff();
    fetch("/api/branches").then((r) => r.json()).then(setBranches);
  }, []);

  const filtered = staff.filter((s) => {
    const matchFilter = filter === "all" || s.status === filter;
    const matchSearch = !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.phone.includes(search);
    return matchFilter && matchSearch;
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
      branchId: s.branchId || "",
      branchIds: s.branchIds || [],
      phone: s.phone,
      email: s.email,
      username: s.username || "",
      password: "",
      pin: "",
    });
    setEditingId(s.id);
    setEditingStaff(s);
    setActiveTab("details");
    setShowPassword(false);
    setSaveError("");
    setDialogOpen(true);
  };

  const toggleBranch = (branchId: string) => {
    setForm((prev) => ({
      ...prev,
      branchIds: prev.branchIds.includes(branchId)
        ? prev.branchIds.filter((id) => id !== branchId)
        : [...prev.branchIds, branchId],
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
        branchId: form.branchId || null,
        branchIds: form.branchIds,
        username: form.username || null,
      };

      // Only send password if set
      if (form.password && form.password.length >= 6) {
        payload.password = form.password;
      }

      // Only send PIN if set
      if (form.pin && form.pin.length === 4) {
        payload.pin = form.pin;
      }

      const url = editingId ? `/api/staff/${editingId}` : "/api/staff";
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
    await fetch(`/api/staff/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    loadStaff();
  };

  const roleLabel = (role: string) => {
    if (role === "ADMIN") return "Admin";
    if (role === "BRANCH_MANAGER") return "Manager";
    return "Staff";
  };

  const roleColor = (role: string) => {
    if (role === "ADMIN") return "border-terracotta text-terracotta";
    if (role === "BRANCH_MANAGER") return "border-blue-500 text-blue-600";
    return "border-gray-300 text-gray-500";
  };

  const isAdminOrManager = form.role === "ADMIN" || form.role === "BRANCH_MANAGER";

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Staff</h2>
          <p className="mt-0.5 text-sm text-gray-500">{staff.length} members across {new Set(staff.map((s) => s.branch).filter(Boolean)).size} locations</p>
        </div>
        <Button onClick={openAdd} className="bg-terracotta hover:bg-terracotta-dark"><Plus className="mr-1.5 h-4 w-4" />Add User</Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Search by name or phone..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1.5">
          {(["all", "ACTIVE", "DEACTIVATED"] as const).map((t) => (
            <button key={t} onClick={() => setFilter(t)} className={`rounded-full border px-3 py-1 text-xs capitalize transition-colors ${filter === t ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500"}`}>
              {t === "all" ? "All" : t.toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left font-medium text-gray-500">User</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Role</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Outlet Access</th>
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
                    {s.branch && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">{s.branch}</span>}
                    {s.branchNames.filter((n) => n !== s.branch).map((name) => (
                      <span key={name} className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">{name}</span>
                    ))}
                    {!s.branch && s.branchNames.length === 0 && <span className="text-xs text-gray-400">All outlets</span>}
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
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openEdit(s)}>Edit</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Staff Edit/Add Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editingId ? "Edit Staff" : "Add Staff Member"}</DialogTitle></DialogHeader>

          {/* Tabs */}
          <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
            {(["details", "access", "security"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${activeTab === tab ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
              >
                {tab === "details" ? "Details" : tab === "access" ? "Outlet Access" : "Login & Security"}
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
                    <option value="ADMIN">Company Admin</option>
                    <option value="BRANCH_MANAGER">Branch Manager</option>
                    <option value="STAFF">Branch Staff</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">Primary Branch</label>
                  <select className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
                    <option value="">None (Company)</option>
                    {branches.map((b) => (
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

          {/* Tab: Outlet Access */}
          {activeTab === "access" && (
            <div className="py-2">
              <p className="text-sm text-gray-500 mb-3">Select which outlets this user can access. Primary branch is always included.</p>
              <div className="space-y-1.5">
                {branches.map((b) => {
                  const isPrimary = form.branchId === b.id;
                  const isSelected = isPrimary || form.branchIds.includes(b.id);
                  return (
                    <button
                      key={b.id}
                      onClick={() => { if (!isPrimary) toggleBranch(b.id); }}
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
              {branches.length === 0 && <p className="py-4 text-center text-sm text-gray-400">No branches found</p>}
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
                    {[0, 1, 2, 3].map((i) => (
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
                          const joined = newPin.join("").slice(0, 4);
                          setForm({ ...form, pin: joined });
                          // Auto-advance
                          if (val && i < 3) {
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
                    {form.pin && form.pin.length === 4 && (
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
                <p className="mt-2 text-[10px] text-gray-400">4-digit PIN for quick login at the outlet.</p>
              </div>
            </div>
          )}

          {saveError && <p className="text-xs text-red-500 px-1">{saveError}</p>}
          <DialogFooter>
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
