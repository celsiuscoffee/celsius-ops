"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { Plus, Search, Pencil, Trash2, Loader2, X, ZoomIn, Star, GripVertical } from "lucide-react";
import { useConfirm, toast } from "@celsius/ui";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { AvailabilityMatrix } from "./_AvailabilityMatrix";
import { KeyNumber } from "@/components/ui/key-number";
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
    <div ref={setNodeRef} style={style} className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <button
          {...attributes}
          {...listeners}
          className="-ml-1 cursor-grab touch-none p-1 text-text-3 hover:text-text active:cursor-grabbing"
          title="Drag to reorder category"
          aria-label="Drag to reorder category"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <h2 className="text-sm font-semibold text-text">{name}</h2>
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
    zIndex: isDragging ? 10 : undefined,
    position: "relative",
  };
  return (
    <div ref={setNodeRef} style={style} className={`flex items-center gap-3 px-4 py-3 ${isDragging ? "bg-raised shadow-lg" : "bg-surface"}`}>
      <button
        {...attributes}
        {...listeners}
        className="-ml-1 cursor-grab touch-none p-1 text-text-3 hover:text-text active:cursor-grabbing"
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
    if (!(await confirm({ title: "Delete this item?", confirmLabel: "Delete", destructive: true }))) return;
    setDeleting(id);
    await adminFetch(`/api/pickup/products/${id}`, { method: "DELETE" });
    setProducts((prev) => prev.filter((p) => p.id !== id));
    toast.success("Item deleted");
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
  const noPhotoCount = products.filter((p) => !p.image).length;

  return (
    <div className="max-w-[1100px] space-y-5 px-4 pt-6 pb-10 md:px-8">
      <ConfirmDialog />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Menu</h1>
          <p className="mt-0.5 text-sm text-text-2">What customers can order in the app, in what order, and what is switched off.</p>
        </div>
        <Link href="/pickup/menu/new" className="inline-flex h-10 items-center gap-1.5 self-start rounded-ctl bg-ink px-4 text-sm font-semibold text-on-ink hover:bg-ink-hover">
          <Plus className="h-4 w-4" /> Add item
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KeyNumber label="On the menu" value={loading ? null : String(products.length - unavailableCount)}
          note={<>of <b className="font-semibold text-text-2">{products.length}</b> items in {categories.length} {categories.length === 1 ? "category" : "categories"}</>} />
        <KeyNumber label="Switched off" value={loading ? null : String(unavailableCount)} tone={unavailableCount > 0 ? "warn" : undefined}
          note={unavailableCount > 0 ? "customers cannot order these" : "everything can be ordered"} />
        <KeyNumber label="Best sellers" value={loading ? null : String(products.filter((p) => p.is_popular).length)}
          note="shown first in the app" />
        <KeyNumber label="No photo" value={loading ? null : String(noPhotoCount)} tone={noPhotoCount > 0 ? "warn" : undefined}
          note={noPhotoCount > 0 ? "show as blank tiles in the app" : "every item has a photo"} />
      </div>

      <div className="flex gap-6 border-b border-line">
        {([["catalog", "All items"], ["availability", "By outlet"]] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setView(key)}
            className={`-mb-px border-b-2 pb-2.5 text-sm transition-colors ${view === key ? "border-text font-semibold text-text" : "border-transparent text-text-2 hover:text-text"}`}>
            {label}
          </button>
        ))}
      </div>

      {view === "availability" && <AvailabilityMatrix />}
      {view === "catalog" && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
              <input
                type="text"
                placeholder="Search items..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 w-full rounded-ctl border border-line bg-surface pl-9 pr-3 text-sm text-text focus:border-ink focus:outline-none"
              />
            </div>
            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className="h-10 rounded-ctl border border-line bg-surface px-3 text-sm text-text focus:outline-none"
            >
              <option value="all">All categories</option>
              <option value={BEST_SELLERS_ID}>Best sellers (set their order)</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Product list */}
          {loading ? (
            <div className="py-12 text-center text-sm text-text-3">Loading…</div>
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
                        className="group relative h-11 w-11 shrink-0 overflow-hidden rounded-ctl focus:outline-none"
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
                        <p className={`truncate text-sm font-medium ${!p.is_available ? "text-text-3" : "text-text"}`}>
                          {p.name}
                        </p>
                        {p.is_new && <span className="rounded-full bg-info-soft px-2 py-0.5 text-[11px] text-info-text">New</span>}
                        {!p.is_available && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] text-warn-text">Off</span>}
                      </div>
                      <p className="mt-0.5 font-mono text-[12px] text-text-2">RM {(p.base_price / 100).toFixed(2)}</p>
                      {p.modifiers.length > 0 && (
                        <p className="mt-0.5 truncate text-[12px] text-text-3">
                          {p.modifiers.map((g) => g.name).filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => togglePopular(p)}
                        disabled={togglingPopular === p.id}
                        title={p.is_popular ? "Remove from best sellers" : "Mark as a best seller"}
                        aria-label={p.is_popular ? "Remove from best sellers" : "Mark as a best seller"}
                        className={`flex h-9 w-9 items-center justify-center rounded-ctl transition-colors disabled:opacity-50 ${p.is_popular ? "text-warn-text" : "text-text-3 hover:bg-sunken hover:text-text"}`}
                      >
                        <Star className={`h-4 w-4 ${p.is_popular ? "fill-current" : ""}`} />
                      </button>
                      <button
                        onClick={() => toggleAvailable(p)}
                        disabled={toggling === p.id}
                        aria-label={p.is_available ? `Switch off ${p.name}` : `Switch on ${p.name}`}
                        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50 ${p.is_available ? "bg-ok-text" : "bg-line-2"}`}
                      >
                        <span className={`inline-block h-5 w-5 mt-0.5 rounded-full bg-surface shadow transition-transform duration-200 ${p.is_available ? "translate-x-5.5" : "translate-x-0.5"}`} />
                      </button>
                      <Link
                        href={`/pickup/menu/${p.id}`}
                        className="flex h-9 w-9 items-center justify-center rounded-ctl text-text-3 transition-colors hover:bg-sunken hover:text-text"
                        title="Edit item" aria-label={`Edit ${p.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Link>
                      <button
                        onClick={() => handleDelete(p.id)}
                        disabled={deleting === p.id}
                        aria-label={`Delete ${p.name}`}
                        className="flex h-9 w-9 items-center justify-center rounded-ctl text-text-3 transition-colors hover:bg-danger-soft hover:text-danger-text"
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
                      <div className="divide-y divide-line">
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
                    <div key={cat.id} className="overflow-hidden rounded-card border border-line bg-surface">
                      <div className="border-b border-line px-4 py-3">
                        <h2 className="text-sm font-semibold text-text">{cat.name}</h2>
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
                <div className="py-12 text-center text-sm text-text-3">No items match.</div>
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
            className="absolute top-4 right-4 bg-surface/10 hover:bg-surface/20 text-white rounded-full p-2 transition-colors"
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
