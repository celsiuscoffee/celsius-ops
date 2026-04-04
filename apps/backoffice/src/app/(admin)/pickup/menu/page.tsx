"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Plus, Search, RefreshCw, Pencil, Trash2, Loader2, X, Check, CloudDownload, ImagePlus, ZoomIn, ArrowUp, ArrowDown, Star } from "lucide-react";
import { adminFetch } from "@/lib/pickup/admin-fetch";

interface ModifierOption {
  id: string;
  label: string;
  priceDelta: number;
  isDefault: boolean;
}

interface ModifierGroup {
  id: string;
  name: string;
  multiSelect: boolean;
  options: ModifierOption[];
}

interface DbProduct {
  id: string;
  category_id: string;
  name: string;
  description: string;
  base_price: number;   // sen
  image: string;
  image_zoom: number;   // 50-200, default 100
  is_available: boolean;
  is_popular: boolean;
  is_new: boolean;
  variants: { id: string; name: string; price: number }[];
  modifiers: ModifierGroup[];
  position: number;
}

interface Category { id: string; name: string; slug: string }

function emptyForm(categories: Category[]) {
  return {
    id:            "",
    category_id:   categories[0]?.id ?? "",
    name:          "",
    description:   "",
    base_price_rm: 10,
    image:         "",
    image_zoom:    100,
    is_available:  true,
    is_popular:    false,
    is_new:        false,
  };
}

export default function PickupMenu() {
  const [products,   setProducts]   = useState<DbProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState("");
  const [catFilter,  setCatFilter]  = useState("all");
  const [showForm,   setShowForm]   = useState(false);
  const [editing,    setEditing]    = useState<DbProduct | null>(null);
  const [form,       setForm]       = useState(() => emptyForm([]));
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [deleting,   setDeleting]   = useState<string | null>(null);
  const [toggling,   setToggling]   = useState<string | null>(null);
  const [syncing,    setSyncing]    = useState(false);
  const [syncResult, setSyncResult] = useState<{ products: number; categories: number } | null>(null);
  const [uploading,  setUploading]  = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [reordering, setReordering] = useState<string | null>(null);
  const [togglingPopular, setTogglingPopular] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const closeZoom = useCallback(() => setZoomedImage(null), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") closeZoom(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeZoom]);

  async function load() {
    setLoading(true);
    const [prodRes, catRes] = await Promise.all([
      adminFetch("/api/pickup/products"),
      fetch("/api/storehub/products"),
    ]);
    const prods = await prodRes.json() as DbProduct[] | null;
    const menu  = await catRes.json() as { categories: Category[] };
    setProducts(Array.isArray(prods) ? prods : []);
    setCategories(menu.categories ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setEditing(null);
    setForm(emptyForm(categories));
    setPreviewZoom(100);
    setShowForm(true);
  }

  function openEdit(p: DbProduct) {
    setEditing(p);
    const zoom = p.image_zoom ?? 100;
    setForm({
      id:            p.id,
      category_id:   p.category_id,
      name:          p.name,
      description:   p.description,
      base_price_rm: p.base_price / 100,
      image:         p.image,
      image_zoom:    zoom,
      is_available:  p.is_available,
      is_popular:    p.is_popular,
      is_new:        p.is_new,
    });
    setPreviewZoom(zoom);
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);

    const body = {
      ...form,
      base_price_rm: form.base_price_rm,
    };

    if (editing) {
      await adminFetch(`/api/pickup/products/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setProducts((prev) => prev.map((p) =>
        p.id === editing.id
          ? { ...p, name: form.name, description: form.description, base_price: Math.round(form.base_price_rm * 100), image: form.image, image_zoom: form.image_zoom, is_available: form.is_available, is_popular: form.is_popular, is_new: form.is_new, category_id: form.category_id }
          : p
      ));
    } else {
      await adminFetch("/api/pickup/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await load();
      setShowForm(false);
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this product?")) return;
    setDeleting(id);
    await adminFetch(`/api/pickup/products/${id}`, { method: "DELETE" });
    setProducts((prev) => prev.filter((p) => p.id !== id));
    setDeleting(null);
  }

  async function toggleAvailable(p: DbProduct) {
    setToggling(p.id);
    setProducts((prev) => prev.map((x) => x.id === p.id ? { ...x, is_available: !p.is_available } : x));
    await adminFetch(`/api/pickup/products/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_available: !p.is_available }),
    });
    setToggling(null);
  }

  async function togglePopular(p: DbProduct) {
    setTogglingPopular(p.id);
    setProducts((prev) => prev.map((x) => x.id === p.id ? { ...x, is_popular: !p.is_popular } : x));
    await adminFetch(`/api/pickup/products/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_popular: !p.is_popular }),
    });
    setTogglingPopular(null);
  }

  async function moveProduct(p: DbProduct, direction: "up" | "down", categoryItems: DbProduct[]) {
    const idx = categoryItems.findIndex((x) => x.id === p.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= categoryItems.length) return;
    const other = categoryItems[swapIdx];
    setReordering(p.id);
    const newPosP     = other.position;
    const newPosOther = p.position;
    setProducts((prev) => prev.map((x) => {
      if (x.id === p.id)     return { ...x, position: newPosP };
      if (x.id === other.id) return { ...x, position: newPosOther };
      return x;
    }));
    await Promise.all([
      adminFetch(`/api/pickup/products/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position: newPosP }),
      }),
      adminFetch(`/api/pickup/products/${other.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position: newPosOther }),
      }),
    ]);
    await load();
    setReordering(null);
  }

  async function syncFromStoreHub() {
    setSyncing(true);
    setSyncResult(null);
    const res = await adminFetch("/api/pickup/sync-storehub", { method: "POST" });
    const json = await res.json() as { ok?: boolean; error?: string; synced?: { products: number; categories: number } };
    if (!res.ok || json.error) {
      alert(json.error ?? "Sync failed");
    } else {
      setSyncResult(json.synced ?? null);
      await load();
      setTimeout(() => setSyncResult(null), 4000);
    }
    setSyncing(false);
  }

  async function handleImageUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("productId", form.name.replace(/\s+/g, "-").toLowerCase() || "product");

      const res  = await fetch("/api/pickup/upload-image", { method: "POST", body: fd });
      const json = await res.json() as { url?: string; error?: string };

      if (json.url) setForm((f) => ({ ...f, image: json.url! }));
      else alert(json.error ?? "Upload failed");
    } catch (e) {
      alert("Upload failed: " + String(e));
    }
    setUploading(false);
  }

  const filtered = products.filter((p) => {
    const matchCat    = catFilter === "all" || p.category_id === catFilter;
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const grouped = categories
    .map((cat) => ({ cat, items: filtered.filter((p) => p.category_id === cat.id) }))
    .filter(({ items }) => items.length > 0);

  const unavailableCount = products.filter((p) => !p.is_available).length;

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#160800]">Pickup Menu</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {products.length} items · {unavailableCount} unavailable
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-[#160800] transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={syncFromStoreHub}
            disabled={syncing}
            className="flex items-center gap-2 border border-[#160800] text-[#160800] px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#160800]/5 transition-colors disabled:opacity-50"
          >
            {syncing
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : syncResult
              ? <Check className="h-4 w-4 text-green-600" />
              : <CloudDownload className="h-4 w-4" />}
            {syncing ? "Syncing..." : syncResult ? `Synced ${syncResult.products} products` : "Sync StoreHub"}
          </button>
          <button
            onClick={openNew}
            className="flex items-center gap-2 bg-[#160800] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#2d1100] transition-colors"
          >
            <Plus className="h-4 w-4" /> Add Product
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl p-4 flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          className="border rounded-xl px-3 py-2 text-sm focus:outline-none"
        >
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Product list */}
      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ cat, items }) => (
            <div key={cat.id} className="bg-white rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b bg-muted/20">
                <h2 className="font-bold text-sm text-muted-foreground uppercase tracking-wide">{cat.name}</h2>
              </div>
              <div className="divide-y">
                {items.map((p, pIdx) => (
                  <div key={p.id} className="flex items-center gap-4 px-5 py-3.5">
                    {/* Up/down reorder buttons */}
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        onClick={() => moveProduct(p, "up", items)}
                        disabled={pIdx === 0 || reordering === p.id}
                        className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-[#160800] hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="Move up"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => moveProduct(p, "down", items)}
                        disabled={pIdx === items.length - 1 || reordering === p.id}
                        className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-[#160800] hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="Move down"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    </div>
                    {p.image && (
                      <button
                        type="button"
                        onClick={() => setZoomedImage(p.image)}
                        className="relative w-10 h-10 rounded-lg overflow-hidden shrink-0 group focus:outline-none"
                        title="Click to zoom"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.image} alt={p.name} className="w-full h-full object-cover" style={{ transform: `scale(${(p.image_zoom ?? 100) / 100})`, transformOrigin: "center" }} />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                          <ZoomIn className="h-3.5 w-3.5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </button>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className={`text-sm font-semibold ${!p.is_available ? "text-muted-foreground line-through" : "text-[#160800]"}`}>
                          {p.name}
                        </p>
                        {p.is_new     && <span className="text-[10px] font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">NEW</span>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">RM {(p.base_price / 100).toFixed(2)}</p>
                      {p.modifiers.length > 0 && (
                        <p className="text-xs text-muted-foreground/70 mt-0.5">
                          {p.modifiers.map((g) => g.name).join(" · ")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Best Seller badge toggle */}
                      <button
                        onClick={() => togglePopular(p)}
                        disabled={togglingPopular === p.id}
                        title={p.is_popular ? "Remove from Best Sellers" : "Mark as Best Seller"}
                        className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors disabled:opacity-50 ${
                          p.is_popular
                            ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                            : "bg-muted text-muted-foreground hover:bg-amber-50 hover:text-amber-600"
                        }`}
                      >
                        <Star className={`h-2.5 w-2.5 ${p.is_popular ? "fill-amber-500 text-amber-500" : ""}`} />
                        {p.is_popular ? "Best Seller" : ""}
                      </button>
                      {!p.is_available && (
                        <span className="text-[11px] font-semibold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">86&apos;d</span>
                      )}
                      <button
                        onClick={() => toggleAvailable(p)}
                        disabled={toggling === p.id}
                        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50 ${p.is_available ? "bg-green-500" : "bg-gray-300"}`}
                      >
                        <span className={`inline-block h-5 w-5 mt-0.5 rounded-full bg-white shadow transition-transform duration-200 ${p.is_available ? "translate-x-5.5" : "translate-x-0.5"}`} />
                      </button>
                      <button
                        onClick={() => openEdit(p)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-[#160800] hover:bg-muted/50 transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(p.id)}
                        disabled={deleting === p.id}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        {deleting === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {grouped.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">No products found</div>
          )}
        </div>
      )}

      {/* Image Zoom Lightbox */}
      {zoomedImage && (
        <div
          className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closeZoom}
        >
          <button
            onClick={closeZoom}
            className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomedImage}
            alt="Product zoom"
            className="max-w-full max-h-[90vh] object-contain rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Add / Edit slide-over */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => setShowForm(false)} />
          <div className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10">
              <h2 className="font-bold text-lg">{editing ? "Edit Product" : "Add Product"}</h2>
              <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-[#160800]">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Name */}
              <Field label="Name" required>
                <input
                  required
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="Celsius Latte"
                />
              </Field>

              {/* Category */}
              <Field label="Category">
                <select
                  value={form.category_id}
                  onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}
                  className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>

              {/* Description */}
              <Field label="Description">
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                  placeholder="Short description..."
                />
              </Field>

              {/* Base price */}
              <Field label="Base Price (RM)">
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  required
                  value={form.base_price_rm}
                  onChange={(e) => setForm((f) => ({ ...f, base_price_rm: Number(e.target.value) }))}
                  className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </Field>

              {/* Image */}
              <Field label="Product Image">
                <div
                  className={`flex gap-4 items-start rounded-xl transition-colors ${isDragging ? "bg-primary/10 ring-2 ring-primary/40 p-2" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file && file.type.startsWith("image/")) { handleImageUpload(file); setPreviewZoom(100); }
                  }}
                >
                  {/* Preview box */}
                  <div className="shrink-0">
                    <div className="relative w-28 h-28 rounded-xl border border-border overflow-hidden bg-muted/30">
                      {form.image ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={form.image}
                            alt="preview"
                            className="w-full h-full object-contain transition-transform duration-150"
                            style={{ transform: `scale(${previewZoom / 100})`, transformOrigin: "center" }}
                          />
                          <button
                            type="button"
                            onClick={() => { setForm((f) => ({ ...f, image: "" })); setPreviewZoom(100); }}
                            className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded-full w-5 h-5 flex items-center justify-center transition-colors"
                            title="Remove image"
                          >
                            <X className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setZoomedImage(form.image)}
                            className="absolute bottom-1 right-1 bg-black/50 hover:bg-black/70 text-white rounded-full w-5 h-5 flex items-center justify-center transition-colors"
                            title="View full size"
                          >
                            <ZoomIn className="h-2.5 w-2.5" />
                          </button>
                        </>
                      ) : uploading ? (
                        <div className="w-full h-full flex items-center justify-center">
                          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground">
                          <ImagePlus className="h-7 w-7" />
                          <span className="text-[10px]">No image</span>
                        </div>
                      )}
                    </div>
                    {form.image && (
                      <input
                        type="range"
                        min={50}
                        max={200}
                        value={previewZoom}
                        onChange={(e) => { const v = Number(e.target.value); setPreviewZoom(v); setForm((f) => ({ ...f, image_zoom: v })); }}
                        className="w-28 mt-1.5 accent-[#160800]"
                        title={`Zoom: ${previewZoom}%`}
                      />
                    )}
                  </div>

                  {/* Controls */}
                  <div className="flex-1 space-y-2 pt-0.5">
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex items-center justify-center gap-2 border border-border rounded-xl px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors disabled:opacity-50"
                    >
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                      {uploading ? "Uploading..." : isDragging ? "Drop to upload" : "Select or drag image"}
                    </button>
                    <input
                      type="url"
                      value={form.image}
                      onChange={(e) => { setForm((f) => ({ ...f, image: e.target.value })); setPreviewZoom(100); }}
                      className="w-full border rounded-xl px-3 py-2 text-xs text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="or paste image URL..."
                    />
                  </div>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) { handleImageUpload(f); setPreviewZoom(100); } e.target.value = ""; }}
                />
              </Field>

              {/* Badges */}
              <div className="grid grid-cols-3 gap-3">
                {([
                  ["is_available", "Available"],
                  ["is_popular",   "Popular"],
                  ["is_new",       "New"],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form[key]}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
                      className="h-4 w-4 accent-[#160800]"
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>

              {/* Modifier groups — read-only, synced from StoreHub */}
              {editing && editing.modifiers.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
                    Modifiers (from StoreHub)
                  </label>
                  <div className="space-y-2">
                    {editing.modifiers.map((group) => (
                      <div key={group.id} className="border rounded-xl p-3 bg-muted/20">
                        <p className="text-xs font-semibold text-[#160800] mb-1.5">
                          {group.name} {group.multiSelect ? "(multi-select)" : "(single-select)"}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {group.options.map((opt) => (
                            <span key={opt.id} className="text-xs bg-white border rounded-full px-2.5 py-1 text-muted-foreground">
                              {opt.label}{opt.priceDelta > 0 ? ` +RM${opt.priceDelta.toFixed(2)}` : ""}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    To update modifiers, use &ldquo;Sync StoreHub&rdquo; from the menu page.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                {saved && (
                  <span className="flex items-center gap-1.5 text-sm text-green-600 font-medium">
                    <Check className="h-4 w-4" /> Saved
                  </span>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 bg-[#160800] text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#2d1100] transition-colors disabled:opacity-60"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {editing ? "Save Changes" : "Create Product"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}
