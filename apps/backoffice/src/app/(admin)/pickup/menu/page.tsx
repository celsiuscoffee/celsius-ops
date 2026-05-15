"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Plus, Search, RefreshCw, Pencil, Trash2, Loader2, X, Check, CloudDownload, ImagePlus, ZoomIn, Star, GripVertical } from "lucide-react";
import { useConfirm, toast } from "@celsius/ui";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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
  hidden_modifier_ids: string[];
  position: number;
  featured_position: number;
}

interface Category { id: string; name: string; slug: string; position?: number }

const BEST_SELLERS_ID = "__best_sellers__";

// ─── Sortable wrappers ──────────────────────────────────────────────
// Drag-and-drop powered by @dnd-kit. Each wrapper wires the drag
// handle + ref + transform, then renders the visible row content as
// children. The handle is a small grip icon on the left edge — only
// the handle starts a drag, so clicks on edit/toggle/etc. buttons
// inside the row are unaffected.

function SortableCategoryHeader({ id, name, children }: { id: string; name: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
    position: "relative",
  };
  return (
    <div ref={setNodeRef} style={style} className="bg-white rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b bg-muted/20 flex items-center gap-3">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-[#160800] -ml-1 touch-none"
          title="Drag to reorder category"
          aria-label="Drag to reorder category"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <h2 className="font-bold text-sm text-muted-foreground uppercase tracking-wide">{name}</h2>
      </div>
      {children}
    </div>
  );
}

function SortableProductRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    background: isDragging ? "#fff" : undefined,
    zIndex: isDragging ? 10 : undefined,
    position: "relative",
  };
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-4 px-5 py-3.5 bg-white">
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-[#160800] -ml-1 shrink-0 touch-none"
        title="Drag to reorder"
        aria-label="Drag to reorder product"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      {children}
    </div>
  );
}

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
  const { confirm, ConfirmDialog } = useConfirm();
  const [saved,      setSaved]      = useState(false);
  const [deleting,   setDeleting]   = useState<string | null>(null);
  const [toggling,   setToggling]   = useState<string | null>(null);
  const [syncing,    setSyncing]    = useState(false);
  const [syncResult, setSyncResult] = useState<{ products: number; categories: number } | null>(null);
  const [uploading,  setUploading]  = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [previewZoom, setPreviewZoom] = useState(100);
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
    const res = await adminFetch("/api/pickup/products");
    const json = await res.json() as { products: DbProduct[]; categories: Category[] };
    setProducts(Array.isArray(json.products) ? json.products : []);
    setCategories(json.categories ?? []);
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
    if (!(await confirm({ title: "Delete this product?", confirmLabel: "Delete", destructive: true }))) return;
    setDeleting(id);
    await adminFetch(`/api/pickup/products/${id}`, { method: "DELETE" });
    setProducts((prev) => prev.filter((p) => p.id !== id));
    toast.success("Product deleted");
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

  // Hide / restore a single modifier group or option ID. Updates the local
  // product immediately, then PATCHes the full hidden list to the server so
  // the change survives a re-sync from StoreHub.
  async function toggleHideModifier(productId: string, modifierId: string) {
    const prod = products.find((p) => p.id === productId);
    if (!prod) return;
    const current = prod.hidden_modifier_ids ?? [];
    const next = current.includes(modifierId)
      ? current.filter((x) => x !== modifierId)
      : [...current, modifierId];
    // Optimistic update on both the list and the open editor view.
    setProducts((prev) => prev.map((x) => x.id === productId ? { ...x, hidden_modifier_ids: next } : x));
    setEditing((cur) => (cur && cur.id === productId ? { ...cur, hidden_modifier_ids: next } : cur));
    const res = await adminFetch(`/api/pickup/products/${productId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden_modifier_ids: next }),
    });
    if (!res.ok) {
      toast.error("Failed to save");
      // Rollback
      setProducts((prev) => prev.map((x) => x.id === productId ? { ...x, hidden_modifier_ids: current } : x));
      setEditing((cur) => (cur && cur.id === productId ? { ...cur, hidden_modifier_ids: current } : cur));
    }
  }

  // Drag-and-drop sensors. PointerSensor requires 8px of movement
  // before activating so clicking on the row (edit/toggle/etc.)
  // doesn't accidentally start a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function handleProductDragEnd(
    event: DragEndEvent,
    items: DbProduct[],
    field: "position" | "featured_position",
  ) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((p) => p.id === active.id);
    const newIndex = items.findIndex((p) => p.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const newOrder = arrayMove(items, oldIndex, newIndex);
    const newPosById = new Map(newOrder.map((p, i) => [p.id, i + 1]));
    // Optimistic local update — don't await /load(), the server PATCH
    // is fire-and-forget for UI snappiness. If it fails we'll surface
    // a toast and let the next load reconcile.
    setProducts((prev) => prev.map((p) =>
      newPosById.has(p.id) ? { ...p, [field]: newPosById.get(p.id)! } : p
    ));
    const res = await adminFetch("/api/pickup/products/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: newOrder.map((p) => p.id), field }),
    });
    if (!res.ok) {
      toast.error("Reorder failed — refresh to reload");
    }
  }

  async function handleCategoryDragEnd(event: DragEndEvent, visibleCats: Category[]) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = visibleCats.findIndex((c) => c.id === active.id);
    const newIndex = visibleCats.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const newOrder = arrayMove(visibleCats, oldIndex, newIndex);
    const newPosById = new Map(newOrder.map((c, i) => [c.id, i + 1]));
    setCategories((prev) =>
      prev
        .map((c) => ({ ...c, position: newPosById.get(c.id) ?? c.position ?? 9999 }))
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    );
    const res = await adminFetch("/api/pickup/categories/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: newOrder.map((c) => c.id) }),
    });
    if (!res.ok) {
      toast.error("Category reorder failed — refresh to reload");
    }
  }

  async function syncFromStoreHub() {
    setSyncing(true);
    setSyncResult(null);
    const res = await adminFetch("/api/pickup/sync-storehub", { method: "POST" });
    const json = await res.json() as { ok?: boolean; error?: string; synced?: { products: number; categories: number } };
    if (!res.ok || json.error) {
      toast.error(json.error ?? "Sync failed");
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
      else toast.error(json.error ?? "Upload failed");
    } catch (e) {
      toast.error("Upload failed: " + String(e));
    }
    setUploading(false);
  }

  const inBestSellers = catFilter === BEST_SELLERS_ID;

  const filtered = products.filter((p) => {
    const matchCat = catFilter === "all"
      || (inBestSellers ? p.is_popular : p.category_id === catFilter);
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  // Best Sellers view: one flat list across all categories, ordered by
  // featured_position. Reorder arrows update featured_position (the
  // independent "rank in Best Sellers" — separate from per-category
  // position which still drives the customer's category browsing).
  const grouped = inBestSellers
    ? [{
        cat: { id: BEST_SELLERS_ID, name: "Best Sellers", slug: "best-sellers" } as Category,
        items: [...filtered].sort((a, b) =>
          a.featured_position - b.featured_position || a.name.localeCompare(b.name)
        ),
      }]
    : categories
        .map((cat) => ({ cat, items: filtered.filter((p) => p.category_id === cat.id) }))
        .filter(({ items }) => items.length > 0);

  const unavailableCount = products.filter((p) => !p.is_available).length;

  return (
    <div className="p-3 sm:p-6 space-y-5 max-w-4xl">
      <ConfirmDialog />
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#160800]">Pickup Menu</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {products.length} {products.length === 1 ? 'item' : 'items'} · {unavailableCount} unavailable
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
            {syncing ? "Syncing..." : syncResult ? `Synced ${syncResult.products} ${syncResult.products === 1 ? 'product' : 'products'}` : "Sync StoreHub"}
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
          <option value={BEST_SELLERS_ID}>★ Best Sellers (order)</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Product list */}
      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
      ) : (
        <div className="space-y-4">
          {(() => {
            // Categories are draggable only in the default "all + no
            // search" view. In single-category filter or Best Sellers
            // the drag would mean nothing; we just render the heading
            // without a drag handle but still let products drag.
            const canDragCategories = !inBestSellers && catFilter === "all" && !search;
            const productField: "position" | "featured_position" = inBestSellers ? "featured_position" : "position";

            const renderProductRowContent = (p: DbProduct) => (
              <>
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
                    {p.is_new && <span className="text-[10px] font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">NEW</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">RM {(p.base_price / 100).toFixed(2)}</p>
                  {p.modifiers.length > 0 && (
                    <p className="text-xs text-muted-foreground/70 mt-0.5">
                      {p.modifiers.map((g) => g.name).join(" · ")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
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
              </>
            );

            const productsList = (items: DbProduct[]) => (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(e) => handleProductDragEnd(e, items, productField)}
              >
                <SortableContext items={items.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                  <div className="divide-y">
                    {items.map((p) => (
                      <SortableProductRow key={p.id} id={p.id}>
                        {renderProductRowContent(p)}
                      </SortableProductRow>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            );

            const categoryCards = grouped.map(({ cat, items }) =>
              canDragCategories ? (
                <SortableCategoryHeader key={cat.id} id={cat.id} name={cat.name}>
                  {productsList(items)}
                </SortableCategoryHeader>
              ) : (
                <div key={cat.id} className="bg-white rounded-2xl overflow-hidden">
                  <div className="px-5 py-3 border-b bg-muted/20">
                    <h2 className="font-bold text-sm text-muted-foreground uppercase tracking-wide">{cat.name}</h2>
                  </div>
                  {productsList(items)}
                </div>
              )
            );

            if (canDragCategories) {
              const visibleCats = grouped.map((g) => g.cat);
              return (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(e) => handleCategoryDragEnd(e, visibleCats)}
                >
                  <SortableContext items={visibleCats.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-4">{categoryCards}</div>
                  </SortableContext>
                </DndContext>
              );
            }
            return <>{categoryCards}</>;
          })()}
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

              {/* Modifier groups — synced from StoreHub. Each group + option
                  can be hidden from customers without losing the underlying
                  StoreHub data; sync re-pulls all modifiers but the hidden
                  list survives. Hidden items render with a strikethrough +
                  "Restore" affordance instead of "Hide". */}
              {editing && editing.modifiers.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
                    Modifiers (from StoreHub)
                  </label>
                  <div className="space-y-2">
                    {editing.modifiers.map((group) => {
                      const hidden = editing.hidden_modifier_ids ?? [];
                      const groupHidden = hidden.includes(group.id);
                      return (
                        <div
                          key={group.id}
                          className={`border rounded-xl p-3 ${groupHidden ? "bg-red-50/40 border-red-200/60" : "bg-muted/20"}`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <p className={`text-xs font-semibold ${groupHidden ? "text-red-600 line-through" : "text-[#160800]"}`}>
                              {group.name} {group.multiSelect ? "(multi-select)" : "(single-select)"}
                            </p>
                            <button
                              type="button"
                              onClick={() => toggleHideModifier(editing.id, group.id)}
                              className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full transition-colors ${
                                groupHidden
                                  ? "bg-white border border-[#160800]/20 text-[#160800] hover:bg-[#160800]/5"
                                  : "bg-white border border-red-200 text-red-600 hover:bg-red-50"
                              }`}
                            >
                              {groupHidden ? <RefreshCw className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />}
                              {groupHidden ? "Restore" : "Hide group"}
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {group.options.map((opt) => {
                              const optHidden = groupHidden || hidden.includes(opt.id);
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onClick={() => !groupHidden && toggleHideModifier(editing.id, opt.id)}
                                  disabled={groupHidden}
                                  className={`group flex items-center gap-1 text-xs border rounded-full px-2.5 py-1 transition-colors ${
                                    optHidden
                                      ? "bg-red-50/70 border-red-200 text-red-500 line-through"
                                      : "bg-white border-border text-muted-foreground hover:border-red-300 hover:text-red-600"
                                  } ${groupHidden ? "opacity-60 cursor-not-allowed" : ""}`}
                                  title={groupHidden ? "Restore the group first" : optHidden ? "Click to restore" : "Click to hide this option"}
                                >
                                  <span>{opt.label}{opt.priceDelta > 0 ? ` +RM${opt.priceDelta.toFixed(2)}` : ""}</span>
                                  {!groupHidden && (
                                    optHidden
                                      ? <RefreshCw className="h-3 w-3" />
                                      : <X className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Hide noisy or off-menu modifiers. Sync StoreHub keeps the underlying data fresh; your hidden list is preserved.
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
