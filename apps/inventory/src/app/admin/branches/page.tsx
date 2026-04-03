"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Building2, Loader2 } from "lucide-react";

type Branch = {
  id: string; code: string; name: string; type: string; status: string;
  address: string; city: string; state: string; phone: string;
  staffCount: number; productCount: number;
};

type BranchForm = { name: string; code: string; type: string; address: string; city: string; state: string; phone: string };
const emptyForm: BranchForm = { name: "", code: "", type: "OUTLET", address: "", city: "", state: "", phone: "" };

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "OUTLET" | "CENTRAL_KITCHEN">("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BranchForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const loadBranches = () => {
    fetch("/api/branches")
      .then((res) => res.json())
      .then((data) => { setBranches(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadBranches(); }, []);

  const handleSubmit = async () => {
    if (!form.name || !form.code) return;
    setSaving(true);
    try {
      const url = editingId ? `/api/branches/${editingId}` : "/api/branches";
      await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          code: form.code,
          type: form.type,
          phone: form.phone || null,
          address: form.address || "",
          city: form.city || "",
          state: form.state || "",
        }),
      });
      setDialogOpen(false);
      loadBranches();
    } finally {
      setSaving(false);
    }
  };

  const filtered = branches.filter((b) => filter === "all" || b.type === filter);

  const openAdd = () => { setForm(emptyForm); setEditingId(null); setDialogOpen(true); };
  const openEdit = (b: Branch) => {
    setForm({ name: b.name, code: b.code, type: b.type, address: b.address, city: b.city, state: b.state, phone: b.phone });
    setEditingId(b.id);
    setDialogOpen(true);
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
          <h2 className="text-xl font-semibold text-gray-900">Branches</h2>
          <p className="mt-0.5 text-sm text-gray-500">{branches.filter((b) => b.status === "ACTIVE").length} active outlets</p>
        </div>
        <Button onClick={openAdd} className="bg-terracotta hover:bg-terracotta-dark">
          <Plus className="mr-1.5 h-4 w-4" />
          Add Branch
        </Button>
      </div>

      <div className="mt-4 flex gap-1.5">
        {(["all", "OUTLET", "CENTRAL_KITCHEN"] as const).map((t) => (
          <button key={t} onClick={() => setFilter(t)} className={`rounded-full border px-3 py-1 text-xs transition-colors ${filter === t ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
            {t === "all" ? "All" : t === "OUTLET" ? "Branch" : "Central Kitchen"}
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left font-medium text-gray-500">Branch Code</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Branch Name</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Address</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Phone</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Staff</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Products</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((branch) => (
              <tr key={branch.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3"><code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-terracotta">{branch.code}</code></td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-gray-400" />
                    <div>
                      <p className="font-medium text-gray-900">{branch.name}</p>
                      <p className="text-xs text-gray-400">{branch.type === "OUTLET" ? "Branch" : "Central Kitchen"}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge className={`text-[10px] ${branch.status === "ACTIVE" ? "bg-green-500" : "bg-gray-400"}`}>
                    {branch.status === "ACTIVE" ? "Active" : "Deactivated"}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">{branch.address}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{branch.phone}</td>
                <td className="px-4 py-3 text-gray-600">{branch.staffCount}</td>
                <td className="px-4 py-3 text-gray-600">{branch.productCount}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openEdit(branch)} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingId ? "Edit Branch" : "Add Branch"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-sm font-medium text-gray-700">Branch Name</label><Input className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><label className="text-sm font-medium text-gray-700">Branch Code</label><Input className="mt-1" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Type</label>
                <select className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="OUTLET">Branch (Outlet)</option>
                  <option value="CENTRAL_KITCHEN">Central Kitchen</option>
                </select>
              </div>
              <div><label className="text-sm font-medium text-gray-700">Phone</label><Input className="mt-1" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <div><label className="text-sm font-medium text-gray-700">Address</label><Input className="mt-1" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-sm font-medium text-gray-700">City</label><Input className="mt-1" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
              <div><label className="text-sm font-medium text-gray-700">State</label><Input className="mt-1" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
            </div>
            <Button onClick={handleSubmit} disabled={saving || !form.name || !form.code} className="w-full bg-terracotta hover:bg-terracotta-dark disabled:opacity-50">
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {editingId ? "Save Changes" : "Add Branch"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
