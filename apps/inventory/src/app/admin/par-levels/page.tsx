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
import { Search, Loader2, TrendingDown, Check, X } from "lucide-react";

type Product = {
  id: string;
  name: string;
  sku: string;
  category: string;
  baseUom: string;
};

type Branch = {
  id: string;
  name: string;
};

type ParLevel = {
  id: string;
  productId: string;
  branchId: string;
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
  const [branches, setBranches] = useState<Branch[]>([]);
  const [parLevels, setParLevels] = useState<ParLevel[]>([]);
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
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

  // Load branches and products on mount
  useEffect(() => {
    Promise.all([
      fetch("/api/products").then((r) => r.json()),
      fetch("/api/branches").then((r) => r.json()),
    ]).then(([productsData, branchesData]) => {
      setProducts(productsData);
      setBranches(branchesData);
      if (branchesData.length > 0) {
        setSelectedBranchId(branchesData[0].id);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const loadBranchData = useCallback((branchId: string) => {
    if (!branchId) return;
    Promise.all([
      fetch("/api/par-levels").then((r) => r.json()),
      fetch(`/api/stock-levels?branchId=${branchId}`).then((r) => r.json()),
    ]).then(([parData, stockData]) => {
      setParLevels(parData);
      setStockLevels(stockData.items || []);
    });
  }, []);

  // Load par levels and stock when branch changes
  useEffect(() => {
    if (selectedBranchId) {
      loadBranchData(selectedBranchId);
    }
  }, [selectedBranchId, loadBranchData]);

  const getParLevel = (productId: string): ParLevel | undefined =>
    parLevels.find((p) => p.productId === productId && p.branchId === selectedBranchId);

  const getStock = (productId: string): number | null => {
    const sl = stockLevels.find((s) => s.productId === productId);
    return sl ? sl.currentQty : null;
  };

  const getStatus = (productId: string): "none" | "critical" | "low" | "ok" => {
    const par = getParLevel(productId);
    const stock = getStock(productId);
    if (!par) return "none";
    if (stock === null) return "none";
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
      branchId: selectedBranchId,
      parLevel: values.parLevel ?? existing?.parLevel ?? 0,
      reorderPoint: values.reorderPoint ?? existing?.reorderPoint ?? 0,
      avgDailyUsage: values.avgDailyUsage ?? existing?.avgDailyUsage ?? 0,
    };
    try {
      await fetch("/api/par-levels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      loadBranchData(selectedBranchId);
    } finally {
      setSaving(false);
    }
  };

  const handleCellClick = (productId: string, field: EditingCell["field"], currentValue: number) => {
    setEditingCell({ productId, field });
    setEditValue(currentValue.toString());
  };

  const handleCellSave = () => {
    if (!editingCell) return;
    const numValue = parseFloat(editValue);
    if (isNaN(numValue) || numValue < 0) {
      setEditingCell(null);
      return;
    }
    saveParLevel(editingCell.productId, { [editingCell.field]: numValue });
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
    saveParLevel(productId, {
      parLevel: par,
      reorderPoint: reorder,
      avgDailyUsage: isNaN(usage) ? 0 : usage,
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
          return fetch("/api/par-levels", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              productId: p.id,
              branchId: selectedBranchId,
              parLevel: Math.round(baseUsage * multiplier),
              reorderPoint: Math.round(baseUsage * (multiplier / 2)),
              avgDailyUsage: baseUsage,
            }),
          });
        })
      );
      loadBranchData(selectedBranchId);
      setBulkDialogOpen(false);
    } finally {
      setSaving(false);
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
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Par Levels</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Manage reorder points and target stock levels per product
          </p>
        </div>
        {productsWithoutParCount > 0 && selectedBranchId && (
          <Button
            onClick={() => setBulkDialogOpen(true)}
            className="bg-terracotta hover:bg-terracotta-dark"
          >
            <TrendingDown className="mr-1.5 h-4 w-4" />
            Bulk Set ({productsWithoutParCount})
          </Button>
        )}
      </div>

      {/* Branch Selector */}
      <div className="mt-4">
        <label className="text-sm font-medium text-gray-700">Branch</label>
        <select
          className="mt-1 w-full max-w-xs rounded-md border border-gray-200 px-3 py-2 text-sm"
          value={selectedBranchId}
          onChange={(e) => setSelectedBranchId(e.target.value)}
        >
          {branches.length === 0 && <option value="">No branches</option>}
          {branches.map((b) => (
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

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left font-medium text-gray-500">Product</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">SKU</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Category</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Base UOM</th>
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
                    <td className="px-4 py-3 text-gray-600">{product.baseUom}</td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {stock !== null ? stock.toLocaleString() : "—"}
                    </td>

                    {/* Par Level - editable */}
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
                            {par.parLevel.toLocaleString()}
                          </button>
                        )
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>

                    {/* Reorder Point - editable */}
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
                            {par.reorderPoint.toLocaleString()}
                          </button>
                        )
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>

                    {/* Avg Daily Usage - editable */}
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
                            {par.avgDailyUsage.toLocaleString()}
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
                            placeholder="Par"
                            className="w-16 rounded border border-gray-200 px-1.5 py-1 text-xs"
                            value={quickSetForm.parLevel}
                            onChange={(e) => setQuickSetForm((f) => ({ ...f, parLevel: e.target.value }))}
                          />
                          <input
                            type="number"
                            placeholder="Reorder"
                            className="w-16 rounded border border-gray-200 px-1.5 py-1 text-xs"
                            value={quickSetForm.reorderPoint}
                            onChange={(e) => setQuickSetForm((f) => ({ ...f, reorderPoint: e.target.value }))}
                          />
                          <input
                            type="number"
                            placeholder="Usage"
                            className="w-16 rounded border border-gray-200 px-1.5 py-1 text-xs"
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
        <DialogContent className="max-w-sm">
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
    </div>
  );
}
