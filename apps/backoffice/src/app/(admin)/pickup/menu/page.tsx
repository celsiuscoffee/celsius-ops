"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { Plus, Search, RefreshCw, Pencil, Trash2, Loader2, X, ZoomIn, Star, GripVertical } from "lucide-react";
import { useConfirm, toast } from "@celsius/ui";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { AvailabilityMatrix } from "./_AvailabilityMatrix";
import type { ModifierGroup } from "./_ModifierGroupsEditor";
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
  featured_position: number;
}

interface Category { id: string; name: string; slug: string; position?: number }

const BEST_SELLERS_ID = "__best_sellers__";

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
        className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-[#160800] -ml-1 touch-none"
        title="Drag to reorder"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      {children}
    </div>
  );
}

export default function PickupMenu() {
  // Catalog = product CRUD; Availability = per-outlet on/off matrix.
  const [view,       setView]       = useState<"catalog" | "availability">("catalog");
  const [products,   setProducts]   = useState<DbProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState("");
  const [catFilter,  setCatFilter]  = useState("all");
  const { confirm, ConfirmDialog } = useConfirm();
  const [deleting,   setDeleting]   = useState<string | null>(null);
  const [toggling,   setToggling]   = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [togglingPopular, setTogglingPopular] = useState<string | null>(null);

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

  const inBestSellers = catFilter === BEST_SELLERS_ID;

  const filtered = products.filter((p) => {
    const matchCat = catFilter === "all"
      || (inBestSellers ? p.is_popular : p.category_id === catFilter);
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

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
      {/* Tabs */}
      <div className="flex gap-1 bg-white rounded-xl p-1 w-fit border border-border/40">
        <button
          type="button"
          onClick={() => setView("catalog")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            view === "catalog"
              ? "bg-[#160800] text-white shadow-sm"
              : "text-muted-foreground hover:text-[#160800]"
          }`}
        >
          Catalog
        </button>
        <button
          type="button"
          onClick={() => setView("availability")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            view === "availability"
              ? "bg-[#160800] text-white shadow-sm"
              : "text-muted-foreground hover:text-[#160800]"
          }`}
        >
          Availability
        </button>
      </div>

      {view === "availability" && <AvailabilityMatrix />}
      {view === "catalog" && (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-[#160800]">Products</h1>
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
              <Link
                href="/pickup/menu/new"
                className="flex items-center gap-2 bg-[#160800] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#2d1100] transition-colors"
              >
                <Plus className="h-4 w-4" /> Add Product
              </Link>
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
                          {p.modifiers.map((g) => g.name).filter(Boolean).join(" · ")}
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
                      <Link
                        href={`/pickup/menu/${p.id}`}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-[#160800] hover:bg-muted/50 transition-colors"
                        title="Edit product"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Link>
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
        </>
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
    </div>
  );
}
