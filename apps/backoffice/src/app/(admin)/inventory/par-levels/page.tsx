"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Search, Loader2, TrendingDown, Check, X, Sparkles, RefreshCw, Clock, Package, AlertTriangle } from "lucide-react";

type ProductPackage = {
  id: string;
  name: string;
  label: string;
  conversion: number;
  conversionFactor: number;
  isDefault: boolean;
};

type Product = {
  id: string;
  name: string;
  sku: string;
  category: string;
  baseUom: string;
  packages: ProductPackage[];
};

type Outlet = {
  id: string;
  name: string;
};

type ParLevel = {
  id: string;
  productId: string;
  outletId: string;
  parLevel: number;
  reorderPoint: number;
  avgDailyUsage: number;
};

type StockLevel = {
  productId: string;
  currentQty: number;
};

type EditingCell = {
  productId: string;
  field: "parLevel" | "reorderPoint" | "avgDailyUsage";
};

type QuickSetForm = {
  parLevel: string;
  reorderPoint: string;
  avgDailyUsage: string;
};

const emptyQuickSet: QuickSetForm = { parLevel: "", reorderPoint: "", avgDailyUsage: "" };

export default function ParLevelsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [parLevels, setParLevels] = useState<ParLevel[]>([]);
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [selectedOutletId, setSelectedOutletId] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [quickSetProductId, setQuickSetProductId] = useState<string | null>(null);
  const [quickSetForm, setQuickSetForm] = useState<QuickSetForm>(emptyQuickSet);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkMultiplier, setBulkMultiplier] = useState("2");

  // Smart recalculate
  const [recalculating, setRecalculating] = useState(false);
  const [recalcResult, setRecalcResult] = useState<{
    productsUpdated: number;
    salesTransactions: number;
    menuItemsWithSales: number;
    lookbackDays: number;
    settings: { safetyDays: number; coverageDays: number | null };
    projectedParValue?: number;
    valueByClass?: Record<"A" | "B" | "C", { products: number; parValue: number }>;
    details: { productId: string; name: string; dailyUsage: number; valueClass?: "A" | "B" | "C"; parValue?: number; leadTime: number; reorderPoint: number; parLevel: number; maxLevel: number }[];
  } | null>(null);
  const [showRecalcResult, setShowRecalcResult] = useState(false);
  const [recalcSafetyDays, setRecalcSafetyDays] = useState("1");
  // Empty = auto: the engine picks coverage per value class (A 2d / B 3d / C 5d)
  // to cap the ringgit tied up at par. A number forces that coverage for everything.
  const [recalcCoverageDays, setRecalcCoverageDays] = useState("");
  const [showRecalcSettings, setShowRecalcSettings] = useState(false);

  // Load outlets and products on mount
  useEffect(() => {
    Promise.all([
      fetch("/api/inventory/products").then((r) => r.json()),
      fetch("/api/settings/outlets?status=ACTIVE").then((r) => r.json()),
    ]).then(([productsData, outletsData]) => {
      setProducts(productsData);
      setOutlets(outletsData);
      if (outletsData.length > 0) {
        setSelectedOutletId(outletsData[0].id);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const loadOutletData = useCallback((outletId: string) => {
    if (!outletId) return;
    Promise.all([
      fetch("/api/inventory/par-levels").then((r) => r.json()),
      fetch(`/api/inventory/stock-levels?outletId=${outletId}`).then((r) => r.json()),
    ]).then(([parData, stockData]) => {
      setParLevels(parData);
      setStockLevels(stockData.items || []);
    });
  }, []);

  // Load par levels and stock when outlet changes
  useEffect(() => {
    if (selectedOutletId) {
      loadOutletData(selectedOutletId);
    }
  }, [selectedOutletId, loadOutletData]);

  const getParLevel = (productId: string): ParLevel | undefined =>
    parLevels.find((p) => p.productId === productId && p.outletId === selectedOutletId);

  const getStock = (productId: string): number | null => {
    const sl = stockLevels.find((s) => s.productId === productId);
    return sl ? sl.currentQty : null;
  };

  // Package unit helpers — convert base UOM ↔ package units
  const getDefaultPackage = (productId: string): ProductPackage | null => {
    const product = products.find((p) => p.id === productId);
    if (!product || !product.packages?.length) return null;
    return product.packages.find((pkg) => pkg.isDefault) ?? product.packages[0] ?? null;
  };

  const getPackageLabel = (productId: string): string => {
    const pkg = getDefaultPackage(productId);
    const product = products.find((p) => p.id === productId);
    return pkg?.label ?? pkg?.name ?? product?.baseUom ?? "";
  };

  const getConversionFactor = (productId: string): number => {
    const pkg = getDefaultPackage(productId);
    return pkg ? pkg.conversionFactor : 1;
  };

  // Convert from base UOM to package units for display
  const toPackageUnits = (productId: string, baseValue: number): number => {
    const cf = getConversionFactor(productId);
    return cf > 0 ? Math.round((baseValue / cf) * 100) / 100 : baseValue;
  };

  // Convert from package units to base UOM for storage
  const toBaseUom = (productId: string, pkgValue: number): number => {
    const cf = getConversionFactor(productId);
    return Math.round(pkgValue * cf * 100) / 100;
  };

  const getStatus = (productId: string): "none" | "critical" | "low" | "ok" => {
    const par = getParLevel(productId);
    const stock = getStock(productId);
    if (!par) return "none";
    if (stock === null) return "none";
    // Compare in base UOM (both stock and par are stored in base UOM)
    if (stock <= par.reorderPoint) return "critical";
    if (stock < par.parLevel) return "low";
    return "ok";
  };

  const statusConfig = {
    none: { label: "No par set", className: "bg-sunken text-text-2" },
    critical: { label: "Critical", className: "bg-danger-soft text-danger-text" },
    low: { label: "Low", className: "bg-warn-soft text-warn-text" },
    ok: { label: "OK", className: "bg-ok-soft text-ok-text" },
  };

  const getRowBg = (productId: string): string => {
    const status = getStatus(productId);
    switch (status) {
      case "critical": return "bg-danger-soft";
      case "low": return "bg-warn-soft";
      case "ok": return "";
      default: return "";
    }
  };

  const saveParLevel = async (
    productId: string,
    values: { parLevel?: number; reorderPoint?: number; avgDailyUsage?: number }
  ) => {
    setSaving(true);
    const existing = getParLevel(productId);
    const body = {
      productId,
      outletId: selectedOutletId,
      parLevel: values.parLevel ?? existing?.parLevel ?? 0,
      reorderPoint: values.reorderPoint ?? existing?.reorderPoint ?? 0,
      avgDailyUsage: values.avgDailyUsage ?? existing?.avgDailyUsage ?? 0,
    };
    try {
      await fetch("/api/inventory/par-levels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      loadOutletData(selectedOutletId);
    } finally {
      setSaving(false);
    }
  };

  const handleCellClick = (productId: string, field: EditingCell["field"], currentValue: number) => {
    setEditingCell({ productId, field });
    // Show value in package units for editing
    setEditValue(toPackageUnits(productId, currentValue).toString());
  };

  const handleCellSave = () => {
    if (!editingCell) return;
    const numValue = parseFloat(editValue);
    if (isNaN(numValue) || numValue < 0) {
      setEditingCell(null);
      return;
    }
    // Convert from package units (what user entered) to base UOM (what we store)
    const baseValue = toBaseUom(editingCell.productId, numValue);
    saveParLevel(editingCell.productId, { [editingCell.field]: baseValue });
    setEditingCell(null);
  };

  const handleCellKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleCellSave();
    if (e.key === "Escape") setEditingCell(null);
  };

  const handleQuickSet = (productId: string) => {
    const par = parseFloat(quickSetForm.parLevel);
    const reorder = parseFloat(quickSetForm.reorderPoint);
    const usage = parseFloat(quickSetForm.avgDailyUsage);
    if (isNaN(par) || isNaN(reorder)) return;
    // Convert from package units (user input) to base UOM (storage)
    saveParLevel(productId, {
      parLevel: toBaseUom(productId, par),
      reorderPoint: toBaseUom(productId, reorder),
      avgDailyUsage: isNaN(usage) ? 0 : toBaseUom(productId, usage),
    });
    setQuickSetProductId(null);
    setQuickSetForm(emptyQuickSet);
  };

  const handleBulkSet = async () => {
    const multiplier = parseFloat(bulkMultiplier);
    if (isNaN(multiplier) || multiplier <= 0) return;
    setSaving(true);
    const productsWithoutPar = products.filter((p) => !getParLevel(p.id));
    try {
      await Promise.all(
        productsWithoutPar.map((p) => {
          const stock = getStock(p.id);
          const baseUsage = stock !== null && stock > 0 ? Math.round(stock / 7) : 1;
          return fetch("/api/inventory/par-levels", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              productId: p.id,
              outletId: selectedOutletId,
              parLevel: Math.round(baseUsage * multiplier),
              reorderPoint: Math.round(baseUsage * (multiplier / 2)),
              avgDailyUsage: baseUsage,
            }),
          });
        })
      );
      loadOutletData(selectedOutletId);
      setBulkDialogOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSmartRecalculate = async () => {
    if (!selectedOutletId) return;
    setRecalculating(true);
    try {
      const res = await fetch("/api/inventory/par-levels/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outletId: selectedOutletId,
          safetyDays: parseInt(recalcSafetyDays) || 1,
          // Omit coverageDays when blank so the engine uses value-class coverage.
          ...(parseInt(recalcCoverageDays) > 0 ? { coverageDays: parseInt(recalcCoverageDays) } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || data.error || "Failed to recalculate");
        return;
      }
      setRecalcResult(data);
      setShowRecalcResult(true);
      loadOutletData(selectedOutletId);
    } catch {
      alert("Failed to recalculate par levels");
    } finally {
      setRecalculating(false);
    }
  };

  const categories = ["All", ...new Set(products.map((p) => p.category).filter(Boolean))].sort();

  const filtered = products.filter((p) => {
    const matchSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase());
    const matchCategory = categoryFilter === "All" || p.category === categoryFilter;
    return matchSearch && matchCategory;
  });

  const productsWithoutParCount = products.filter((p) => !getParLevel(p.id)).length;

  return (
    <div className="px-4 pt-6 pb-10 md:px-8">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Reserve levels</h1>
          <p className="mt-0.5 text-sm text-text-2">
            When each item should be reordered, and how much to keep on the shelf.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedOutletId && (
            <Button
              onClick={() => setShowRecalcSettings(true)}
              disabled={recalculating}
              variant="outline"
              className="border-line text-info-text hover:bg-info-soft"
            >
              {recalculating ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-4 w-4" />
              )}
              Smart recalculate
            </Button>
          )}
          {productsWithoutParCount > 0 && selectedOutletId && (
            <Button
              onClick={() => setBulkDialogOpen(true)}
              className="bg-ink hover:bg-ink-hover"
            >
              <TrendingDown className="mr-1.5 h-4 w-4" />
              Bulk set ({productsWithoutParCount})
            </Button>
          )}
        </div>
      </div>

      {/* Outlet Selector */}
      <div className="mt-4">
        <label className="text-sm font-medium text-text-2">Outlet</label>
        <select
          className="mt-1 w-full max-w-xs rounded-md border border-line px-3 py-2 text-sm"
          value={selectedOutletId}
          onChange={(e) => setSelectedOutletId(e.target.value)}
        >
          {outlets.length === 0 && <option value="">No outlets</option>}
          {outlets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
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
 ? "border-text bg-raised font-semibold text-text"
 : "border-line text-text-2 hover:bg-sunken"
}`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state banner — shown when no products have par levels configured */}
      {!loading && products.length > 0 && productsWithoutParCount === products.length && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-line bg-info-soft px-4 py-3">
          <Sparkles className="mt-0.5 h-5 w-5 flex-shrink-0 text-info-text" />
          <div className="text-sm text-info-text">
            <p className="font-medium">No par levels configured yet</p>
            <p className="mt-0.5 text-info-text">
              Use{" "}
              <button
                onClick={() => setShowRecalcSettings(true)}
                className="font-medium underline underline-offset-2 hover:text-info-text"
              >
                Smart recalculate
              </button>{" "}
              to auto-set par levels based on your sales data, or click{" "}
              <span className="font-medium">&lsquo;Set&rsquo;</span> on individual products to configure them manually.
            </p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="mt-4 rounded-xl border border-line bg-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-sunken/50">
              <th className="px-4 py-3 text-left font-medium text-text-2">Product</th>
              <th className="px-4 py-3 text-left font-medium text-text-2">SKU</th>
              <th className="px-4 py-3 text-left font-medium text-text-2">Category</th>
              <th className="px-4 py-3 text-left font-medium text-text-2">Order unit</th>
              <th className="px-4 py-3 text-right font-medium text-text-2">Current stock</th>
              <th className="px-4 py-3 text-right font-medium text-text-2">Par level</th>
              <th className="px-4 py-3 text-right font-medium text-text-2">Reorder point</th>
              <th className="px-4 py-3 text-right font-medium text-text-2">Avg daily usage</th>
              <th className="px-4 py-3 text-center font-medium text-text-2">Status</th>
              <th className="px-4 py-3 text-right font-medium text-text-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-brand-text" />
                  <p className="mt-2 text-sm text-text-2">Loading...</p>
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((product) => {
                const par = getParLevel(product.id);
                const stock = getStock(product.id);
                const status = getStatus(product.id);
                const sc = statusConfig[status];
                const isEditing = (field: EditingCell["field"]) =>
                  editingCell?.productId === product.id && editingCell?.field === field;
                const isQuickSetting = quickSetProductId === product.id;

                return (
                  <tr
                    key={product.id}
                    className={`border-b border-line transition-colors hover:bg-sunken/50 ${getRowBg(product.id)}`}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-text">{product.name}</p>
                    </td>
                    <td className="px-4 py-3">
                      <code className="rounded bg-sunken px-1.5 py-0.5 text-xs text-text-2">
                        {product.sku}
                      </code>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="text-xs">
                        {product.category}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-text-2">
                      <span className="font-medium">{getPackageLabel(product.id)}</span>
                      {getDefaultPackage(product.id) && (
                        <span className="ml-1 text-xs text-text-3">
                          (1 = {getConversionFactor(product.id)} {product.baseUom})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-text-2">
                      {stock !== null ? toPackageUnits(product.id, stock).toLocaleString() : "—"}
                    </td>

                    {/* Par Level - editable (displayed in package units) */}
                    <td className="px-4 py-3 text-right">
                      {par ? (
                        isEditing("parLevel") ? (
                          <input
                            type="number"
                            className="w-20 rounded border border-ink px-2 py-1 text-right text-sm"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleCellSave}
                            onKeyDown={handleCellKeyDown}
                            autoFocus
                          />
                        ) : (
                          <button
                            onClick={() => handleCellClick(product.id, "parLevel", par.parLevel)}
                            className="rounded px-2 py-1 text-right text-text hover:bg-brand-soft"
                          >
                            {toPackageUnits(product.id, par.parLevel).toLocaleString()}
                          </button>
                        )
                      ) : (
                        <span className="text-text-3">—</span>
                      )}
                    </td>

                    {/* Reorder Point - editable (displayed in package units) */}
                    <td className="px-4 py-3 text-right">
                      {par ? (
                        isEditing("reorderPoint") ? (
                          <input
                            type="number"
                            className="w-20 rounded border border-ink px-2 py-1 text-right text-sm"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleCellSave}
                            onKeyDown={handleCellKeyDown}
                            autoFocus
                          />
                        ) : (
                          <button
                            onClick={() => handleCellClick(product.id, "reorderPoint", par.reorderPoint)}
                            className="rounded px-2 py-1 text-right text-text hover:bg-brand-soft"
                          >
                            {toPackageUnits(product.id, par.reorderPoint).toLocaleString()}
                          </button>
                        )
                      ) : (
                        <span className="text-text-3">—</span>
                      )}
                    </td>

                    {/* Avg Daily Usage - editable (displayed in package units) */}
                    <td className="px-4 py-3 text-right">
                      {par ? (
                        isEditing("avgDailyUsage") ? (
                          <input
                            type="number"
                            className="w-20 rounded border border-ink px-2 py-1 text-right text-sm"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleCellSave}
                            onKeyDown={handleCellKeyDown}
                            autoFocus
                          />
                        ) : (
                          <button
                            onClick={() => handleCellClick(product.id, "avgDailyUsage", par.avgDailyUsage)}
                            className="rounded px-2 py-1 text-right text-text hover:bg-brand-soft"
                          >
                            {toPackageUnits(product.id, par.avgDailyUsage).toLocaleString()}
                          </button>
                        )
                      ) : (
                        <span className="text-text-3">—</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${sc.className}`}>
                        {sc.label}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      {!par && !isQuickSetting && (
                        <button
                          onClick={() => {
                            setQuickSetProductId(product.id);
                            setQuickSetForm(emptyQuickSet);
                          }}
                          className="rounded-md bg-brand-soft px-3 py-1 text-xs font-medium text-brand-text hover:bg-brand-soft"
                        >
                          Set
                        </button>
                      )}
                      {isQuickSetting && (
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="number"
                            placeholder={`Par (${getPackageLabel(product.id)})`}
                            className="w-20 rounded border border-line px-1.5 py-1 text-xs"
                            value={quickSetForm.parLevel}
                            onChange={(e) => setQuickSetForm((f) => ({ ...f, parLevel: e.target.value }))}
                          />
                          <input
                            type="number"
                            placeholder={`Reorder (${getPackageLabel(product.id)})`}
                            className="w-20 rounded border border-line px-1.5 py-1 text-xs"
                            value={quickSetForm.reorderPoint}
                            onChange={(e) => setQuickSetForm((f) => ({ ...f, reorderPoint: e.target.value }))}
                          />
                          <input
                            type="number"
                            placeholder={`Usage/day`}
                            className="w-20 rounded border border-line px-1.5 py-1 text-xs"
                            value={quickSetForm.avgDailyUsage}
                            onChange={(e) => setQuickSetForm((f) => ({ ...f, avgDailyUsage: e.target.value }))}
                          />
                          <button
                            onClick={() => handleQuickSet(product.id)}
                            className="rounded p-1 text-ok-text hover:bg-ok-soft"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setQuickSetProductId(null)}
                            className="rounded p-1 text-text-3 hover:bg-sunken"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-sm text-text-3">
                  No products found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Bulk Set Dialog */}
      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bulk set par levels</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <p className="text-sm text-text-2">
              Set par levels for all <strong>{productsWithoutParCount}</strong> products that
              don&apos;t have one yet. Par will be calculated as a multiple of estimated daily
              usage (current stock / 7 days, or 1 if no stock data).
            </p>
            <div>
              <label className="text-sm font-medium text-text-2">
                Multiplier (par = usage x multiplier)
              </label>
              <Input
                className="mt-1"
                type="number"
                min="1"
                step="0.5"
                value={bulkMultiplier}
                onChange={(e) => setBulkMultiplier(e.target.value)}
              />
              <p className="mt-1 text-xs text-text-3">
                Reorder point will be set at half the par level
              </p>
            </div>
            <Button
              onClick={handleBulkSet}
              disabled={saving}
              className="w-full bg-ink hover:bg-ink-hover disabled:opacity-50"
            >
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Set Par Levels for {productsWithoutParCount} Products
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Smart recalculate Settings Dialog */}
      <Dialog open={showRecalcSettings} onOpenChange={setShowRecalcSettings}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-info-text" />
              Smart recalculate
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="rounded-lg border border-line bg-info-soft p-3">
              <p className="text-sm text-info-text">
                Calculates par levels using actual sales data and supplier lead times.
              </p>
              <div className="mt-2 space-y-1 text-xs text-info-text">
                <p><strong>Reorder point</strong> = Daily Usage × (Lead Time + Safety Days)</p>
                <p><strong>Par level</strong> = Daily Usage × (Lead Time + Safety + Coverage Days)</p>
                <p><strong>Max level</strong> = Par Level × class multiplier (A 1.25× · B 1.5× · C 2×)</p>
                <p>
                  <strong>Coverage</strong> is set per value class to cap inventory value: high-spend
                  items (A) hold 2 days, mid (B) 3, cheap tail (C) 5.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-text-2">Safety days</label>
                <Input
                  className="mt-1"
                  type="number"
                  min="0"
                  max="14"
                  value={recalcSafetyDays}
                  onChange={(e) => setRecalcSafetyDays(e.target.value)}
                />
                <p className="mt-1 text-xs text-text-3">Buffer for demand spikes</p>
              </div>
              <div>
                <label className="text-sm font-medium text-text-2">Coverage days</label>
                <Input
                  className="mt-1"
                  type="number"
                  min="1"
                  max="30"
                  placeholder="Auto (by value class)"
                  value={recalcCoverageDays}
                  onChange={(e) => setRecalcCoverageDays(e.target.value)}
                />
                <p className="mt-1 text-xs text-text-3">Leave blank to optimise by value class</p>
              </div>
            </div>

            <div className="rounded-lg border border-line bg-sunken p-3">
              <div className="flex items-center gap-2 text-xs text-text-2">
                <Clock className="h-3.5 w-3.5" />
                <span>Lead times are sourced from supplier settings (cheapest supplier per product)</span>
              </div>
            </div>

            <Button
              onClick={() => {
                setShowRecalcSettings(false);
                handleSmartRecalculate();
              }}
              disabled={recalculating}
              className="w-full bg-ink text-on-ink hover:bg-ink-hover text-on-ink"
            >
              {recalculating ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-4 w-4" />
              )}
              Recalculate Par Levels
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Recalculate Results Dialog */}
      <Dialog open={showRecalcResult} onOpenChange={setShowRecalcResult}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-info-text" />
              Recalculation complete
            </DialogTitle>
          </DialogHeader>
          {recalcResult && (
            <div className="grid gap-4 py-2">
              {/* Summary Cards */}
              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-lg border border-line bg-ok-soft p-3 text-center">
                  <p className="text-2xl font-bold text-ok-text">{recalcResult.productsUpdated}</p>
                  <p className="text-xs text-ok-text">Products updated</p>
                </div>
                <div className="rounded-lg border border-line bg-info-soft p-3 text-center">
                  <p className="text-2xl font-bold text-info-text">{recalcResult.salesTransactions?.toLocaleString()}</p>
                  <p className="text-xs text-info-text">Sales analyzed</p>
                </div>
                <div className="rounded-lg border border-line bg-info-soft p-3 text-center">
                  <p className="text-2xl font-bold text-info-text">{recalcResult.lookbackDays}d</p>
                  <p className="text-xs text-info-text">Lookback period</p>
                </div>
                <div className="rounded-lg border border-line bg-warn-soft p-3 text-center">
                  <p className="text-2xl font-bold text-warn-text">
                    {recalcResult.projectedParValue != null
                      ? `RM ${Math.round(recalcResult.projectedParValue).toLocaleString()}`
                      : "—"}
                  </p>
                  <p className="text-xs text-warn-text">Value at Par (cap)</p>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs text-text-2">
                <span className="flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Safety: {recalcResult.settings?.safetyDays}d
                </span>
                <span className="flex items-center gap-1">
                  <Package className="h-3 w-3" /> Coverage:{" "}
                  {recalcResult.settings?.coverageDays != null
                    ? `${recalcResult.settings.coverageDays}d`
                    : "by value class (A 2d · B 3d · C 5d)"}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Menu items with sales: {recalcResult.menuItemsWithSales}
                </span>
              </div>

              {recalcResult.valueByClass && (
                <div className="flex items-center gap-3 text-xs text-text-2">
                  {(["A", "B", "C"] as const).map((c) => (
                    <span key={c} className="rounded-full border border-line bg-sunken px-2 py-0.5">
                      Class {c}: {recalcResult.valueByClass![c].products} items · RM{" "}
                      {Math.round(recalcResult.valueByClass![c].parValue).toLocaleString()}
                    </span>
                  ))}
                </div>
              )}

              {/* Details Table */}
              <div className="rounded-lg border border-line overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-sunken">
                      <th className="px-3 py-2 text-left font-medium text-text-2">Product</th>
                      <th className="px-3 py-2 text-center font-medium text-text-2">Class</th>
                      <th className="px-3 py-2 text-right font-medium text-text-2">Daily usage</th>
                      <th className="px-3 py-2 text-right font-medium text-text-2">Lead time</th>
                      <th className="px-3 py-2 text-right font-medium text-text-2">Reorder pt</th>
                      <th className="px-3 py-2 text-right font-medium text-text-2">Par level</th>
                      <th className="px-3 py-2 text-right font-medium text-text-2">Max level</th>
                      <th className="px-3 py-2 text-right font-medium text-text-2">Value @ Par</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recalcResult.details?.map((d) => {
                      const cf = getConversionFactor(d.productId);
                      const toPkg = (v: number) => cf > 0 ? Math.round((v / cf) * 100) / 100 : v;
                      return (
                        <tr key={d.productId || d.name} className="border-b border-line hover:bg-sunken/50">
                          <td className="px-3 py-2">
                            <span className="font-medium text-text">{d.name}</span>
                            <span className="ml-1 text-xs text-text-3">{getPackageLabel(d.productId)}</span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            {d.valueClass ? (
                              <span
                                className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold ${
 d.valueClass === "A"
 ? "bg-danger-soft text-danger-text"
 : d.valueClass === "B"
 ? "bg-warn-soft text-warn-text"
 : "bg-sunken text-text-2"
}`}
                              >
                                {d.valueClass}
                              </span>
                            ) : (
                              <span className="text-text-3">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-text-2">{toPkg(d.dailyUsage)}</td>
                          <td className="px-3 py-2 text-right">
                            <span className="inline-flex items-center gap-1 text-text-2">
                              <Clock className="h-3 w-3 text-text-3" />
                              {d.leadTime}d
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-warn-text">{toPkg(d.reorderPoint)}</td>
                          <td className="px-3 py-2 text-right font-medium text-info-text">{toPkg(d.parLevel)}</td>
                          <td className="px-3 py-2 text-right font-medium text-info-text">{toPkg(d.maxLevel)}</td>
                          <td className="px-3 py-2 text-right text-text-2">
                            {d.parValue != null && d.parValue > 0 ? `RM ${d.parValue.toLocaleString()}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                    {(!recalcResult.details || recalcResult.details.length === 0) && (
                      <tr>
                        <td colSpan={8} className="px-3 py-8 text-center text-sm text-text-3">
                          No products calculated. Ensure sales data and menu ingredients are set up.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <Button
                onClick={() => setShowRecalcResult(false)}
                variant="outline"
                className="w-full"
              >
                Done
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
