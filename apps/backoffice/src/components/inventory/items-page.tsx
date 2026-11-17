"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useFetch } from "@/lib/use-fetch";
import { KeyNumber } from "@/components/ui/key-number";
import { summariseItems } from "@/lib/inventory/items-summary";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirm, toast } from "@celsius/ui";
import { Plus, Search, Pencil, Trash2, Loader2, CheckSquare, X, ArrowLeft } from "lucide-react";

type Product = {
  id: string;
  name: string;
  sku: string;
  group: string;
  groupId: string;
  itemType: string;
  baseUom: string;
  storageArea: string;
  shelfLifeDays: number | null;
  description: string;
  checkFrequency: string;
  packages: { id: string; sku: string; name: string; uom: string; label: string; conversion: number; isDefault: boolean; containsPackageId: string | null }[];
  suppliers: { supplierId: string; name: string; price: number; uom: string; productPackageId: string | null }[];
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
  containsPackageId?: string | null;
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
  packages: PackageEntry[];
  description: string;
  suppliers: SupplierEntry[];
};

type StorageAreaOption = { id: string; name: string; slug: string };

const PACKAGE_PRESETS = [
  { name: "Piece", label: "Piece (pcs)", code: "PCS" },
  { name: "Bottle", label: "Bottle", code: "BTL" },
  { name: "Carton", label: "Carton", code: "CTN" },
  { name: "Box", label: "Box", code: "BOX" },
  { name: "Pack", label: "Pack", code: "PCK" },
  { name: "Bag", label: "Bag", code: "BAG" },
  { name: "Can", label: "Can", code: "CAN" },
  { name: "Tin", label: "Tin", code: "TIN" },
  { name: "Tub", label: "Tub", code: "TUB" },
  { name: "Jar", label: "Jar", code: "JAR" },
  { name: "Sachet", label: "Sachet", code: "SCH" },
  { name: "Pouch", label: "Pouch", code: "PCH" },
  { name: "Pail", label: "Pail", code: "PAL" },
  { name: "Drum", label: "Drum", code: "DRM" },
  { name: "Tray", label: "Tray", code: "TRY" },
  { name: "Sleeve", label: "Sleeve", code: "SLV" },
  { name: "Roll", label: "Roll", code: "ROL" },
  { name: "Slice", label: "Slice", code: "SLC" },
  { name: "Loaf", label: "Loaf", code: "LOF" },
];

const CONTAINER_TYPES = ["Carton", "Box", "Pack", "Tray"];

const emptyForm: ProductForm = { name: "", sku: "", groupId: "", baseUom: "", storageArea: "", shelfLifeDays: "", checkFrequency: "MONTHLY", description: "", packages: [], suppliers: [] };

export type ItemKind = "INGREDIENT" | "PERISHABLE";

const NOUNS: Record<ItemKind, { one: string; many: string; One: string; Many: string }> = {
  INGREDIENT: { one: "ingredient", many: "ingredients", One: "Ingredient", Many: "Ingredients" },
  PERISHABLE: { one: "perishable", many: "perishables", One: "Perishable", Many: "Perishables" },
};

/**
 * Stock › Ingredients and Stock › Perishables (restructure step 5, 17 Nov 2026):
 * one editor for both item types. Perishables used to be a 1,058-line copy of
 * this page that had drifted (no supplier search, no package-linked supplier
 * prices, and editing an item opened with an empty supplier list, so saving
 * dropped its suppliers). Each route keeps its own URL and grant.
 */
export function ItemsPage({ kind }: { kind: ItemKind }) {
  const N = NOUNS[kind];
  const { data: products = [], isLoading: loading, mutate: reloadProducts } = useFetch<Product[]>(`/api/inventory/products?itemType=${kind}`);
  const { data: groupOptions = [] } = useFetch<GroupOption[]>("/api/inventory/groups");
  const { data: supplierOptions = [] } = useFetch<SupplierOption[]>("/api/inventory/suppliers");
  const { data: storageAreaOptions = [] } = useFetch<StorageAreaOption[]>("/api/inventory/storage-areas");
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("All");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Inline supplier form state
  const [supplierSearchTerm, setSupplierSearchTerm] = useState("");
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [supplierPrice, setSupplierPrice] = useState("");
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false);
  const supplierDropdownRef = useRef<HTMLDivElement>(null);
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierPhone, setNewSupplierPhone] = useState("");

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (supplierDropdownRef.current && !supplierDropdownRef.current.contains(e.target as Node)) {
        setSupplierDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);

  const { confirm, ConfirmDialog } = useConfirm();

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
          itemType: kind,
          packages: form.packages.filter((p) => p.packageName && p.conversionFactor).map((p, _i, arr) => ({
            id: p.id || undefined,
            sku: p.sku || undefined,
            packageName: p.packageName,
            packageLabel: p.packageLabel || p.packageName,
            conversionFactor: parseFloat(p.conversionFactor) || 1,
            isDefault: p.isDefault,
            containsPackageId: p.containsPackageId && !p.containsPackageId.startsWith("new-") ? p.containsPackageId : undefined,
            containsPackageIndex: p.containsPackageId?.startsWith("new-") ? parseInt(p.containsPackageId.replace("new-", "")) : undefined,
          })),
          suppliers: form.suppliers.map((s) => ({
            ...s,
            productPackageId: s.productPackageId?.startsWith("new-") ? undefined : s.productPackageId,
            packageIndex: s.productPackageId?.startsWith("new-") ? parseInt(s.productPackageId.replace("new-", "")) : undefined,
          })),
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null); toast.error(`Failed to save ${N.one}: ${err?.error || res.statusText}`); return; }
      setDialogOpen(false);
      loadProducts();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: `Delete this ${N.one}?`, confirmLabel: "Delete", destructive: true }))) return;
    const res = await fetch(`/api/inventory/products/${id}`, { method: "DELETE" });
    if (!res.ok) { toast.error(`Failed to delete ${N.one}. It may be linked to orders or recipes.`); return; }
    toast.success(`${N.One} deleted`);
    loadProducts();
  };

  const groups = ["All", ...new Set(products.map((p) => p.group).filter(Boolean))].sort();

  const filtered = products.filter((p) => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase());
    const matchGroup = groupFilter === "All" || p.group === groupFilter;
    return matchSearch && matchGroup;
  });

  const closeForm = () => { setDialogOpen(false); setEditingId(null); setForm(emptyForm); resetSupplierForm(); };

  const openAdd = () => {
    window.scrollTo(0, 0);
    setForm(emptyForm);
    setEditingId(null);
    resetSupplierForm();
    setDialogOpen(true);
  };

  const openEdit = (product: Product) => {
    window.scrollTo(0, 0);
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
        containsPackageId: pkg.containsPackageId ?? null,
      })),
      suppliers: product.suppliers
        .filter((s) => s.name !== "Ad-hoc Purchase")
        .map((s) => ({
          supplierId: s.supplierId,
          price: s.price,
          productPackageId: s.productPackageId || undefined,
        })),
    });
    setEditingId(product.id);
    resetSupplierForm();
    setDialogOpen(true);
  };

  const updateField = (key: keyof ProductForm, value: string | SupplierEntry[]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetSupplierForm = () => {
    setSupplierSearchTerm("");
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
    const pkgSelect = document.getElementById("supplier-pkg-select") as HTMLSelectElement | null;
    const pkgId = pkgSelect?.value || undefined;
    setForm((prev) => ({
      ...prev,
      suppliers: [...prev.suppliers, {
        supplierId: selectedSupplierId,
        price: parseFloat(supplierPrice),
        productPackageId: pkgId || undefined,
      }],
    }));
    setSelectedSupplierId("");
    setSupplierPrice("");
    setSupplierSearchTerm("");
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

  const filteredSupplierOptions = supplierOptions.filter((s) =>
    s.name.toLowerCase().includes(supplierSearchTerm.toLowerCase()) && s.name !== "Ad-hoc Purchase"
  );

  // Bulk selection helpers
  const filteredIds = filtered.map((p) => p.id);
  const summary = summariseItems(products);
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
      if (!res.ok) { toast.error("Bulk update failed"); return; }
      const result = await res.json();
      toast.success(`Updated ${result.updated} ${result.updated === 1 ? N.one : N.many}`);
      clearSelection();
      reloadProducts();
    } finally {
      setBulkSaving(false);
    }
  };

  const handleBulkDelete = async () => {
    const ok = await confirm({
      title: `Delete ${selected.size} ${selected.size === 1 ? N.one : N.many}?`,
      description: "This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setBulkSaving(true);
    try {
      const res = await fetch("/api/inventory/products/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) { toast.error(`Bulk delete failed. Some ${N.many} may be linked to orders.`); return; }
      const result = await res.json();
      toast.success(`Deleted ${result.deleted} ${result.deleted === 1 ? N.one : N.many}`);
      clearSelection();
      reloadProducts();
    } finally {
      setBulkSaving(false);
    }
  };

  return (
    <div className="px-4 pt-6 pb-10 md:px-8">
      <ConfirmDialog />
      {!dialogOpen && (<>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">{N.Many}</h1>
          <p className="mt-0.5 text-sm text-text-2">{kind === "PERISHABLE"
            ? "Short-life items: how long they keep, who sells them, and how often they are counted."
            : "Everything we buy and count: how it is packed, who sells it, and how often it is counted."}</p>
        </div>
        <Button onClick={openAdd} className="self-start bg-ink text-on-ink hover:bg-ink-hover">
          <Plus className="mr-1.5 h-4 w-4" />Add {N.one}
        </Button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KeyNumber label={N.Many} value={loading ? null : String(summary.total)}
          note={<>in <b className="font-semibold text-text-2">{summary.groups}</b> {summary.groups === 1 ? "group" : "groups"}</>} />
        <KeyNumber label="No supplier" value={loading ? null : String(summary.noSupplier)} tone={summary.noSupplier > 0 ? "warn" : undefined}
          note={summary.noSupplier > 0 ? "cannot be put on an order" : "every item can be ordered"} />
        <KeyNumber label="One supplier only" value={loading ? null : String(summary.oneSupplier)}
          note="no backup if that supplier runs out" />
        {kind === "PERISHABLE"
          ? <KeyNumber label="No shelf life set" value={loading ? null : String(summary.noShelfLife)} tone={summary.noShelfLife > 0 ? "warn" : undefined}
              note={summary.noShelfLife > 0 ? "expiry cannot be tracked" : "every item has a shelf life"} />
          : <KeyNumber label="Counted daily" value={loading ? null : String(summary.daily)}
              note={<><b className="font-semibold text-text-2">{summary.weekly}</b> weekly, the rest monthly</>} />}
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
          <Input placeholder="Search by name or SKU..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {groups.slice(0, 12).map((grp) => (
            <button key={grp} onClick={() => setGroupFilter(grp)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${groupFilter === grp ? "border-text bg-raised font-semibold text-text" : "border-line text-text-2 hover:bg-sunken"}`}>
              {grp}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface">
        <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
          <input type="checkbox" aria-label={`Select all ${N.many}`} checked={allFilteredSelected && filteredIds.length > 0} onChange={toggleSelectAll} className="h-4 w-4 rounded accent-ink" />
          <p className="text-[13px] text-text-2">{loading ? `Loading ${N.many}…` : `${filtered.length} ${filtered.length === 1 ? N.one : N.many}`}</p>
        </div>
        {loading && <div className="py-12 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-text-3" /></div>}
        {!loading && filtered.length === 0 && <p className="px-4 py-12 text-center text-sm text-text-3">No {N.many} found</p>}
        {!loading && filtered.map((product) => {
          const sellers = product.suppliers.filter((s) => s.name !== "Ad-hoc Purchase");
          const open = expandedId === product.id;
          const freq = product.checkFrequency === "DAILY" ? "Daily" : product.checkFrequency === "WEEKLY" ? "Weekly" : "Monthly";
          return (
            <div key={product.id} className={`border-b border-line last:border-b-0 ${selected.has(product.id) ? "bg-brand-soft" : ""}`}>
              <div className="flex items-center gap-3 px-4 py-3">
                <input type="checkbox" aria-label={`Select ${product.name}`} checked={selected.has(product.id)} onChange={() => toggleSelect(product.id)} className="h-4 w-4 shrink-0 rounded accent-ink" />
                <button onClick={() => setExpandedId(open ? null : product.id)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium text-text">{product.name}</p>
                  <p className="mt-0.5 truncate text-[12px] text-text-3">
                    {product.sku} · {product.group}{product.storageArea ? ` · ${product.storageArea}` : ""} · {freq.toLowerCase()} count{product.shelfLifeDays ? ` · keeps ${product.shelfLifeDays} days` : ""}
                  </p>
                </button>
                <span className={`hidden shrink-0 rounded-full px-2.5 py-0.5 text-[12px] sm:inline ${sellers.length === 0 ? "bg-warn-soft text-warn-text" : "bg-sunken text-text-2"}`}>
                  {sellers.length === 0 ? "No supplier" : `${sellers.length} ${sellers.length === 1 ? "supplier" : "suppliers"}`}
                </span>
                <button onClick={() => openEdit(product)} aria-label={`Edit ${product.name}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl text-text-3 hover:bg-sunken hover:text-text">
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => handleDelete(product.id)} aria-label={`Delete ${product.name}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl text-text-3 hover:bg-danger-soft hover:text-danger-text">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {open && (
                <div className="grid gap-3 border-t border-line bg-sunken/40 px-4 py-3 text-[13px] sm:grid-cols-2">
                  <div>
                    <p className="mb-1 font-medium text-text-2">Packages</p>
                    {product.packages.length === 0 && <p className="text-text-3">None set</p>}
                    {product.packages.map((pkg) => (
                      <p key={pkg.name} className="text-text-2">1 {pkg.name} = {pkg.conversion > 1 ? `${pkg.conversion.toLocaleString()} ${product.baseUom}` : pkg.label}{pkg.sku ? <span className="text-text-3"> · {pkg.sku}</span> : null}</p>
                    ))}
                  </div>
                  <div>
                    <p className="mb-1 font-medium text-text-2">Suppliers</p>
                    {sellers.length === 0 && <p className="text-warn-text">No supplier yet</p>}
                    {sellers.map((s, i) => <p key={i} className="text-text-2">{s.name} <span className="font-mono">RM {s.price.toFixed(2)}</span></p>)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      </>)}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-20 left-1/2 z-50 flex w-[calc(100%-32px)] max-w-fit -translate-x-1/2 flex-wrap items-center gap-2 rounded-card border border-line bg-raised px-4 py-3 shadow-lg md:bottom-6">
          <div className="flex items-center gap-2">
            <CheckSquare className="h-4 w-4 text-brand-text" />
            <span className="text-sm font-medium text-text">{selected.size} selected</span>
          </div>
          <div className="h-5 w-px bg-line" />
          <button
            onClick={() => setBulkAction("group")}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-text-2 hover:bg-sunken"
          >
            Change group
          </button>
          <button
            onClick={() => setBulkAction("storage")}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-text-2 hover:bg-sunken"
          >
            Change storage
          </button>
          <button
            onClick={() => setBulkAction("frequency")}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-text-2 hover:bg-sunken"
          >
            Change count frequency
          </button>
          <button
            onClick={handleBulkDelete}
            disabled={bulkSaving}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-danger-text hover:bg-danger-soft"
          >
            Delete
          </button>
          <div className="h-5 w-px bg-line" />
          <button onClick={clearSelection} className="rounded-lg p-1.5 text-text-3 hover:bg-sunken hover:text-text-2">
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
          <p className="text-sm text-text-2">Apply to {selected.size} selected {N.many}</p>
          <div className="mt-2">
            {bulkAction === "group" && (
              <select
                className="w-full rounded-md border border-line px-3 py-2 text-sm"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) handleBulkUpdate({ groupId: e.target.value });
                }}
              >
                <option value="" disabled>Select group...</option>
                {groupOptions.map((grp) => (
                  <option key={grp.id} value={grp.id}>{grp.name}</option>
                ))}
              </select>
            )}
            {bulkAction === "storage" && (
              <select
                className="w-full rounded-md border border-line px-3 py-2 text-sm"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) handleBulkUpdate({ storageArea: e.target.value });
                }}
              >
                <option value="" disabled>Select storage area...</option>
                {storageAreaOptions.map((area) => (
                  <option key={area.id} value={area.name}>{area.name}</option>
                ))}
              </select>
            )}
            {bulkAction === "frequency" && (
              <select
                className="w-full rounded-md border border-line px-3 py-2 text-sm"
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
            <div className="flex items-center gap-2 text-sm text-text-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Updating...
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add/Edit: a full page, not a modal (many fields, package and supplier rows) */}
      {dialogOpen && (
        <div className="max-w-[960px]">
          <button onClick={closeForm} className="inline-flex items-center gap-1.5 text-sm text-text-2 hover:text-text">
            <ArrowLeft className="h-4 w-4" /> All {N.many}
          </button>
          <h1 className="mt-3 text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">{editingId ? `Edit ${form.name || N.one}` : `Add ${N.one}`}</h1>
          <p className="mt-0.5 text-sm text-text-2">How it is packed, who sells it and for how much, and how often it is counted.</p>
          <div className="mt-5 grid gap-5">
            {/* Basic Info */}
            <div className="rounded-lg border border-line bg-sunken/30 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-3">Basic info</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-text-2">{N.One} name</label>
                  <Input
                    className="mt-1.5 h-10"
                    placeholder="e.g. Monin Caramel Syrup"
                    value={form.name}
                    onChange={(e) => updateField("name", e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-text-2">SKU Code</label>
                  <Input
                    className="mt-1.5 h-10"
                    placeholder="e.g. FM001"
                    value={form.sku}
                    onChange={(e) => updateField("sku", e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-text-2">Group</label>
                  <select
                    className="mt-1.5 h-10 w-full rounded-md border border-line px-3 text-sm"
                    value={form.groupId}
                    onChange={(e) => updateField("groupId", e.target.value)}
                  >
                    <option value="">Select...</option>
                    {groupOptions.map((grp) => (
                      <option key={grp.id} value={grp.id}>{grp.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-text-2">Base UOM</label>
                  <select
                    className="mt-1.5 h-10 w-full rounded-md border border-line px-3 text-sm"
                    value={form.baseUom}
                    onChange={(e) => updateField("baseUom", e.target.value)}
                  >
                    <option value="">Select...</option>
                    <option value="ml">Milliliter (ml)</option>
                    <option value="g">Gram (g)</option>
                    <option value="pcs">Piece (pcs)</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-text-2">Description</label>
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
            <div className="rounded-lg border border-line bg-sunken/30 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-3">Storage &amp; Tracking</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="text-sm font-medium text-text-2">Storage area</label>
                  <select
                    className="mt-1.5 h-10 w-full rounded-md border border-line px-3 text-sm"
                    value={form.storageArea}
                    onChange={(e) => updateField("storageArea", e.target.value)}
                  >
                    <option value="">Select...</option>
                    {storageAreaOptions.map((area) => (
                      <option key={area.id} value={area.name}>{area.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-text-2">Shelf Life (days)</label>
                  <Input
                    className="mt-1.5 h-10"
                    type="number"
                    placeholder="e.g. 30"
                    value={form.shelfLifeDays}
                    onChange={(e) => updateField("shelfLifeDays", e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-text-2">Check frequency</label>
                  <select
                    className="mt-1.5 h-10 w-full rounded-md border border-line px-3 text-sm"
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
            <div className="rounded-lg border border-line bg-sunken/30 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-3">Packages</p>

              {/* UOM — unit packages (no containsPackageId) */}
              {(() => {
                const unitPkgs = form.packages.filter((p) => !p.containsPackageId);
                const bulkPkgs = form.packages.filter((p) => !!p.containsPackageId);
                return (
                  <>
                    <p className="mb-2 text-xs font-medium text-text-2">UOM <span className="font-normal text-text-3">— countable unit (e.g. 1,000ml Bottle)</span></p>
                    {unitPkgs.length > 0 && (
                      <div className="mb-3 space-y-2">
                        {unitPkgs.map((pkg) => {
                          const origIdx = form.packages.indexOf(pkg);
                          return (
                            <div key={origIdx} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5">
                              <code className="rounded bg-sunken px-1.5 py-0.5 text-xs text-text-2">{pkg.sku || "—"}</code>
                              <span className="text-sm font-medium text-text-2">{pkg.packageLabel || pkg.packageName}</span>
                              <span className="text-xs text-text-3">=</span>
                              <span className="text-sm text-text-2">{Number(pkg.conversionFactor).toLocaleString()} {form.baseUom || "units"}</span>
                              {pkg.isDefault && <Badge variant="outline" className="text-xs border-line bg-info-soft text-info-text">Default</Badge>}
                              <div className="flex-1" />
                              <button type="button" onClick={() => setForm((prev) => ({ ...prev, packages: prev.packages.filter((_, idx) => idx !== origIdx) }))} className="text-text-3 hover:text-danger-text"><X className="h-4 w-4" /></button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Add UOM */}
                    <div className="mb-4 flex flex-wrap items-end gap-3">
                      <div className="w-32">
                        <label className="text-xs text-text-2">Type</label>
                        <select
                          id="new-uom-type"
                          className="mt-1 h-10 w-full rounded-md border border-line px-3 text-sm"
                          defaultValue=""
                        >
                          <option value="" disabled>Select...</option>
                          {PACKAGE_PRESETS.map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}
                        </select>
                      </div>
                      <div className="w-24">
                        <label className="text-xs text-text-2">Size</label>
                        <Input id="new-uom-size" type="number" placeholder="1000" className="mt-1 h-10" />
                      </div>
                      <span className="pb-2 text-sm text-text-3">{form.baseUom || "units"}</span>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10"
                        onClick={() => {
                          const typeEl = document.getElementById("new-uom-type") as HTMLSelectElement;
                          const sizeEl = document.getElementById("new-uom-size") as HTMLInputElement;
                          if (!typeEl.value || !sizeEl.value) return;
                          const typeName = typeEl.value;
                          const size = Number(sizeEl.value);
                          if (!size || size <= 0) return;
                          const preset = PACKAGE_PRESETS.find((p) => p.name === typeName);
                          const code = preset?.code || typeName.slice(0, 3).toUpperCase();
                          setForm((prev) => {
                            const label = `${size.toLocaleString()}${form.baseUom || ""} ${typeName}`;
                            const count = prev.packages.filter((p) => p.packageName.toLowerCase().includes(typeName.toLowerCase())).length;
                            const autoSku = form.sku ? `${form.sku}-${code}${count > 0 ? count + 1 : ""}` : "";
                            return {
                              ...prev,
                              packages: [...prev.packages, {
                                sku: autoSku,
                                packageName: typeName,
                                packageLabel: label,
                                conversionFactor: String(size),
                                isDefault: prev.packages.length === 0,
                                containsPackageId: null,
                              }],
                            };
                          });
                          typeEl.value = "";
                          sizeEl.value = "";
                        }}
                      >
                        Add
                      </Button>
                    </div>

                    {/* Bulk Packaging */}
                    <p className="mb-2 text-xs font-medium text-text-2">Bulk packaging <span className="font-normal text-text-3">— how it&apos;s purchased (e.g. Carton of 12× Bottle)</span></p>
                    {bulkPkgs.length > 0 && (
                      <div className="mb-3 space-y-2">
                        {bulkPkgs.map((pkg) => {
                          const origIdx = form.packages.indexOf(pkg);
                          const childPkg = form.packages.find((p, idx) => p.id === pkg.containsPackageId || `new-${idx}` === pkg.containsPackageId);
                          const qty = childPkg ? Math.round(Number(pkg.conversionFactor) / Number(childPkg.conversionFactor)) : 0;
                          return (
                            <div key={origIdx} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5">
                              <code className="rounded bg-sunken px-1.5 py-0.5 text-xs text-text-2">{pkg.sku || "—"}</code>
                              <span className="text-sm font-medium text-text-2">{pkg.packageLabel || pkg.packageName}</span>
                              {childPkg && <span className="text-xs text-text-3">({qty}× {childPkg.packageLabel || childPkg.packageName})</span>}
                              <span className="text-xs text-text-3">=</span>
                              <span className="text-sm text-text-2">{Number(pkg.conversionFactor).toLocaleString()} {form.baseUom || "units"}</span>
                              <div className="flex-1" />
                              <button type="button" onClick={() => setForm((prev) => ({ ...prev, packages: prev.packages.filter((_, idx) => idx !== origIdx) }))} className="text-text-3 hover:text-danger-text"><X className="h-4 w-4" /></button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Add Bulk Package */}
                    {unitPkgs.length > 0 && (
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="w-32">
                          <label className="text-xs text-text-2">Container</label>
                          <select
                            id="new-bulk-type"
                            className="mt-1 h-10 w-full rounded-md border border-line px-3 text-sm"
                            defaultValue=""
                          >
                            <option value="" disabled>Select...</option>
                            {PACKAGE_PRESETS.map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}
                          </select>
                        </div>
                        <div className="w-20">
                          <label className="text-xs text-text-2">Qty</label>
                          <Input id="new-bulk-qty" type="number" placeholder="12" className="mt-1 h-10" />
                        </div>
                        <span className="pb-2 text-sm text-text-3">×</span>
                        <div className="w-44">
                          <label className="text-xs text-text-2">Contains</label>
                          <select id="new-bulk-contains" className="mt-1 h-10 w-full rounded-md border border-line px-3 text-sm" defaultValue="">
                            <option value="" disabled>Select UOM...</option>
                            {unitPkgs.map((pkg) => {
                              const idx = form.packages.indexOf(pkg);
                              return <option key={idx} value={pkg.id || `new-${idx}`}>{pkg.packageLabel || pkg.packageName}</option>;
                            })}
                          </select>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-10"
                          onClick={() => {
                            const typeEl = document.getElementById("new-bulk-type") as HTMLSelectElement;
                            const qtyEl = document.getElementById("new-bulk-qty") as HTMLInputElement;
                            const containsEl = document.getElementById("new-bulk-contains") as HTMLSelectElement;
                            if (!typeEl.value || !qtyEl.value || !containsEl.value) return;
                            const typeName = typeEl.value;
                            const qty = Number(qtyEl.value);
                            const containsRef = containsEl.value;
                            if (!qty || qty <= 0) return;
                            const preset = PACKAGE_PRESETS.find((p) => p.name === typeName);
                            const code = preset?.code || typeName.slice(0, 3).toUpperCase();
                            setForm((prev) => {
                              const childPkg = prev.packages.find((p, idx) => p.id === containsRef || `new-${idx}` === containsRef);
                              if (!childPkg) return prev;
                              const childConv = Number(childPkg.conversionFactor);
                              const totalConv = qty * childConv;
                              const label = `${typeName} (${qty}× ${childPkg.packageLabel || childPkg.packageName})`;
                              const count = prev.packages.filter((p) => p.packageName.toLowerCase().includes(typeName.toLowerCase())).length;
                              const autoSku = form.sku ? `${form.sku}-${code}${count > 0 ? count + 1 : ""}` : "";
                              return {
                                ...prev,
                                packages: [...prev.packages, {
                                  sku: autoSku,
                                  packageName: typeName,
                                  packageLabel: label,
                                  conversionFactor: String(totalConv),
                                  isDefault: false,
                                  containsPackageId: containsRef,
                                }],
                              };
                            });
                            typeEl.value = "";
                            qtyEl.value = "";
                            containsEl.value = "";
                          }}
                        >
                          Add
                        </Button>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Suppliers & Pricing */}
            <div className="rounded-lg border border-line bg-sunken/30 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-3">Suppliers &amp; Pricing</p>

              {/* Existing supplier entries */}
              {form.suppliers.length > 0 && (
                <div className="mb-3 space-y-2">
                  {form.suppliers.map((entry, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5">
                      <span className="flex-1 text-sm font-medium text-text-2">
                        {entry.supplierId
                          ? supplierOptions.find((s) => s.id === entry.supplierId)?.name ?? "Supplier"
                          : entry.supplierName ?? "New Supplier"}
                        {entry.productPackageId && (
                          <span className="ml-1.5 text-xs text-text-3">
                            ({form.packages.find((p, idx) => p.id === entry.productPackageId || `new-${idx}` === entry.productPackageId)?.packageLabel
                              || form.packages.find((p, idx) => p.id === entry.productPackageId || `new-${idx}` === entry.productPackageId)?.packageName
                              || "Package"})
                          </span>
                        )}
                      </span>
                      <span className="rounded-full bg-ok-soft px-3 py-0.5 text-sm font-medium text-ok-text">RM{entry.price.toFixed(2)}</span>
                      <button onClick={() => removeSupplierEntry(i)} className="text-text-3 hover:text-danger-text">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add existing supplier */}
              {!showNewSupplier && (
                <div className="flex items-end gap-3">
                  <div className="flex-1 relative" ref={supplierDropdownRef}>
                    <label className="text-xs text-text-2">Supplier</label>
                    <input
                      type="text"
                      className="mt-1 h-10 w-full rounded-md border border-line px-3 text-sm"
                      placeholder="Search supplier..."
                      value={supplierSearchTerm}
                      onChange={(e) => { setSupplierSearchTerm(e.target.value); setSelectedSupplierId(""); setSupplierDropdownOpen(true); }}
                      onFocus={() => setSupplierDropdownOpen(true)}
                    />
                    {supplierDropdownOpen && filteredSupplierOptions.length > 0 && (
                      <div className="absolute bottom-full z-50 mb-1 max-h-48 w-full overflow-auto rounded-md border bg-surface shadow-lg">
                        {filteredSupplierOptions.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm hover:bg-sunken"
                            onClick={() => { setSelectedSupplierId(s.id); setSupplierSearchTerm(s.name); setSupplierDropdownOpen(false); }}
                          >
                            {s.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {form.packages.length > 0 && (
                    <div className="w-36">
                      <label className="text-xs text-text-2">Package</label>
                      <select
                        id="supplier-pkg-select"
                        className="mt-1 h-10 w-full rounded-md border border-line px-3 text-sm"
                        defaultValue=""
                      >
                        <option value="">Base ({form.baseUom})</option>
                        {form.packages.map((pkg, i) => (
                          <option key={i} value={pkg.id || `new-${i}`}>{pkg.packageLabel || pkg.packageName}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="w-32">
                    <label className="text-xs text-text-2">Price (RM)</label>
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
                  className="mt-3 text-sm text-brand-text hover:underline"
                >
                  + Create New Supplier
                </button>
              ) : (
                <div className="mt-3 space-y-3 rounded-lg border border-dashed border-line-2 bg-surface p-4">
                  <p className="text-sm font-medium text-text-2">New supplier</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-text-2">Supplier name</label>
                      <Input
                        placeholder="e.g. Jinka Supply"
                        value={newSupplierName}
                        onChange={(e) => setNewSupplierName(e.target.value)}
                        className="mt-1 h-10"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-text-2">Phone (optional)</label>
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
                      <label className="text-xs text-text-2">Price (RM)</label>
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
                      className="text-sm text-text-3 hover:text-text-2"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={closeForm}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving || !form.name || !form.sku || !form.groupId} className="bg-ink text-on-ink hover:bg-ink-hover disabled:opacity-50">
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {editingId ? "Save changes" : `Add ${N.one}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
