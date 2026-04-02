"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Phone,
  MapPin,
  Clock,
  Package,
  MessageCircle,
  Loader2,
} from "lucide-react";

type Supplier = {
  id: string;
  name: string;
  code: string;
  location: string;
  phone: string;
  email: string;
  status: string;
  tags: string[];
  leadTimeDays: number;
  products: { id: string; name: string; sku: string; price: number; uom: string }[];
};

type SupplierForm = {
  name: string;
  location: string;
  phone: string;
  supplierCode: string;
  leadTimeDays: string;
  tags: string;
};

const emptyForm: SupplierForm = { name: "", location: "", phone: "", supplierCode: "", leadTimeDays: "1", tags: "" };

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SupplierForm>(emptyForm);
  const [priceDialogOpen, setPriceDialogOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [saving, setSaving] = useState(false);

  const loadSuppliers = () => {
    fetch("/api/suppliers")
      .then((res) => res.json())
      .then((data) => { setSuppliers(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadSuppliers(); }, []);

  const filtered = suppliers.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.code.toLowerCase().includes(search.toLowerCase()) ||
      s.location.toLowerCase().includes(search.toLowerCase())
  );

  const openAdd = () => { setForm(emptyForm); setEditingId(null); setDialogOpen(true); };

  const openEdit = (supplier: Supplier) => {
    setForm({
      name: supplier.name, location: supplier.location, phone: supplier.phone,
      supplierCode: supplier.code, leadTimeDays: String(supplier.leadTimeDays || 1),
      tags: supplier.tags.join(", "),
    });
    setEditingId(supplier.id);
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      const url = editingId ? `/api/suppliers/${editingId}` : "/api/suppliers";
      await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          supplierCode: form.supplierCode || null,
          phone: form.phone || null,
          location: form.location || null,
          leadTimeDays: form.leadTimeDays ? parseInt(form.leadTimeDays) : 1,
        }),
      });
      setDialogOpen(false);
      loadSuppliers();
    } finally {
      setSaving(false);
    }
  };

  const openPriceList = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setPriceDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this supplier?")) return;
    await fetch(`/api/suppliers/${id}`, { method: "DELETE" });
    loadSuppliers();
  };

  const updateField = (key: keyof SupplierForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Suppliers</h2>
          <p className="mt-0.5 text-sm text-gray-500">{suppliers.length} suppliers with product pricing</p>
        </div>
        <Button onClick={openAdd} className="bg-terracotta hover:bg-terracotta-dark">
          <Plus className="mr-1.5 h-4 w-4" />
          Add Supplier
        </Button>
      </div>

      {/* Search */}
      <div className="mt-4 relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          placeholder="Search by name, code, or location..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 max-w-md"
        />
      </div>

      {/* Supplier cards */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {filtered.map((supplier) => (
          <Card key={supplier.id} className="overflow-hidden">
            <div className="p-4">
              {/* Supplier header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-green-700 font-bold text-sm">
                    {supplier.name.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900">{supplier.name}</h3>
                      <Badge variant={supplier.status === "ACTIVE" ? "default" : "secondary"} className={`text-[10px] ${supplier.status === "ACTIVE" ? "bg-green-500" : ""}`}>
                        {supplier.status.toLowerCase()}
                      </Badge>
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-gray-500">
                      {supplier.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{supplier.location}</span>}
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{supplier.leadTimeDays}d lead</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEdit(supplier)} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleDelete(supplier.id)} className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Contact */}
              <div className="mt-3 flex items-center gap-3">
                {supplier.phone && (
                  <a href={`https://wa.me/${supplier.phone.replace("+", "")}`} target="_blank" className="flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs text-green-700 hover:bg-green-100">
                    <MessageCircle className="h-3 w-3" />
                    WhatsApp
                  </a>
                )}
                {supplier.phone && <span className="flex items-center gap-1 text-xs text-gray-500"><Phone className="h-3 w-3" />{supplier.phone}</span>}
                <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{supplier.code}</code>
              </div>

              {/* Products */}
              <div className="mt-3">
                <button
                  onClick={() => openPriceList(supplier)}
                  className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-left hover:bg-gray-50"
                >
                  <span className="flex items-center gap-1.5 text-sm text-gray-700">
                    <Package className="h-3.5 w-3.5 text-gray-400" />
                    {supplier.products.length} products
                  </span>
                  <span className="text-xs text-terracotta">View price list →</span>
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Supplier" : "Add Supplier"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Supplier Name</label>
                <Input className="mt-1" placeholder="e.g. Sri Ternak" value={form.name} onChange={(e) => updateField("name", e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Supplier Code</label>
                <Input className="mt-1" placeholder="e.g. ST001" value={form.supplierCode} onChange={(e) => updateField("supplierCode", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Location</label>
                <Input className="mt-1" placeholder="e.g. Putrajaya" value={form.location} onChange={(e) => updateField("location", e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">WhatsApp Number</label>
                <Input className="mt-1" placeholder="+60123456789" value={form.phone} onChange={(e) => updateField("phone", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Lead Time (days)</label>
                <Input className="mt-1" type="number" min="1" placeholder="1" value={form.leadTimeDays} onChange={(e) => updateField("leadTimeDays", e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Tags</label>
                <Input className="mt-1" placeholder="Fresh, Daily" value={form.tags} onChange={(e) => updateField("tags", e.target.value)} />
              </div>
            </div>
            <Button onClick={handleSubmit} disabled={saving || !form.name} className="w-full bg-terracotta hover:bg-terracotta-dark disabled:opacity-50">
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {editingId ? "Save Changes" : "Add Supplier"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Price List Dialog */}
      <Dialog open={priceDialogOpen} onOpenChange={setPriceDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedSupplier?.name} — Price List</DialogTitle>
          </DialogHeader>
          {selectedSupplier && (
            <div className="py-2">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-gray-500">{selectedSupplier.products.length} products</p>
                <Button size="sm" variant="outline">
                  <Plus className="mr-1 h-3 w-3" />
                  Add Product
                </Button>
              </div>
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Product</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">SKU</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Package</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Price (RM)</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSupplier.products.map((p, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="px-3 py-2 text-gray-900">{p.name}</td>
                        <td className="px-3 py-2"><code className="rounded bg-gray-100 px-1 text-xs">{p.sku}</code></td>
                        <td className="px-3 py-2 text-gray-600">{p.uom}</td>
                        <td className="px-3 py-2 text-right font-medium text-gray-900">{p.price.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">
                          <button className="text-gray-400 hover:text-gray-600"><Pencil className="h-3 w-3" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
