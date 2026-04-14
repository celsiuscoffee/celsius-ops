"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useFetch } from "@/lib/use-fetch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Search, Pencil, Trash2, Box, ChevronDown, Loader2, CheckSquare, X } from "lucide-react";

type Product = {
  id: string;
  name: string;
  sku: string;
  group: string;
  groupId: string;
  baseUom: string;
  storageArea: string;
  shelfLifeDays: number | null;
  description: string;
  checkFrequency: string;
  packages: { id: string; sku: string; name: string; uom: string; label: string; conversion: number; isDefault: boolean }[];
  suppliers: { name: string; price: number; uom: string }[];
};

type GroupOption = { id: string; name: string };
type SupplierOption = { id: string; name: string };

type PackageEntry = {
  id?: string;
  sku: string;
  packageName: string;
  packageLabel: string;
  conversionFactor: string;
  isDefault: boolean;
};

type SupplierEntry = {
  supplierId?: string;
  supplierName?: string;
  phone?: string;
  price: number;
  productPackageId?: string;
};

type ProductForm = {
  name: string;
  sku: string;
  groupId: string;
  baseUom: string;
  storageArea: string;
  shelfLifeDays: string;
  checkFrequency: string;
  description: string;
  packages: PackageEntry[];
  suppliers: SupplierEntry[];
};

const STORAGE_AREAS = ["FRIDGE", "FREEZER", "DRY_STORE", "COUNTER", "BAR"];

const PACKAGE_PRESETS = [
  { name: "Carton", label: "Carton" },
  { name: "Bottle", label: "Bottle" },
  { name: "Pack", label: "Pack" },
  { name: "Bag", label: "Bag" },
  { name: "Box", label: "Box" },
  { name: "Can", label: "Can" },
  { name: "Tub", label: "Tub" },
  { name: "Drum", label: "Drum" },
  { name: "Roll", label: "Roll" },
  { name: "Sleeve", label: "Sleeve" },
];

const emptyForm: ProductForm = { name: "", sku: "", groupId: "", baseUom: "", storageArea: "", shelfLifeDays: "", checkFrequency: "MONTHLY", description: "", packages: [], suppliers: [] };

export default function PerishablesPage() {
  const { data: products = [], isLoading: loading, mutate: reloadProducts } = useFetch<Product[]>("/api/inventory/products?itemType=PERISHABLE");
  const { data: groupOptions = [] } = useFetch<GroupOption[]>("/api/inventory/groups");
  const { data: supplierOptions = [] } = useFetch<SupplierOption[]>("/api/inventory/suppliers");
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("All");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Inline supplier form state
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [supplierPrice, setSupplierPrice] = useState("");
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierPhone, setNewSupplierPhone] = useState("");

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);

  const loadProducts = () => reloadProducts();

  const handleSubmit = async () => {
    if (!form.name || !form.sku || !form.groupId) return;
    setSaving(true);
    try {
      const url = editingId ? `/api/inventory/products/${editingId}` : "/api/inventory/products";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          sku: form.sku,
          groupId: form.groupId,
          baseUom: form.baseUom,
          storageArea: form.storageArea || null,
          shelfLifeDays: form.shelfLifeDays || null,
          description: form.description || null,
          checkFrequency: form.checkFrequency,
          itemType: "PERISHABLE",
          packages: form.packages.filter((p) => p.packageName && p.conversionFactor).map((p) => ({
            id: p.id || undefined,
            sku: p.sku || undefined,
            packageName: p.packageName,
            packageLabel: p.packageLabel || p.packageName,
            conversionFactor: parseFloat(p.conversionFactor) || 1,
            isDefault: p.isDefault,
          })),
          suppliers: form.suppliers,
        }),
      });
      if (!res.ok) { alert("Failed to save perishable. Please try again."); return; }
      setDialogOpen(false);
      loadProducts();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this perishable?")) return;
    const res = await fetch(`/api/inventory/products/${id}`, { method: "DELETE" });
    if (!res.ok) { alert("Failed to delete perishable. It may be linked to orders or recipes."); return; }
    loadProducts();
  };

  const groups = ["All", ...new Set(products.map((p) => p.group).filter(Boolean))].sort();

  const filtered = products.filter((p) => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase());
    const matchGroup = groupFilter === "All" || p.group === groupFilter;
    return matchSearch && matchGroup;
  });

  const openAdd = () => {
    setForm(emptyForm);
    setEditingId(null);
    resetSupplierForm();
    setDialogOpen(true);
  };

  const openEdit = (product: Product) => {
    setForm({
      name: product.name,
      sku: product.sku,
      groupId: product.groupId,
      baseUom: product.baseUom,
      storageArea: product.storageArea || "",
      shelfLifeDays: product.shelfLifeDays?.toString() || "",
      checkFrequency: product.checkFrequency || "MONTHLY",
      description: product.description || "",
      packages: product.packages.map((pkg) => ({
        id: pkg.id,
        sku: pkg.sku || "",
        packageName: pkg.name,
        packageLabel: pkg.label,
        conversionFactor: pkg.conversion.toString(),
        isDefault: pkg.isDefault,
      })),
      suppliers: [],
    });
    setEditingId(product.id);
    resetSupplierForm();
    setDialogOpen(true);
  };

  const updateField = (key: keyof ProductForm, value: string | PackageEntry[] | SupplierEntry[]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetSupplierForm = () => {
    setSelectedSupplierId("");
    setSupplierPrice("");
    setShowNewSupplier(false);
    setNewSupplierName("");
    setNewSupplierPhone("");
  };

  const addExistingSupplier = () => {
    if (!selectedSupplierId || !supplierPrice) return;
    const supplier = supplierOptions.find((s) => s.id === selectedSupplierId);
    if (!supplier) return;
    const pkgSelect = document.getElementById("perishable-supplier-pkg-select") as HTMLSelectElement | null;
    const pkgId = pkgSelect?.value || undefined;
    setForm((prev) => ({
      ...prev,
      suppliers: [...prev.suppliers, {
        supplierId: selectedSupplierId,
        price: parseFloat(supplierPrice),
        productPackageId: pkgId && !pkgId.startsWith("new-") ? pkgId : undefined,
      }],
    }));
    setSelectedSupplierId("");
    setSupplierPrice("");
    if (pkgSelect) pkgSelect.value = "";
  };

  const addNewSupplier = () => {
    if (!newSupplierName || !supplierPrice) return;
    setForm((prev) => ({
      ...prev,
      suppliers: [...prev.suppliers, { supplierName: newSupplierName, phone: newSupplierPhone || undefined, price: parseFloat(supplierPrice) }],
    }));
    setNewSupplierName("");
    setNewSupplierPhone("");
    setSupplierPrice("");
    setShowNewSupplier(false);
  };

  const removeSupplierEntry = (index: number) => {
    setForm((prev) => ({
      ...prev,
      suppliers: prev.suppliers.filter((_, i) => i !== index),
    }));
  };

  // Bulk selection helpers
  const filteredIds = filtered.map((p) => p.id);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  const clearSelection = () => {
    setSelected(new Set());
    setBulkAction(null);
  };

  const handleBulkUpdate = async (data: Record<string, string>) => {
    setBulkSaving(true);
    try {
      const res = await fetch("/api/inventory/products/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected), data }),
      });
      if (!res.ok) { alert("Bulk update failed"); return; }
      const result = await res.json();
      alert(`Updated ${result.updated} perishables`);
      clearSelection();
      reloadProducts();
    } finally {
      setBulkSaving(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} perishables? This cannot be undone.`)) return;
    setBulkSaving(true);
    try {
      const res = await fetch("/api/inventory/products/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) { alert("Bulk delete failed. Some perishables may be linked to orders."); return; }
      const result = await res.json();
      alert(`Deleted ${result.deleted} perishables`);
      clearSelection();
      reloadProducts();
    } finally {
      setBulkSaving(false);
    }
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Perishables</h2>
          <p className="mt-0.5 text-sm text-gray-500">{products.length} perishables — packaging, tissue, cleaning supplies</p>
        </div>
        <Button onClick={openAdd} className="bg-terracotta hover:bg-terracotta-dark">
          <Plus className="mr-1.5 h-4 w-4" />
          Add Perishable
        </Button>
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search by name or SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {groups.slice(0, 12).map((g) => (
            <button
              key={g}
              onClick={() => setGroupFilter(g)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                groupFilter === g
                  ? "border-terracotta bg-terracotta/5 text-terracotta-dark"
                  : "border-gray-200 text-gray-500 hover:bg-gray-50"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allFilteredSelected && filteredIds.length > 0}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 rounded border-gray-300 text-terracotta accent-terracotta"
                />
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Perishable</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">SKU</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Group</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Base UOM</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Storage</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Check</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Packages</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Suppliers</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-terracotta" />
                  <p className="mt-2 text-sm text-gray-500">Loading perishables...</p>
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-sm text-gray-400">No perishables found</td>
              </tr>
            )}
            {!loading && filtered.map((product) => (
              <tr
                key={product.id}
                className={`border-b border-gray-50 transition-colors ${selected.has(product.id) ? "bg-terracotta/5" : "hover:bg-gray-50/50"}`}
              >
                <td className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(product.id)}
                    onChange={() => toggleSelect(product.id)}
                    className="h-4 w-4 rounded border-gray-300 text-terracotta accent-terracotta"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100">
                      <Box className="h-4 w-4 text-gray-400" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{product.name}</p>
                      {product.shelfLifeDays && (
                        <p className="text-xs text-terracotta">{product.shelfLifeDays}d shelf life</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                    {product.sku}
                  </code>
                </td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className="text-xs">
                    {product.group}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-gray-600">{product.baseUom}</td>
                <td className="px-4 py-3 text-gray-600">{product.storageArea ? product.storageArea.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : "—"}</td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className={`text-xs ${product.checkFrequency === "DAILY" ? "border-red-200 bg-red-50 text-red-600" : product.checkFrequency === "WEEKLY" ? "border-amber-200 bg-amber-50 text-amber-600" : "border-gray-200 text-gray-500"}`}>
                    {product.checkFrequency === "DAILY" ? "Daily" : product.checkFrequency === "WEEKLY" ? "Weekly" : "Monthly"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => setExpandedId(expandedId === product.id ? null : product.id)}
                    className="flex items-center gap-1 text-xs text-terracotta hover:underline"
                  >
                    {product.packages.length} UOMs
                    <ChevronDown className={`h-3 w-3 transition-transform ${expandedId === product.id ? "rotate-180" : ""}`} />
                  </button>
                  {expandedId === product.id && (
                    <div className="mt-1 space-y-0.5">
                      {product.packages.map((pkg) => (
                        <p key={pkg.name} className="text-xs text-gray-500">
                          {pkg.sku && <code className="mr-1 rounded bg-gray-100 px-1 text-[10px]">{pkg.sku}</code>}
                          1 {pkg.name} = {pkg.conversion > 1 ? `${pkg.conversion.toLocaleString()} ${product.baseUom}` : pkg.label}
                        </p>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {product.suppliers.map((s, i) => (
                      <span key={i} className="text-xs text-gray-500">{s.name} (RM{s.price.toFixed(2)})</span>
                    ))}
                    {product.suppliers.length === 0 && <span className="text-xs text-gray-300">—</span>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => openEdit(product)}
                      className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleDelete(product.id)} className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-gray-200 bg-white px-5 py-3 shadow-lg">
          <div className="flex items-center gap-2">
            <CheckSquare className="h-4 w-4 text-terracotta" />
            <span className="text-sm font-medium text-gray-900">{selected.size} selected</span>
          </div>
          <div className="h-5 w-px bg-gray-200" />
          <button
            onClick={() => setBulkAction("group")}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Change Group
          </button>
          <button
            onClick={() => setBulkAction("storage")}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Change Storage
          </button>
          <button
            onClick={() => setBulkAction("frequency")}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Change Frequency
          </button>
          <button
            onClick={handleBulkDelete}
            disabled={bulkSaving}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
          <div className="h-5 w-px bg-gray-200" />
          <button onClick={clearSelection} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Bulk action dialog */}
      <Dialog open={bulkAction !== null} onOpenChange={(open) => { if (!open) setBulkAction(null); }}>
        <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {bulkAction === "group" && "Change Group"}
              {bulkAction === "storage" && "Change Storage Area"}
              {bulkAction === "frequency" && "Change Check Frequency"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-500">Apply to {selected.size} selected perishables</p>
          <div className="mt-2">
            {bulkAction === "group" && (
              <select
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) handleBulkUpdate({ groupId: e.target.value });
                }}
              >
                <option value="" disabled>Select group...</option>
                {groupOptions.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            )}
            {bulkAction === "storage" && (
              <select
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) handleBulkUpdate({ storageArea: e.target.value });
                }}
              >
                <option value="" disabled>Select storage area...</option>
                {[...new Set([...STORAGE_AREAS, ...products.map((p) => p.storageArea).filter(Boolean)])].sort().map((area) => (
                  <option key={area} value={area}>{area.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}</option>
                ))}
              </select>
            )}
            {bulkAction === "frequency" && (
              <select
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) handleBulkUpdate({ checkFrequency: e.target.value });
                }}
              >
                <option value="" disabled>Select frequency...</option>
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            )}
          </div>
          {bulkSaving && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Updating...
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) { setEditingId(null); setForm(emptyForm); resetSupplierForm(); } }}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg">{editingId ? "Edit Perishable" : "Add Perishable"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-5 py-3">
            {/* Basic Info */}
            <div className="rounded-lg border border-gray-200 bg-gray-50/30 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Basic Info</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Perishable Name</label>
                  <Input
                    className="mt-1.5 h-10"
                    placeholder="e.g. Paper Cup 12oz"
                    value={form.name}
                    onChange={(e) => updateField("name", e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">SKU Code</label>
                  <Input
                    className="mt-1.5 h-10"
                    placeholder="e.g. PER001"
                    value={form.sku}
                    onChange={(e) => updateField("sku", e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Group</label>
                  <select
                    className="mt-1.5 h-10 w-full rounded-md border border-gray-200 px-3 text-sm"
                    value={form.groupId}
                    onChange={(e) => updateField("groupId", e.target.value)}
                  >
                    <option value="">Select...</option>
                    {groupOptions.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Base UOM</label>
                  <select
                    className="mt-1.5 h-10 w-full rounded-md border border-gray-200 px-3 text-sm"
                    value={form.baseUom}
                    onChange={(e) => updateField("baseUom", e.target.value)}
                  >
                    <option value="">Select...</option>
                    <option value="ml">Milliliter (ml)</option>
                    <option value="g">Gram (g)</option>
                    <option value="pcs">Piece (pcs)</option>
                    <option value="roll">Roll (roll)</option>
                    <option value="pack">Pack (pack)</option>
                    <option value="box">Box (box)</option>
                    <option value="bottle">Bottle (bottle)</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Description</label>
                  <Input
                    className="mt-1.5 h-10"
                    placeholder="Optional notes..."
                    value={form.description}
                    onChange={(e) => updateField("description", e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Storage & Tracking */}
            <div className="rounded-lg border border-gray-200 bg-gray-50/30 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Storage &amp; Tracking</p>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Storage Area</label>
                  <div className="relative mt-1.5">
                    <input
                      list="perishable-storage-area-options"
                      className="h-10 w-full rounded-md border border-gray-200 px-3 text-sm"
                      placeholder="Type or select..."
                      value={form.storageArea}
                      onChange={(e) => updateField("storageArea", e.target.value)}
                    />
                    <datalist id="perishable-storage-area-options">
                      {[...new Set([
                        "FRIDGE", "FREEZER", "DRY_STORE", "COUNTER", "BAR",
                        ...products.map((p) => p.storageArea).filter(Boolean),
                      ])].sort().map((area) => (
                        <option key={area} value={area}>{area.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}</option>
                      ))}
                    </datalist>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Shelf Life (days)</label>
                  <Input
                    className="mt-1.5 h-10"
                    type="number"
                    placeholder="e.g. 30"
                    value={form.shelfLifeDays}
                    onChange={(e) => updateField("shelfLifeDays", e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Check Frequency</label>
                  <select
                    className="mt-1.5 h-10 w-full rounded-md border border-gray-200 px-3 text-sm"
                    value={form.checkFrequency}
                    onChange={(e) => updateField("checkFrequency", e.target.value)}
                  >
                    <option value="DAILY">Daily</option>
                    <option value="WEEKLY">Weekly</option>
                    <option value="MONTHLY">Monthly</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Packages */}
            <div className="rounded-lg border border-gray-200 bg-gray-50/30 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Packages</p>
              <p className="mb-3 text-xs text-gray-400">
                Define how this item is packaged when purchased. E.g. 1 Carton = 50 {form.baseUom || "units"}
              </p>

              {/* Existing package entries */}
              {form.packages.length > 0 && (
                <div className="mb-3 space-y-2">
                  {form.packages.map((pkg, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5">
                      <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{pkg.sku || "—"}</code>
                      <span className="text-sm font-medium text-gray-700">{pkg.packageName}</span>
                      <span className="text-xs text-gray-400">=</span>
                      <span className="text-sm text-gray-600">{Number(pkg.conversionFactor).toLocaleString()} {form.baseUom || "units"}</span>
                      {pkg.isDefault && <Badge variant="outline" className="text-xs border-blue-200 bg-blue-50 text-blue-600">Default</Badge>}
                      <div className="flex-1" />
                      <button
                        type="button"
                        onClick={() => {
                          setForm((prev) => ({ ...prev, packages: prev.packages.filter((_, idx) => idx !== i) }));
                        }}
                        className="text-gray-400 hover:text-red-500"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new package row */}
              <div className="flex items-end gap-3">
                <div className="w-28">
                  <label className="text-xs text-gray-500">SKU</label>
                  <Input
                    id="perishable-new-pkg-sku"
                    placeholder="e.g. PER001-CTN"
                    className="mt-1 h-10"
                  />
                </div>
                <div className="w-36">
                  <label className="text-xs text-gray-500">Package Type</label>
                  <select
                    id="perishable-new-pkg-name"
                    className="mt-1 h-10 w-full rounded-md border border-gray-200 px-3 text-sm"
                    defaultValue=""
                  >
                    <option value="" disabled>Select...</option>
                    {PACKAGE_PRESETS.filter((p) => !form.packages.some((ep) => ep.packageName === p.name)).map((p) => (
                      <option key={p.name} value={p.name}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div className="w-32">
                  <label className="text-xs text-gray-500">= {form.baseUom || "units"}</label>
                  <Input
                    id="perishable-new-pkg-conv"
                    type="number"
                    placeholder="e.g. 50"
                    className="mt-1 h-10"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10"
                  onClick={() => {
                    const skuEl = document.getElementById("perishable-new-pkg-sku") as HTMLInputElement;
                    const nameEl = document.getElementById("perishable-new-pkg-name") as HTMLSelectElement;
                    const convEl = document.getElementById("perishable-new-pkg-conv") as HTMLInputElement;
                    if (!nameEl.value || !convEl.value) return;
                    setForm((prev) => ({
                      ...prev,
                      packages: [...prev.packages, {
                        sku: skuEl.value || "",
                        packageName: nameEl.value,
                        packageLabel: nameEl.value,
                        conversionFactor: convEl.value,
                        isDefault: prev.packages.length === 0,
                      }],
                    }));
                    skuEl.value = "";
                    nameEl.value = "";
                    convEl.value = "";
                  }}
                >
                  Add
                </Button>
              </div>
            </div>

            {/* Suppliers & Pricing */}
            <div className="rounded-lg border border-gray-200 bg-gray-50/30 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Suppliers &amp; Pricing</p>

              {/* Existing supplier entries */}
              {form.suppliers.length > 0 && (
                <div className="mb-3 space-y-2">
                  {form.suppliers.map((entry, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5">
                      <span className="flex-1 text-sm font-medium text-gray-700">
                        {entry.supplierId
                          ? supplierOptions.find((s) => s.id === entry.supplierId)?.name ?? "Supplier"
                          : entry.supplierName ?? "New Supplier"}
                        {entry.productPackageId && (
                          <span className="ml-1.5 text-xs text-gray-400">
                            ({form.packages.find((p) => p.id === entry.productPackageId)?.packageName || "Package"})
                          </span>
                        )}
                      </span>
                      <span className="rounded-full bg-green-50 px-3 py-0.5 text-sm font-medium text-green-700">RM{entry.price.toFixed(2)}</span>
                      <button onClick={() => removeSupplierEntry(i)} className="text-gray-400 hover:text-red-500">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add existing supplier */}
              {!showNewSupplier && (
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500">Supplier</label>
                    <select
                      className="mt-1 h-10 w-full rounded-md border border-gray-200 px-3 text-sm"
                      value={selectedSupplierId}
                      onChange={(e) => setSelectedSupplierId(e.target.value)}
                    >
                      <option value="">Select supplier...</option>
                      {supplierOptions.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  {form.packages.length > 0 && (
                    <div className="w-36">
                      <label className="text-xs text-gray-500">Package</label>
                      <select
                        id="perishable-supplier-pkg-select"
                        className="mt-1 h-10 w-full rounded-md border border-gray-200 px-3 text-sm"
                        defaultValue=""
                      >
                        <option value="">Base ({form.baseUom})</option>
                        {form.packages.map((pkg, i) => (
                          <option key={i} value={pkg.id || `new-${i}`}>{pkg.packageName}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="w-32">
                    <label className="text-xs text-gray-500">Price (RM)</label>
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={supplierPrice}
                      onChange={(e) => setSupplierPrice(e.target.value)}
                      className="mt-1 h-10"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10"
                    onClick={addExistingSupplier}
                    disabled={!selectedSupplierId || !supplierPrice}
                  >
                    Add
                  </Button>
                </div>
              )}

              {/* New supplier toggle */}
              {!showNewSupplier ? (
                <button
                  type="button"
                  onClick={() => setShowNewSupplier(true)}
                  className="mt-3 text-sm text-terracotta hover:underline"
                >
                  + Create New Supplier
                </button>
              ) : (
                <div className="mt-3 space-y-3 rounded-lg border border-dashed border-gray-300 bg-white p-4">
                  <p className="text-sm font-medium text-gray-700">New Supplier</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500">Supplier Name</label>
                      <Input
                        placeholder="e.g. Jinka Supply"
                        value={newSupplierName}
                        onChange={(e) => setNewSupplierName(e.target.value)}
                        className="mt-1 h-10"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Phone (optional)</label>
                      <Input
                        placeholder="e.g. 012-3456789"
                        value={newSupplierPhone}
                        onChange={(e) => setNewSupplierPhone(e.target.value)}
                        className="mt-1 h-10"
                      />
                    </div>
                  </div>
                  <div className="flex items-end gap-3">
                    <div className="w-32">
                      <label className="text-xs text-gray-500">Price (RM)</label>
                      <Input
                        type="number"
                        placeholder="0.00"
                        value={supplierPrice}
                        onChange={(e) => setSupplierPrice(e.target.value)}
                        className="mt-1 h-10"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10"
                      onClick={addNewSupplier}
                      disabled={!newSupplierName || !supplierPrice}
                    >
                      Add
                    </Button>
                    <button
                      type="button"
                      onClick={() => { setShowNewSupplier(false); setNewSupplierName(""); setNewSupplierPhone(""); }}
                      className="text-sm text-gray-400 hover:text-gray-600"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            <Button onClick={handleSubmit} disabled={saving || !form.name || !form.sku || !form.groupId} className="h-11 w-full bg-terracotta text-base hover:bg-terracotta-dark disabled:opacity-50">
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {editingId ? "Save Changes" : "Add Perishable"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
