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
    settings: { safetyDays: number; coverageDays: number };
    details: { productId: string; name: string; dailyUsage: number; leadTime: number; reorderPoint: number; parLevel: number; maxLevel: number }[];
  } | null>(null);
  const [showRecalcResult, setShowRecalcResult] = useState(false);
  const [recalcSafetyDays, setRecalcSafetyDays] = useState("1");
  const [recalcCoverageDays, setRecalcCoverageDays] = useState("3");
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
    none: { label: "No Par Set", className: "bg-gray-100 text-gray-500" },
    critical: { label: "Critical", className: "bg-red-100 text-red-700" },
    low: { label: "Low", className: "bg-amber-100 text-amber-700" },
    ok: { label: "OK", className: "bg-green-100 text-green-700" },
  };

  const getRowBg = (productId: string): string => {
    const status = getStatus(productId);
    switch (status) {
      case "critical": return "bg-red-50/50";
      case "low": return "bg-amber-50/50";
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
          coverageDays: parseInt(recalcCoverageDays) || 3,
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
    <div className="p-3 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Par Levels</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Manage reorder points and target stock levels per product
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedOutletId && (
            <Button
              onClick={() => setShowRecalcSettings(true)}
              disabled={recalculating}
              variant="outline"
              className="border-purple-200 text-purple-700 hover:bg-purple-50"
            >
              {recalculating ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-4 w-4" />
              )}
              Smart Recalculate
            </Button>
          )}
          {productsWithoutParCount > 0 && selectedOutletId && (
            <Button
              onClick={() => setBulkDialogOpen(true)}
              className="bg-terracotta hover:bg-terracotta-dark"
            >
              <TrendingDown className="mr-1.5 h-4 w-4" />
              Bulk Set ({productsWithoutParCount})
            </Button>
          )}
        </div>
      </div>

      {/* Outlet Selector */}
      <div className="mt-4">
        <label className="text-sm font-medium text-gray-700">Outlet</label>
        <select
          className="mt-1 w-full max-w-xs rounded-md border border-gray-200 px-3 py-2 text-sm"
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

      {/* Empty state banner — shown when no products have par levels configured */}
      {!loading && products.length > 0 && productsWithoutParCount === products.length && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <Sparkles className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-500" />
          <div className="text-sm text-blue-800">
            <p className="font-medium">No par levels configured yet</p>
            <p className="mt-0.5 text-blue-600">
              Use{" "}
              <button
                onClick={() => setShowRecalcSettings(true)}
                className="font-medium underline underline-offset-2 hover:text-blue-800"
              >
                Smart Recalculate
              </button>{" "}
              to auto-set par levels based on your sales data, or click{" "}
              <span className="font-medium">&lsquo;Set&rsquo;</span> on individual products to configure them manually.
            </p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left font-medium text-gray-500">Product</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">SKU</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Category</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Order Unit</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Current Stock</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Par Level</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Reorder Point</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Avg Daily Usage</th>
              <th className="px-4 py-3 text-center font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-terracotta" />
                  <p className="mt-2 text-sm text-gray-500">Loading...</p>
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
                    className={`border-b border-gray-50 transition-colors hover:bg-gray-50/50 ${getRowBg(product.id)}`}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{product.name}</p>
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
                    <td className="px-4 py-3 text-gray-600">
                      <span className="font-medium">{getPackageLabel(product.id)}</span>
                      {getDefaultPackage(product.id) && (
                        <span className="ml-1 text-xs text-gray-400">
                          (1 = {getConversionFactor(product.id)} {product.baseUom})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {stock !== null ? toPackageUnits(product.id, stock).toLocaleString() : "—"}
                    </td>

                    {/* Par Level - editable (displayed in package units) */}
                    <td className="px-4 py-3 text-right">
                      {par ? (
                        isEditing("parLevel") ? (
                          <input
                            type="number"
                            className="w-20 rounded border border-terracotta px-2 py-1 text-right text-sm"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleCellSave}
                            onKeyDown={handleCellKeyDown}
                            autoFocus
                          />
                        ) : (
                          <button
                            onClick={() => handleCellClick(product.id, "parLevel", par.parLevel)}
                            className="rounded px-2 py-1 text-right text-gray-900 hover:bg-terracotta/10"
                          >
                            {toPackageUnits(product.id, par.parLevel).toLocaleString()}
                          </button>
                        )
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>

                    {/* Reorder Point - editable (displayed in package units) */}
                    <td className="px-4 py-3 text-right">
                      {par ? (
                        isEditing("reorderPoint") ? (
                          <input
                            type="number"
                            className="w-20 rounded border border-terracotta px-2 py-1 text-right text-sm"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleCellSave}
                            onKeyDown={handleCellKeyDown}
                            autoFocus
                          />
                        ) : (
                          <button
                            onClick={() => handleCellClick(product.id, "reorderPoint", par.reorderPoint)}
                            className="rounded px-2 py-1 text-right text-gray-900 hover:bg-terracotta/10"
                          >
                            {toPackageUnits(product.id, par.reorderPoint).toLocaleString()}
                          </button>
                        )
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>

                    {/* Avg Daily Usage - editable (displayed in package units) */}
                    <td className="px-4 py-3 text-right">
                      {par ? (
                        isEditing("avgDailyUsage") ? (
                          <input
                            type="number"
                            className="w-20 rounded border border-terracotta px-2 py-1 text-right text-sm"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleCellSave}
                            onKeyDown={handleCellKeyDown}
                            autoFocus
                          />
                        ) : (
                          <button
                            onClick={() => handleCellClick(product.id, "avgDailyUsage", par.avgDailyUsage)}
                            className="rounded px-2 py-1 text-right text-gray-900 hover:bg-terracotta/10"
                          >
                            {toPackageUnits(product.id, par.avgDailyUsage).toLocaleString()}
                          </button>
                        )
                      ) : (
                        <span className="text-gray-300">—</span>
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
                          className="rounded-md bg-terracotta/10 px-3 py-1 text-xs font-medium text-terracotta hover:bg-terracotta/20"
                        >
                          Set
                        </button>
                      )}
                      {isQuickSetting && (
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="number"
                            placeholder={`Par (${getPackageLabel(product.id)})`}
                            className="w-20 rounded border border-gray-200 px-1.5 py-1 text-xs"
                            value={quickSetForm.parLevel}
                            onChange={(e) => setQuickSetForm((f) => ({ ...f, parLevel: e.target.value }))}
                          />
                          <input
                            type="number"
                            placeholder={`Reorder (${getPackageLabel(product.id)})`}
                            className="w-20 rounded border border-gray-200 px-1.5 py-1 text-xs"
                            value={quickSetForm.reorderPoint}
                            onChange={(e) => setQuickSetForm((f) => ({ ...f, reorderPoint: e.target.value }))}
                          />
                          <input
                            type="number"
                            placeholder={`Usage/day`}
                            className="w-20 rounded border border-gray-200 px-1.5 py-1 text-xs"
                            value={quickSetForm.avgDailyUsage}
                            onChange={(e) => setQuickSetForm((f) => ({ ...f, avgDailyUsage: e.target.value }))}
                          />
                          <button
                            onClick={() => handleQuickSet(product.id)}
                            className="rounded p-1 text-green-600 hover:bg-green-50"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setQuickSetProductId(null)}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100"
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
                <td colSpan={10} className="px-4 py-12 text-center text-sm text-gray-400">
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
            <DialogTitle>Bulk Set Par Levels</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <p className="text-sm text-gray-500">
              Set par levels for all <strong>{productsWithoutParCount}</strong> products that
              don&apos;t have one yet. Par will be calculated as a multiple of estimated daily
              usage (current stock / 7 days, or 1 if no stock data).
            </p>
            <div>
              <label className="text-sm font-medium text-gray-700">
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
              <p className="mt-1 text-xs text-gray-400">
                Reorder point will be set at half the par level
              </p>
            </div>
            <Button
              onClick={handleBulkSet}
              disabled={saving}
              className="w-full bg-terracotta hover:bg-terracotta-dark disabled:opacity-50"
            >
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Set Par Levels for {productsWithoutParCount} Products
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Smart Recalculate Settings Dialog */}
      <Dialog open={showRecalcSettings} onOpenChange={setShowRecalcSettings}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-600" />
              Smart Recalculate
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="rounded-lg border border-purple-100 bg-purple-50/50 p-3">
              <p className="text-sm text-purple-800">
                Calculates par levels using actual sales data and supplier lead times.
              </p>
              <div className="mt-2 space-y-1 text-xs text-purple-600">
                <p><strong>Reorder Point</strong> = Daily Usage × (Lead Time + Safety Days)</p>
                <p><strong>Par Level</strong> = Daily Usage × (Lead Time + Safety + Coverage Days)</p>
                <p><strong>Max Level</strong> = Par Level × 1.5</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Safety Days</label>
                <Input
                  className="mt-1"
                  type="number"
                  min="0"
                  max="14"
                  value={recalcSafetyDays}
                  onChange={(e) => setRecalcSafetyDays(e.target.value)}
                />
                <p className="mt-1 text-xs text-gray-400">Buffer for demand spikes</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Coverage Days</label>
                <Input
                  className="mt-1"
                  type="number"
                  min="1"
                  max="30"
                  value={recalcCoverageDays}
                  onChange={(e) => setRecalcCoverageDays(e.target.value)}
                />
                <p className="mt-1 text-xs text-gray-400">Stock after reorder arrives</p>
              </div>
            </div>

            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <div className="flex items-center gap-2 text-xs text-gray-500">
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
              className="w-full bg-purple-600 hover:bg-purple-700 text-white"
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
              <Sparkles className="h-5 w-5 text-purple-600" />
              Recalculation Complete
            </DialogTitle>
          </DialogHeader>
          {recalcResult && (
            <div className="grid gap-4 py-2">
              {/* Summary Cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-green-100 bg-green-50 p-3 text-center">
                  <p className="text-2xl font-bold text-green-700">{recalcResult.productsUpdated}</p>
                  <p className="text-xs text-green-600">Products Updated</p>
                </div>
                <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-center">
                  <p className="text-2xl font-bold text-blue-700">{recalcResult.salesTransactions?.toLocaleString()}</p>
                  <p className="text-xs text-blue-600">Sales Analyzed</p>
                </div>
                <div className="rounded-lg border border-purple-100 bg-purple-50 p-3 text-center">
                  <p className="text-2xl font-bold text-purple-700">{recalcResult.lookbackDays}d</p>
                  <p className="text-xs text-purple-600">Lookback Period</p>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Safety: {recalcResult.settings?.safetyDays}d
                </span>
                <span className="flex items-center gap-1">
                  <Package className="h-3 w-3" /> Coverage: {recalcResult.settings?.coverageDays}d
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Menu items with sales: {recalcResult.menuItemsWithSales}
                </span>
              </div>

              {/* Details Table */}
              <div className="rounded-lg border border-gray-200 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Product</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Daily Usage</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Lead Time</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Reorder Pt</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Par Level</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Max Level</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recalcResult.details?.map((d) => {
                      const cf = getConversionFactor(d.productId);
                      const toPkg = (v: number) => cf > 0 ? Math.round((v / cf) * 100) / 100 : v;
                      return (
                        <tr key={d.productId || d.name} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-3 py-2">
                            <span className="font-medium text-gray-900">{d.name}</span>
                            <span className="ml-1 text-xs text-gray-400">{getPackageLabel(d.productId)}</span>
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600">{toPkg(d.dailyUsage)}</td>
                          <td className="px-3 py-2 text-right">
                            <span className="inline-flex items-center gap-1 text-gray-600">
                              <Clock className="h-3 w-3 text-gray-400" />
                              {d.leadTime}d
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-amber-600">{toPkg(d.reorderPoint)}</td>
                          <td className="px-3 py-2 text-right font-medium text-blue-600">{toPkg(d.parLevel)}</td>
                          <td className="px-3 py-2 text-right font-medium text-purple-600">{toPkg(d.maxLevel)}</td>
                        </tr>
                      );
                    })}
                    {(!recalcResult.details || recalcResult.details.length === 0) && (
                      <tr>
                        <td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-400">
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
