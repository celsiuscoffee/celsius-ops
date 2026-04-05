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
import { Plus, Search, Pencil, Trash2, Package, ChevronDown, Loader2, CheckSquare, X } from "lucide-react";

type Product = {
  id: string;
  name: string;
  sku: string;
  category: string;
  categoryId: string;
  baseUom: string;
  storageArea: string;
  shelfLifeDays: number | null;
  description: string;
  checkFrequency: string;
  packages: { name: string; uom: string; label: string; conversion: number }[];
  suppliers: { name: string; price: number; uom: string }[];
};

type CategoryOption = { id: string; name: string };

type ProductForm = {
  name: string;
  sku: string;
  categoryId: string;
  baseUom: string;
  storageArea: string;
  shelfLifeDays: string;
  checkFrequency: string;
  description: string;
};

const STORAGE_AREAS = ["FRIDGE", "FREEZER", "DRY_STORE", "COUNTER", "BAR"];

const emptyForm: ProductForm = { name: "", sku: "", categoryId: "", baseUom: "", storageArea: "", shelfLifeDays: "", checkFrequency: "MONTHLY", description: "" };

export default function ProductsPage() {
  const { data: products = [], isLoading: loading, mutate: reloadProducts } = useFetch<Product[]>("/api/inventory/products");
  const { data: categoryOptions = [] } = useFetch<CategoryOption[]>("/api/inventory/categories");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);

  const loadProducts = () => reloadProducts();

  const handleSubmit = async () => {
    if (!form.name || !form.sku || !form.categoryId) return;
    setSaving(true);
    try {
      const url = editingId ? `/api/inventory/products/${editingId}` : "/api/inventory/products";
      const method = editingId ? "PATCH" : "POST";
      await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          sku: form.sku,
          categoryId: form.categoryId,
          baseUom: form.baseUom,
          storageArea: form.storageArea || null,
          shelfLifeDays: form.shelfLifeDays || null,
          description: form.description || null,
          checkFrequency: form.checkFrequency,
        }),
      });
      setDialogOpen(false);
      loadProducts();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this product?")) return;
    const res = await fetch(`/api/inventory/products/${id}`, { method: "DELETE" });
    if (!res.ok) { alert("Failed to delete product. It may be linked to orders or recipes."); return; }
    loadProducts();
  };

  const categories = ["All", ...new Set(products.map((p) => p.category).filter(Boolean))].sort();

  const filtered = products.filter((p) => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase());
    const matchCategory = categoryFilter === "All" || p.category === categoryFilter;
    return matchSearch && matchCategory;
  });

  const openAdd = () => {
    setForm(emptyForm);
    setEditingId(null);
    setDialogOpen(true);
  };

  const openEdit = (product: Product) => {
    setForm({
      name: product.name,
      sku: product.sku,
      categoryId: product.categoryId,
      baseUom: product.baseUom,
      storageArea: product.storageArea || "",
      shelfLifeDays: product.shelfLifeDays?.toString() || "",
      checkFrequency: product.checkFrequency || "MONTHLY",
      description: product.description || "",
    });
    setEditingId(product.id);
    setDialogOpen(true);
  };

  const updateField = (key: keyof ProductForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
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
      alert(`Updated ${result.updated} products`);
      clearSelection();
      reloadProducts();
    } finally {
      setBulkSaving(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} products? This cannot be undone.`)) return;
    setBulkSaving(true);
    try {
      const res = await fetch("/api/inventory/products/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) { alert("Bulk delete failed. Some products may be linked to orders."); return; }
      const result = await res.json();
      alert(`Deleted ${result.deleted} products`);
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
          <h2 className="text-xl font-semibold text-gray-900">Products</h2>
          <p className="mt-0.5 text-sm text-gray-500">{products.length} products across {new Set(products.map((p) => p.category)).size} categories</p>
        </div>
        <Button onClick={openAdd} className="bg-terracotta hover:bg-terracotta-dark">
          <Plus className="mr-1.5 h-4 w-4" />
          Add Product
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
          {categories.slice(0, 12).map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                categoryFilter === cat
                  ? "border-terracotta bg-terracotta/5 text-terracotta-dark"
                  : "border-gray-200 text-gray-500 hover:bg-gray-50"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white">
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
              <th className="px-4 py-3 text-left font-medium text-gray-500">Product</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">SKU</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Category</th>
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
                  <p className="mt-2 text-sm text-gray-500">Loading products...</p>
                </td>
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
                      <Package className="h-4 w-4 text-gray-400" />
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
                    {product.category}
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
                          {pkg.name} = {pkg.uom}
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
            onClick={() => setBulkAction("category")}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Change Category
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
              {bulkAction === "category" && "Change Category"}
              {bulkAction === "storage" && "Change Storage Area"}
              {bulkAction === "frequency" && "Change Check Frequency"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-500">Apply to {selected.size} selected products</p>
          <div className="mt-2">
            {bulkAction === "category" && (
              <select
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) handleBulkUpdate({ categoryId: e.target.value });
                }}
              >
                <option value="" disabled>Select category...</option>
                {categoryOptions.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
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
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Product" : "Add Product"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Product Name</label>
                <Input
                  className="mt-1"
                  placeholder="e.g. Monin Caramel Syrup"
                  value={form.name}
                  onChange={(e) => updateField("name", e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">SKU Code</label>
                <Input
                  className="mt-1"
                  placeholder="e.g. FM001"
                  value={form.sku}
                  onChange={(e) => updateField("sku", e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Category</label>
                <select
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                  value={form.categoryId}
                  onChange={(e) => updateField("categoryId", e.target.value)}
                >
                  <option value="">Select...</option>
                  {categoryOptions.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Base UOM</label>
                <select
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                  value={form.baseUom}
                  onChange={(e) => updateField("baseUom", e.target.value)}
                >
                  <option value="">Select...</option>
                  <option value="ml">Milliliter (ml)</option>
                  <option value="g">Gram (g)</option>
                  <option value="pcs">Piece (pcs)</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Storage Area</label>
                <div className="relative mt-1">
                  <input
                    list="storage-area-options"
                    className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                    placeholder="Type or select..."
                    value={form.storageArea}
                    onChange={(e) => updateField("storageArea", e.target.value)}
                  />
                  <datalist id="storage-area-options">
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
                  className="mt-1"
                  type="number"
                  placeholder="Leave blank for non-perishable"
                  value={form.shelfLifeDays}
                  onChange={(e) => updateField("shelfLifeDays", e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Stock Check Frequency</label>
              <select
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                value={form.checkFrequency}
                onChange={(e) => updateField("checkFrequency", e.target.value)}
              >
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Description</label>
              <Input
                className="mt-1"
                placeholder="Optional notes..."
                value={form.description}
                onChange={(e) => updateField("description", e.target.value)}
              />
            </div>
            <Button onClick={handleSubmit} disabled={saving || !form.name || !form.sku || !form.categoryId} className="w-full bg-terracotta hover:bg-terracotta-dark disabled:opacity-50">
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {editingId ? "Save Changes" : "Add Product"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
