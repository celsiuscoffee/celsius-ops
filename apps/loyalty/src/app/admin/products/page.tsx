"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Package,
  Search,
  RefreshCw,
  Coffee,
  Cake,
  Tag,
  ShoppingBag,
  Check,
  X,
  AlertCircle,
  Download,
  Loader2,
  Clock,
  Eye,
  EyeOff,
} from "lucide-react";
import { fetchProducts, syncProductsFromStoreHub } from "@/lib/api";
import type { Product } from "@/types";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { exportToCSV } from "@/lib/export";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const categoryIcons: Record<string, React.ElementType> = {
  Beverage: Coffee,
  Food: Cake,
  Retail: ShoppingBag,
  Default: Tag,
};

function getCategoryIcon(category: string | null): React.ElementType {
  if (!category) return Tag;
  for (const [key, icon] of Object.entries(categoryIcons)) {
    if (category.toLowerCase().includes(key.toLowerCase())) return icon;
  }
  return Tag;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    success: boolean;
    synced?: number;
    errors?: number;
    error?: string;
  } | null>(null);

  async function loadProducts() {
    setLoading(true);
    setError(false);
    try {
      const data = await fetchProducts("brand-celsius", { all: true });
      setProducts(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProducts();
  }, []);

  // Derive categories from products
  const categories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach((p) => {
      if (p.category) cats.add(p.category);
    });
    return Array.from(cats).sort();
  }, [products]);

  // Filter products
  const filtered = useMemo(() => {
    let list = products;
    if (categoryFilter !== "all") {
      list = list.filter((p) => p.category === categoryFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku?.toLowerCase().includes(q) ||
          p.category?.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return list;
  }, [products, categoryFilter, search]);

  // Group by category for display
  const grouped = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of filtered) {
      const cat = p.category || "Uncategorized";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncProductsFromStoreHub("brand-celsius");
      setSyncResult(result);
      if (result.success) {
        await loadProducts();
      }
    } catch {
      setSyncResult({ success: false, error: "Network error" });
    } finally {
      setSyncing(false);
    }
  }

  // Last sync time
  const lastSynced = useMemo(() => {
    if (products.length === 0) return null;
    const dates = products
      .filter((p) => p.synced_at)
      .map((p) => new Date(p.synced_at!).getTime());
    if (dates.length === 0) return null;
    return new Date(Math.max(...dates));
  }, [products]);

  function handleExport() {
    const rows = products.map((p) => ({
      name: p.name,
      sku: p.sku || "",
      category: p.category || "",
      price: p.price,
      online_price: p.online_price || "",
      tags: p.tags.join(", "),
      available: p.is_available ? "Yes" : "No",
      featured: p.is_featured ? "Yes" : "No",
      stock_tracked: p.track_stock ? "Yes" : "No",
      stock_level: p.stock_level ?? "",
      synced_at: p.synced_at || "",
    }));
    const columns = [
      { key: "name", label: "Name" },
      { key: "sku", label: "SKU" },
      { key: "category", label: "Category" },
      { key: "price", label: "Price" },
      { key: "online_price", label: "Online Price" },
      { key: "tags", label: "Tags" },
      { key: "available", label: "Available" },
      { key: "featured", label: "Featured" },
      { key: "stock_tracked", label: "Stock Tracked" },
      { key: "stock_level", label: "Stock Level" },
      { key: "synced_at", label: "Last Synced" },
    ];
    exportToCSV(rows, columns, "celsius-products");
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Loading products...
          </p>
        </div>
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <AlertCircle className="w-8 h-8 mx-auto text-red-400" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Failed to load products
          </p>
          <button
            onClick={loadProducts}
            className="text-sm text-[#C2452D] hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 md:px-6 lg:px-8 py-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Products
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Synced from StoreHub POS
            {lastSynced && (
              <span className="ml-2 inline-flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                Last sync:{" "}
                {lastSynced.toLocaleDateString("en-MY", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={products.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 dark:border-neutral-700 rounded-lg hover:bg-gray-50 dark:hover:bg-neutral-800 disabled:opacity-50 text-gray-700 dark:text-gray-300"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className={cn(
              "inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg font-medium transition-colors",
              syncing
                ? "bg-gray-100 text-gray-400 dark:bg-neutral-800 dark:text-gray-500"
                : "bg-[#C2452D] text-white hover:bg-[#a93b26]"
            )}
          >
            <RefreshCw
              className={cn("w-4 h-4", syncing && "animate-spin")}
            />
            {syncing ? "Syncing..." : "Sync from StoreHub"}
          </button>
        </div>
      </div>

      {/* ── Sync result banner ── */}
      {syncResult && (
        <div
          className={cn(
            "flex items-center gap-2 px-4 py-3 rounded-lg text-sm",
            syncResult.success
              ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
              : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
          )}
        >
          {syncResult.success ? (
            <>
              <Check className="w-4 h-4" />
              Synced {syncResult.synced} product{syncResult.synced !== 1 ? "s" : ""} from StoreHub
              {(syncResult.errors ?? 0) > 0 && (
                <span className="ml-1 text-amber-600 dark:text-amber-400">
                  ({syncResult.errors} error{syncResult.errors !== 1 ? "s" : ""})
                </span>
              )}
            </>
          ) : (
            <>
              <X className="w-4 h-4" />
              {syncResult.error || "Sync failed"}
            </>
          )}
          <button
            onClick={() => setSyncResult(null)}
            className="ml-auto hover:opacity-70"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Stats cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-gray-200 dark:border-neutral-700 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Total Products
          </p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {products.length}
          </p>
        </div>
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-gray-200 dark:border-neutral-700 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Categories
          </p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {categories.length}
          </p>
        </div>
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-gray-200 dark:border-neutral-700 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Available
          </p>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">
            {products.filter((p) => p.is_available).length}
          </p>
        </div>
        <div className="bg-white dark:bg-neutral-800 rounded-xl border border-gray-200 dark:border-neutral-700 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Unavailable
          </p>
          <p className="text-2xl font-bold text-red-500 dark:text-red-400 mt-1">
            {products.filter((p) => !p.is_available).length}
          </p>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#C2452D]/50"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2.5 text-sm border border-gray-200 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#C2452D]/50"
        >
          <option value="all">All Categories ({products.length})</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat} ({products.filter((p) => p.category === cat).length})
            </option>
          ))}
        </select>
      </div>

      {/* ── Empty state ── */}
      {products.length === 0 && (
        <div className="text-center py-16 bg-white dark:bg-neutral-800 rounded-xl border border-gray-200 dark:border-neutral-700">
          <Package className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600" />
          <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">
            No products synced yet
          </h3>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
            Click &quot;Sync from StoreHub&quot; to pull your product catalog from
            StoreHub POS into the loyalty system.
          </p>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg font-medium bg-[#C2452D] text-white hover:bg-[#a93b26]"
          >
            <RefreshCw className={cn("w-4 h-4", syncing && "animate-spin")} />
            {syncing ? "Syncing..." : "Sync Now"}
          </button>
        </div>
      )}

      {/* ── No results ── */}
      {products.length > 0 && filtered.length === 0 && (
        <div className="text-center py-12">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No products match your search
          </p>
        </div>
      )}

      {/* ── Product list grouped by category ── */}
      {grouped.map(([category, items]) => {
        const CatIcon = getCategoryIcon(category);
        return (
          <div key={category}>
            <div className="flex items-center gap-2 mb-3">
              <CatIcon className="w-4 h-4 text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                {category}
              </h2>
              <span className="text-xs text-gray-400">({items.length})</span>
            </div>
            <div className="bg-white dark:bg-neutral-800 rounded-xl border border-gray-200 dark:border-neutral-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-neutral-700 text-gray-500 dark:text-gray-400 text-left">
                      <th className="px-4 py-3 font-medium">Product</th>
                      <th className="px-4 py-3 font-medium hidden sm:table-cell">
                        SKU
                      </th>
                      <th className="px-4 py-3 font-medium text-right">
                        Price
                      </th>
                      <th className="px-4 py-3 font-medium hidden md:table-cell">
                        Tags
                      </th>
                      <th className="px-4 py-3 font-medium text-center">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((product) => (
                      <tr
                        key={product.id}
                        className="border-b border-gray-50 dark:border-neutral-700/50 last:border-0 hover:bg-gray-50/50 dark:hover:bg-neutral-700/30"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {product.image_url ? (
                              <img
                                src={product.image_url}
                                alt={product.name}
                                className="w-10 h-10 rounded-lg object-cover bg-gray-100 dark:bg-neutral-700"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-neutral-700 flex items-center justify-center">
                                <Package className="w-5 h-5 text-gray-400" />
                              </div>
                            )}
                            <div>
                              <p className="font-medium text-gray-900 dark:text-white">
                                {product.name}
                              </p>
                              {product.modifiers.length > 0 && (
                                <p className="text-xs text-gray-400 mt-0.5">
                                  {product.modifiers.length} modifier group
                                  {product.modifiers.length > 1 ? "s" : ""}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden sm:table-cell font-mono text-xs">
                          {product.sku || "-"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-medium text-gray-900 dark:text-white">
                            {formatCurrency(product.price)}
                          </span>
                          {product.online_price != null &&
                            product.online_price !== product.price && (
                              <span className="block text-xs text-gray-400">
                                Online: {formatCurrency(product.online_price)}
                              </span>
                            )}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <div className="flex flex-wrap gap-1">
                            {product.tags.slice(0, 3).map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-neutral-700 text-gray-600 dark:text-gray-300"
                              >
                                {tag}
                              </span>
                            ))}
                            {product.tags.length > 3 && (
                              <span className="text-xs text-gray-400">
                                +{product.tags.length - 3}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {product.is_available ? (
                            <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                              <Eye className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Active</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                              <EyeOff className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Hidden</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })}

      {/* ── Footer info ── */}
      {products.length > 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center pb-4">
          Showing {filtered.length} of {products.length} products
          {lastSynced && (
            <>
              {" "}
              &middot; Auto-syncs every 6 hours from StoreHub
            </>
          )}
        </p>
      )}
    </div>
  );
}
