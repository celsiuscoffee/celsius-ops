"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Search, Pencil, Trash2, Package, ChevronDown, Loader2 } from "lucide-react";

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
  description: string;
};

const emptyForm: ProductForm = { name: "", sku: "", categoryId: "", baseUom: "", storageArea: "", shelfLifeDays: "", description: "" };

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const [saving, setSaving] = useState(false);

  const loadProducts = () => {
    fetch("/api/products")
      .then((res) => res.json())
      .then((data) => { setProducts(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    loadProducts();
    fetch("/api/categories").then((r) => r.json()).then((data) => setCategoryOptions(data));
  }, []);

  const handleSubmit = async () => {
    if (!form.name || !form.sku || !form.categoryId) return;
    setSaving(true);
    try {
      const url = editingId ? `/api/products/${editingId}` : "/api/products";
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
    await fetch(`/api/products/${id}`, { method: "DELETE" });
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
      description: product.description || "",
    });
    setEditingId(product.id);
    setDialogOpen(true);
  };

  const updateField = (key: keyof ProductForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
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
      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left font-medium text-gray-500">Product</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">SKU</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Category</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Base UOM</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Storage</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Packages</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Suppliers</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-terracotta" />
                  <p className="mt-2 text-sm text-gray-500">Loading products...</p>
                </td>
              </tr>
            )}
            {!loading && filtered.map((product) => (
              <tr
                key={product.id}
                className="border-b border-gray-50 transition-colors hover:bg-gray-50/50"
              >
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

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
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
                <select
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                  value={form.storageArea}
                  onChange={(e) => updateField("storageArea", e.target.value)}
                >
                  <option value="">Select...</option>
                  <option value="FRIDGE">Fridge</option>
                  <option value="DRY_STORE">Dry Store</option>
                  <option value="COUNTER">Counter</option>
                </select>
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
