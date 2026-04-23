"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Building2, Loader2, Trash2, Power } from "lucide-react";

type Outlet = {
  id: string; code: string; name: string; type: string; status: string;
  address: string; city: string; state: string; phone: string;
  staffCount: number; productCount: number;
  // New settings
  lat: number | null; lng: number | null;
  openTime: string | null; closeTime: string | null;
  daysOpen: number[] | null;
  isOpen: boolean; isBusy: boolean; pickupTimeMins: number;
  stripeEnabled: boolean; rmEnabled: boolean; bukkuEnabled: boolean;
  bukkuSubdomain: string | null;
  storehubId: string | null;
  pickupStoreId: string | null;
};

type OutletForm = {
  name: string; code: string; type: string; address: string; city: string; state: string; phone: string;
  // Settings
  openTime: string; closeTime: string;
  pickupTimeMins: number;
  storehubId: string;
  pickupStoreId: string;
};

const emptyForm: OutletForm = {
  name: "", code: "", type: "OUTLET", address: "", city: "", state: "", phone: "",
  openTime: "", closeTime: "", pickupTimeMins: 15, storehubId: "", pickupStoreId: "",
};

export default function OutletsPage() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "OUTLET" | "CENTRAL_KITCHEN">("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<OutletForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("details");

  const loadOutlets = () => {
    fetch("/api/settings/outlets")
      .then((res) => res.json())
      .then((data) => { setOutlets(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadOutlets(); }, []);

  const handleSubmit = async () => {
    if (!form.name || !form.code) return;
    setSaving(true);
    try {
      const url = editingId ? `/api/settings/outlets/${editingId}` : "/api/settings/outlets";
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
          openTime: form.openTime || null,
          closeTime: form.closeTime || null,
          pickupTimeMins: form.pickupTimeMins,
          storehubId: form.storehubId || null,
          pickupStoreId: form.pickupStoreId || null,
        }),
      });
      setDialogOpen(false);
      loadOutlets();
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (outlet: Outlet) => {
    const newStatus = outlet.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    if (newStatus === "INACTIVE" && !confirm(`Deactivate ${outlet.name}?`)) return;
    const res = await fetch(`/api/settings/outlets/${outlet.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) loadOutlets();
  };

  const deleteOutlet = async (outlet: Outlet) => {
    if (!confirm(`Delete "${outlet.name}" permanently? This cannot be undone.`)) return;
    const res = await fetch(`/api/settings/outlets/${outlet.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to delete outlet");
      return;
    }
    loadOutlets();
  };

  const filtered = outlets.filter((b) => filter === "all" || b.type === filter);

  const openAdd = () => { setForm(emptyForm); setEditingId(null); setActiveTab("details"); setDialogOpen(true); };
  const openEdit = (b: Outlet) => {
    setForm({
      name: b.name, code: b.code, type: b.type, address: b.address, city: b.city, state: b.state, phone: b.phone,
      openTime: b.openTime || "", closeTime: b.closeTime || "",
      pickupTimeMins: b.pickupTimeMins ?? 15,
      storehubId: b.storehubId || "",
      pickupStoreId: b.pickupStoreId || "",
    });
    setEditingId(b.id);
    setActiveTab("details");
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
    <div className="p-3 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Outlets</h2>
          <p className="mt-0.5 text-sm text-gray-500">{outlets.filter((b) => b.status === "ACTIVE").length} active outlets</p>
        </div>
        <Button onClick={openAdd} className="bg-terracotta hover:bg-terracotta-dark">
          <Plus className="mr-1.5 h-4 w-4" />
          Add Outlet
        </Button>
      </div>

      <div className="mt-4 flex gap-1.5">
        {(["all", "OUTLET", "CENTRAL_KITCHEN"] as const).map((t) => (
          <button key={t} onClick={() => setFilter(t)} className={`rounded-full border px-3 py-1 text-xs transition-colors ${filter === t ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
            {t === "all" ? "All" : t === "OUTLET" ? "Outlet" : "Central Kitchen"}
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left font-medium text-gray-500">Outlet Code</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Outlet Name</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Settings</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Phone</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Staff</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Products</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((outlet) => (
              <tr key={outlet.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3"><code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-terracotta">{outlet.code}</code></td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-gray-400" />
                    <div>
                      <p className="font-medium text-gray-900">{outlet.name}</p>
                      <p className="text-xs text-gray-400">{outlet.type === "OUTLET" ? "Outlet" : "Central Kitchen"}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge className={`text-[10px] ${outlet.status === "ACTIVE" ? "bg-green-500" : "bg-gray-400"}`}>
                    {outlet.status === "ACTIVE" ? "Active" : "Deactivated"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1">
                    {/* Open/Closed indicator */}
                    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${outlet.isOpen ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${outlet.isOpen ? "bg-green-500" : "bg-gray-400"}`} />
                      {outlet.isOpen ? "Open" : "Closed"}
                    </span>
                    {/* Pickup time */}
                    <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                      {outlet.pickupTimeMins}m
                    </span>
                    {/* Operating hours */}
                    {outlet.openTime && outlet.closeTime && (
                      <span className="rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                        {outlet.openTime}-{outlet.closeTime}
                      </span>
                    )}
                    {/* Integration badges */}
                    {outlet.pickupStoreId && (
                      <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Pickup</span>
                    )}
                    {outlet.storehubId && (
                      <span className="rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">StoreHub</span>
                    )}
                    {outlet.stripeEnabled && (
                      <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">Stripe</span>
                    )}
                    {outlet.bukkuEnabled && (
                      <span className="rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700">Bukku</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{outlet.phone}</td>
                <td className="px-4 py-3 text-gray-600">{outlet.staffCount}</td>
                <td className="px-4 py-3 text-gray-600">{outlet.productCount}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => openEdit(outlet)} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600" title="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => toggleStatus(outlet)} className={`rounded-md p-1.5 hover:bg-gray-100 ${outlet.status === "ACTIVE" ? "text-gray-400 hover:text-amber-600" : "text-green-500 hover:text-green-700"}`} title={outlet.status === "ACTIVE" ? "Deactivate" : "Activate"}>
                      <Power className="h-3.5 w-3.5" />
                    </button>
                    {outlet.staffCount === 0 && (
                      <button onClick={() => deleteOutlet(outlet)} className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? "Edit Outlet" : "Add Outlet"}</DialogTitle></DialogHeader>
          {/* Tab buttons */}
          <div className="flex rounded-lg bg-gray-100 p-0.5">
            {([["details", "Details"], ["settings", "Settings"]] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setActiveTab(value)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${activeTab === value ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === "details" && (
            <div className="grid gap-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm font-medium text-gray-700">Outlet Name</label><Input className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><label className="text-sm font-medium text-gray-700">Outlet Code</label><Input className="mt-1" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-gray-700">Type</label>
                  <select className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    <option value="OUTLET">Outlet</option>
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
            </div>
          )}

          {activeTab === "settings" && (
            <div className="grid gap-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-gray-700">Open Time</label>
                  <Input className="mt-1" type="time" value={form.openTime} onChange={(e) => setForm({ ...form, openTime: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Close Time</label>
                  <Input className="mt-1" type="time" value={form.closeTime} onChange={(e) => setForm({ ...form, closeTime: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Pickup Time (minutes)</label>
                <Input className="mt-1" type="number" min={1} value={form.pickupTimeMins} onChange={(e) => setForm({ ...form, pickupTimeMins: parseInt(e.target.value) || 0 })} />
                <p className="mt-1 text-xs text-gray-400">Estimated time for order pickup</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Pickup Store ID</label>
                <Input className="mt-1" value={form.pickupStoreId} onChange={(e) => setForm({ ...form, pickupStoreId: e.target.value })} placeholder="e.g. shah-alam, conezion, tamarind" />
                <p className="mt-1 text-xs text-gray-400">Links this outlet to the pickup/order app (Supabase store_id)</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">StoreHub ID</label>
                <Input className="mt-1" value={form.storehubId} onChange={(e) => setForm({ ...form, storehubId: e.target.value })} placeholder="e.g. sh_abc123" />
                <p className="mt-1 text-xs text-gray-400">Links this outlet to StoreHub POS</p>
              </div>
            </div>
          )}
          <Button onClick={handleSubmit} disabled={saving || !form.name || !form.code} className="w-full bg-terracotta hover:bg-terracotta-dark disabled:opacity-50">
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {editingId ? "Save Changes" : "Add Outlet"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
