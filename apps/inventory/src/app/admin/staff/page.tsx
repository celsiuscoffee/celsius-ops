"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Loader2 } from "lucide-react";

type Staff = {
  id: string; name: string; role: string; branch: string; branchId: string | null; branchCode: string;
  phone: string; email: string; status: string; addedDate: string;
};

type BranchOption = { id: string; name: string };
type StaffForm = { name: string; role: string; branchId: string; phone: string; email: string };
const emptyForm: StaffForm = { name: "", role: "STAFF", branchId: "", phone: "", email: "" };

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "ACTIVE" | "DEACTIVATED">("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<StaffForm>(emptyForm);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [saving, setSaving] = useState(false);

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

  const filtered = staff.filter((s) => filter === "all" || s.status === filter);

  const openAdd = () => { setForm(emptyForm); setEditingId(null); setDialogOpen(true); };

  const openEdit = (s: Staff) => {
    setForm({ name: s.name, role: s.role, branchId: s.branchId || "", phone: s.phone, email: s.email });
    setEditingId(s.id);
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name || !form.phone) return;
    setSaving(true);
    try {
      const url = editingId ? `/api/staff/${editingId}` : "/api/staff";
      await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          email: form.email || null,
          role: form.role,
          branchId: form.branchId || null,
        }),
      });
      setDialogOpen(false);
      loadStaff();
    } finally {
      setSaving(false);
    }
  };

  const roleLabel = (role: string) => {
    if (role === "ADMIN") return "Company Admin";
    if (role === "BRANCH_MANAGER") return "Branch Manager";
    return "Branch Staff";
  };

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
          <p className="mt-0.5 text-sm text-gray-500">{staff.length} members across {new Set(staff.map((s) => s.branch)).size} locations</p>
        </div>
        <Button onClick={openAdd} className="bg-terracotta hover:bg-terracotta-dark"><Plus className="mr-1.5 h-4 w-4" />Add User</Button>
      </div>

      <div className="mt-4 flex gap-1.5">
        {(["all", "ACTIVE", "DEACTIVATED"] as const).map((t) => (
          <button key={t} onClick={() => setFilter(t)} className={`rounded-full border px-3 py-1 text-xs capitalize transition-colors ${filter === t ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500"}`}>
            {t === "all" ? "All" : t.toLowerCase()}
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left font-medium text-gray-500">User</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Role</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Assigned to</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Phone</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Email</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Added</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-terracotta/10 text-xs font-bold text-terracotta-dark">{s.name.charAt(0)}</div>
                    <p className="font-medium text-gray-900">{s.name}</p>
                  </div>
                </td>
                <td className="px-4 py-3"><Badge variant="outline" className={`text-[10px] ${s.role === "ADMIN" ? "border-terracotta text-terracotta" : ""}`}>{roleLabel(s.role)}</Badge></td>
                <td className="px-4 py-3 text-gray-600 text-xs">{s.branch || "Company"}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{s.phone || "—"}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{s.email || "—"}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{s.addedDate}</td>
                <td className="px-4 py-3 text-right">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openEdit(s)}>Edit</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editingId ? "Edit Staff" : "Add Staff Member"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div><label className="text-sm font-medium">Name</label><Input className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
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
                <label className="text-sm font-medium">Branch</label>
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
