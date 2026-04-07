"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useFetch } from "@/lib/use-fetch";
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
  Check,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

type PaginatedResponse<T> = { items: T[]; total: number; page: number; limit: number };
const PAGE_SIZE = 50;

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

type SupplierProduct = { id: string; productId: string; name: string; sku: string; price: number; uom: string };

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
  products: SupplierProduct[];
};

type SupplierForm = {
  name: string;
  location: string;
  phone: string;
  supplierCode: string;
  leadTimeDays: string;
  tags: string;
};

type ProductOption = { id: string; name: string; sku: string; baseUom: string };

const emptyForm: SupplierForm = { name: "", location: "", phone: "", supplierCode: "", leadTimeDays: "1", tags: "" };

export default function SuppliersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 300);

  const apiUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    params.set("page", String(page));
    params.set("limit", String(PAGE_SIZE));
    return `/api/suppliers?${params}`;
  }, [debouncedSearch, page]);

  const { data, isLoading: loading, mutate: reloadSuppliers } = useFetch<PaginatedResponse<Supplier>>(apiUrl);
  const suppliers = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Use lightweight options endpoint for product dropdown
  const { data: productOptions = [] } = useFetch<ProductOption[]>("/api/products/options");

  // Reset to page 1 when search changes
  const prevSearch = useRef(debouncedSearch);
  useEffect(() => {
    if (prevSearch.current !== debouncedSearch) {
      setPage(1);
      prevSearch.current = debouncedSearch;
    }
  }, [debouncedSearch]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SupplierForm>(emptyForm);
  const [priceDialogOpen, setPriceDialogOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [saving, setSaving] = useState(false);

  // Price list editing
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [savingPrice, setSavingPrice] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [newProductId, setNewProductId] = useState("");
  const [newPrice, setNewPrice] = useState("");

  const loadSuppliers = () => reloadSuppliers();

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
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          supplierCode: form.supplierCode || null,
          phone: form.phone || null,
          location: form.location || null,
          leadTimeDays: form.leadTimeDays ? parseInt(form.leadTimeDays) : 1,
          tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        }),
      });
      if (!res.ok) return;
      setDialogOpen(false);
      loadSuppliers();
    } finally {
      setSaving(false);
    }
  };

  const openPriceList = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setEditingPriceId(null);
    setAddingProduct(false);
    setPriceDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this supplier?")) return;
    const res = await fetch(`/api/suppliers/${id}`, { method: "DELETE" });
    if (!res.ok) { alert("Failed to delete supplier. It may have linked orders."); return; }
    loadSuppliers();
  };

  // ── Price list editing ──────────────────────────────────────────────────

  const startEditPrice = (product: SupplierProduct) => {
    setEditingPriceId(product.id);
    setEditPrice(product.price.toFixed(2));
  };

  const savePrice = async (product: SupplierProduct) => {
    if (!selectedSupplier) return;
    const price = parseFloat(editPrice);
    if (isNaN(price) || price < 0) return;
    setSavingPrice(true);
    try {
      const res = await fetch(`/api/suppliers/${selectedSupplier.id}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.productId, price }),
      });
      if (res.ok) {
        // Update local state
        setSelectedSupplier((prev) =>
          prev ? { ...prev, products: prev.products.map((p) => p.id === product.id ? { ...p, price } : p) } : prev
        );
        setEditingPriceId(null);
        loadSuppliers();
      }
    } finally {
      setSavingPrice(false);
    }
  };

  const addProduct = async () => {
    // Auto-match if user typed a product name without selecting from dropdown
    let resolvedId = newProductId;
    if (!resolvedId && productSearch.trim()) {
      const match = availableProducts.find((p) => p.name.toLowerCase() === productSearch.trim().toLowerCase());
      if (match) resolvedId = match.id;
    }
    if (!selectedSupplier || !resolvedId || !newPrice) return;
    const price = parseFloat(newPrice);
    if (isNaN(price) || price < 0) return;
    setSavingPrice(true);
    try {
      const res = await fetch(`/api/suppliers/${selectedSupplier.id}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: resolvedId, price }),
      });
      if (res.ok) {
        const newSp = await res.json();
        setSelectedSupplier((prev) =>
          prev ? { ...prev, products: [...prev.products, newSp] } : prev
        );
        setAddingProduct(false);
        setNewProductId("");
        setNewPrice("");
        setProductSearch("");
        loadSuppliers();
      }
    } finally {
      setSavingPrice(false);
    }
  };

  const removeProduct = async (sp: SupplierProduct) => {
    if (!selectedSupplier || !confirm(`Remove ${sp.name} from price list?`)) return;
    const res = await fetch(`/api/suppliers/${selectedSupplier.id}/products`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supplierProductId: sp.id }),
    });
    if (res.ok) {
      setSelectedSupplier((prev) =>
        prev ? { ...prev, products: prev.products.filter((p) => p.id !== sp.id) } : prev
      );
      loadSuppliers();
    }
  };

  // Products not yet linked to this supplier
  const availableProducts = productOptions.filter(
    (p) =>
      !selectedSupplier?.products.some((sp) => sp.productId === p.id) &&
      (!productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.sku.toLowerCase().includes(productSearch.toLowerCase()))
  );

  const updateField = (key: keyof SupplierForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Suppliers</h2>
          <p className="mt-0.5 text-sm text-gray-500">{total} suppliers with product pricing</p>
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
        {suppliers.map((supplier) => (
          <Card key={supplier.id} className="overflow-hidden">
            <div className="p-4">
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

              <div className="mt-3 flex items-center gap-3">
                {supplier.phone && (
                  <a href={`https://wa.me/${supplier.phone.replace("+", "")}`} target="_blank" className="flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs text-green-700 hover:bg-green-100">
                    <MessageCircle className="h-3 w-3" />
                    WhatsApp
                  </a>
                )}
                {supplier.phone && <span className="flex items-center gap-1 text-xs text-gray-500"><Phone className="h-3 w-3" />{supplier.phone}</span>}
                {supplier.code && <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{supplier.code}</code>}
              </div>

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
        {loading && suppliers.length === 0 && (
          <div className="col-span-2 flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <p className="text-gray-500">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-md border px-2 py-1 text-gray-500 hover:bg-gray-50 disabled:opacity-30">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 text-gray-700">Page {page} of {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="rounded-md border px-2 py-1 text-gray-500 hover:bg-gray-50 disabled:opacity-30">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

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
        <DialogContent className="max-w-lg sm:max-w-3xl overflow-visible">
          <DialogHeader>
            <DialogTitle>{selectedSupplier?.name} — Price List</DialogTitle>
          </DialogHeader>
          {selectedSupplier && (
            <div className="py-2">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-gray-500">{selectedSupplier.products.length} products</p>
                <Button size="sm" variant="outline" onClick={() => { setAddingProduct(true); setProductSearch(""); }}>
                  <Plus className="mr-1 h-3 w-3" />
                  <span className="hidden sm:inline">Add Product</span>
                  <span className="sm:hidden">Add</span>
                </Button>
              </div>

              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Product</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500 hidden sm:table-cell">SKU</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Package</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500 whitespace-nowrap">Price (RM)</th>
                      <th className="px-3 py-2 w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSupplier.products.length === 0 && !addingProduct && (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-400">
                          No products linked. Click &quot;Add Product&quot; to add one.
                        </td>
                      </tr>
                    )}
                    {selectedSupplier.products.map((p) => (
                      <tr key={p.id} className="border-b border-gray-50">
                        <td className="px-3 py-2 text-gray-900">
                          <span className="block truncate max-w-[180px] sm:max-w-none">{p.name}</span>
                          <span className="block text-xs text-gray-400 sm:hidden">{p.sku}</span>
                        </td>
                        <td className="px-3 py-2 hidden sm:table-cell"><code className="rounded bg-gray-100 px-1 text-xs">{p.sku}</code></td>
                        <td className="px-3 py-2 text-gray-600">{p.uom}</td>
                        <td className="px-3 py-2 text-right">
                          {editingPriceId === p.id ? (
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={editPrice}
                              onChange={(e) => setEditPrice(e.target.value)}
                              className="w-20 rounded border border-gray-300 px-2 py-0.5 text-right text-sm"
                              autoFocus
                              onKeyDown={(e) => { if (e.key === "Enter") savePrice(p); if (e.key === "Escape") setEditingPriceId(null); }}
                            />
                          ) : (
                            <span className="font-medium text-gray-900">{p.price.toFixed(2)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {editingPriceId === p.id ? (
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => savePrice(p)} disabled={savingPrice} className="text-green-600 hover:text-green-700">
                                {savingPrice ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                              </button>
                              <button onClick={() => setEditingPriceId(null)} className="text-gray-400 hover:text-gray-600">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => startEditPrice(p)} className="text-gray-400 hover:text-gray-600">
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button onClick={() => removeProduct(p)} className="text-gray-400 hover:text-red-500">
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}

                    {/* Add product row */}
                    {addingProduct && (
                      <tr className="border-t border-gray-200 bg-gray-50/50">
                        <td colSpan={5} className="px-3 py-3">
                          <div className="flex items-center gap-3">
                            <div className="relative flex-1">
                              <input
                                type="text"
                                placeholder="Search product..."
                                value={productSearch}
                                onChange={(e) => { setProductSearch(e.target.value); setNewProductId(""); }}
                                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta/30"
                                autoFocus
                              />
                              {productSearch.length >= 2 && !newProductId && availableProducts.length > 0 && (
                                <div className="absolute z-50 bottom-full mb-1 max-h-48 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                                  {availableProducts.slice(0, 10).map((p) => (
                                    <button
                                      key={p.id}
                                      onClick={() => { setNewProductId(p.id); setProductSearch(p.name); }}
                                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-terracotta/5"
                                    >
                                      <span className="font-medium text-gray-900">{p.name}</span>
                                      <span className="text-xs text-gray-400">{p.sku} · {p.baseUom}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                              {newProductId && (
                                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                                  <Check className="h-4 w-4 text-green-500" />
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-gray-400 whitespace-nowrap">RM</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="0.00"
                                value={newPrice}
                                onChange={(e) => setNewPrice(e.target.value)}
                                className="w-24 rounded-md border border-gray-300 px-3 py-2 text-right text-sm focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta/30"
                                onKeyDown={(e) => { if (e.key === "Enter") addProduct(); }}
                              />
                            </div>
                            <div className="flex items-center gap-1">
                              <button onClick={addProduct} disabled={(!newProductId && !availableProducts.some((p) => p.name.toLowerCase() === productSearch.trim().toLowerCase())) || !newPrice || savingPrice} className="rounded-md bg-green-50 p-1.5 text-green-600 hover:bg-green-100 hover:text-green-700 disabled:opacity-30 disabled:hover:bg-green-50">
                                {savingPrice ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                              </button>
                              <button onClick={() => { setAddingProduct(false); setProductSearch(""); setNewProductId(""); setNewPrice(""); }} className="rounded-md bg-gray-50 p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
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
