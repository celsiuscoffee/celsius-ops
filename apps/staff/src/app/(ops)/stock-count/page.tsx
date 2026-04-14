"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Check,
  Search,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Loader2,
  Delete,
} from "lucide-react";

const STORAGE_AREA_LABELS: Record<string, string> = {
  FRIDGE: "Fridge",
  DRY_STORE: "Dry Store",
  COUNTER: "Counter",
  FREEZER: "Freezer",
  BAR: "Bar",
};

interface Product {
  id: string;
  name: string;
  sku: string;
  baseUom: string;
  storageArea: string;
  categoryId: string;
  category: string;
  packages: { id: string; name: string; label: string; uom: string; conversion: number; isDefault: boolean }[];
  suppliers: { name: string; price: number; uom: string }[];
  checkFrequency: string;
}

interface UserSession {
  id: string;
  name: string;
  role: string;
  outletId: string | null;
}

// Each item stores: counted qty + which package it was counted in
interface ItemCount {
  qty: number;
  packageId: string | null;
}

interface GroupedArea {
  area: string;
  items: Product[];
}

const STORAGE_KEY = "celsius-stock-check-draft-v2";

function loadDraft(freq: string): Record<string, ItemCount> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (data.frequency !== freq) return {};
    const today = new Date().toISOString().split("T")[0];
    if (data.date !== today) { localStorage.removeItem(STORAGE_KEY); return {}; }
    return data.items || {};
  } catch { return {}; }
}

function saveDraft(freq: string, items: Record<string, ItemCount>) {
  try {
    const today = new Date().toISOString().split("T")[0];
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ frequency: freq, date: today, items }));
  } catch { /* ignore */ }
}

export default function StockCheckPage() {
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">("daily");
  const [search, setSearch] = useState("");
  const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<Record<string, ItemCount>>(() => loadDraft("daily"));
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  // Keypad state
  const [keypadItem, setKeypadItem] = useState<Product | null>(null);
  const [keypadPkgId, setKeypadPkgId] = useState<string | null>(null);
  const [keypadValue, setKeypadValue] = useState("");

  // Data
  const [products, setProducts] = useState<Product[]>([]);
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Autosave
  useEffect(() => {
    if (Object.keys(counts).length > 0) {
      saveDraft(frequency, counts);
      setLastSaved(new Date().toLocaleTimeString());
    }
  }, [counts, frequency]);

  // Fetch data
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const [productsRes, userRes] = await Promise.all([
          fetch("/api/products/options"),
          fetch("/api/auth/me"),
        ]);
        if (!productsRes.ok) throw new Error("Failed to load products");
        if (!userRes.ok) throw new Error("Failed to load user session");
        setProducts(await productsRes.json());
        setUser(await userRes.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Group + filter by frequency
  const groupedData: GroupedArea[] = useMemo(() => {
    const freqKey = frequency.toUpperCase();
    const filtered = freqKey === "DAILY"
      ? products.filter((p) => p.checkFrequency === "DAILY")
      : freqKey === "WEEKLY"
        ? products.filter((p) => p.checkFrequency === "DAILY" || p.checkFrequency === "WEEKLY")
        : products;
    const groups: Record<string, Product[]> = {};
    for (const p of filtered) {
      const area = p.storageArea || "UNCATEGORIZED";
      if (!groups[area]) groups[area] = [];
      groups[area].push(p);
    }
    const knownOrder = ["FRIDGE", "COUNTER", "DRY_STORE", "FREEZER", "BAR"];
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      const ai = knownOrder.indexOf(a);
      const bi = knownOrder.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
    return sortedKeys.map((area) => ({ area, items: groups[area] }));
  }, [products, frequency]);

  const displayLabel = (area: string) =>
    STORAGE_AREA_LABELS[area] || area.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const getDefaultPkg = useCallback((product: Product) => {
    if (frequency === "monthly") {
      const bulkPkg = product.packages.find((p) => !p.isDefault);
      if (bulkPkg) return bulkPkg;
    }
    return product.packages.find((p) => p.isDefault) || product.packages[0] || null;
  }, [frequency]);

  const getUomLabel = useCallback((product: Product, packageId?: string | null) => {
    if (packageId) {
      const pkg = product.packages.find((p) => p.id === packageId);
      if (pkg) return pkg.label || pkg.name;
    }
    const pkg = getDefaultPkg(product);
    return pkg ? (pkg.label || pkg.name) : product.baseUom;
  }, [getDefaultPkg]);

  const totalItems = groupedData.reduce((acc, g) => acc + g.items.length, 0);
  const countedItems = groupedData.reduce((acc, g) => acc + g.items.filter((i) => counts[i.id] != null).length, 0);
  const progressPct = totalItems > 0 ? Math.round((countedItems / totalItems) * 100) : 0;

  // ── Keypad ──
  const openKeypad = (product: Product) => {
    const existing = counts[product.id];
    const defaultPkg = getDefaultPkg(product);
    setKeypadItem(product);
    setKeypadPkgId(existing?.packageId || defaultPkg?.id || null);
    setKeypadValue(existing ? String(existing.qty) : "");
  };

  const keypadPress = (key: string) => {
    if (key === "backspace") {
      setKeypadValue((v) => v.slice(0, -1));
    } else if (key === ".") {
      if (!keypadValue.includes(".")) setKeypadValue((v) => v + ".");
    } else {
      setKeypadValue((v) => (v === "0" && key !== "." ? key : v + key));
    }
  };

  const keypadConfirm = () => {
    if (!keypadItem) return;
    const qty = parseFloat(keypadValue);
    if (isNaN(qty) || qty < 0) return;
    const pkg = keypadPkgId
      ? keypadItem.packages.find((p) => p.id === keypadPkgId)
      : getDefaultPkg(keypadItem);
    const cf = pkg?.conversion || 1;
    setCounts((prev) => ({
      ...prev,
      [keypadItem.id]: { qty, packageId: keypadPkgId },
    }));
    setKeypadItem(null);
  };

  const keypadClear = () => {
    if (!keypadItem) return;
    setCounts((prev) => {
      const next = { ...prev };
      delete next[keypadItem.id];
      return next;
    });
    setKeypadItem(null);
  };

  // ── Submit ──
  const handleSubmit = async () => {
    if (!user?.outletId) {
      setError("No outlet assigned to your account.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const freqKey = frequency.toUpperCase();
      const relevantProducts = freqKey === "DAILY"
        ? products.filter((p) => p.checkFrequency === "DAILY")
        : freqKey === "WEEKLY"
          ? products.filter((p) => p.checkFrequency === "DAILY" || p.checkFrequency === "WEEKLY")
          : products;

      const items = relevantProducts.map((product) => {
        const count = counts[product.id];
        // Convert to base UOM
        let countedQtyBase: number | null = null;
        if (count) {
          const pkg = count.packageId
            ? product.packages.find((p) => p.id === count.packageId)
            : getDefaultPkg(product);
          const cf = pkg?.conversion || 1;
          countedQtyBase = count.qty * cf;
        }
        return {
          productId: product.id,
          productPackageId: count?.packageId || null,
          countedQty: countedQtyBase,
          isConfirmed: count != null,
          varianceReason: null,
        };
      });

      const res = await fetch("/api/stock-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outletId: user.outletId,
          countedById: user.id,
          frequency: frequency.toUpperCase(),
          notes: null,
          items,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error || "Failed to submit stock check");
      }
      setSubmitted(true);
      setCounts({});
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  const switchFrequency = (f: "daily" | "weekly" | "monthly") => {
    setFrequency(f);
    setCounts(loadDraft(f));
    setCollapsedAreas(new Set());
    setSubmitted(false);
  };

  const resetCheck = () => {
    setCounts({});
    setSubmitted(false);
    setLastSaved(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  const filteredData = groupedData
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.name.toLowerCase().includes(search.toLowerCase()) ||
          item.sku.toLowerCase().includes(search.toLowerCase())
      ),
    }))
    .filter((group) => group.items.length > 0);

  // Loading
  if (loading) {
    return (
      <>
        <TopBar title="Stock Count" />
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-terracotta" />
          <p className="mt-3 text-sm text-gray-500">Loading products...</p>
        </div>
      </>
    );
  }

  if (error && products.length === 0) {
    return (
      <>
        <TopBar title="Stock Count" />
        <div className="flex flex-col items-center justify-center py-20 px-4">
          <p className="text-sm font-medium text-red-600">{error}</p>
          <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </>
    );
  }

  // Success
  if (submitted) {
    return (
      <>
        <TopBar title="Stock Count" />
        <div className="flex flex-col items-center justify-center py-20 px-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <Check className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-gray-900">Stock Count Submitted</h2>
          <p className="mt-1 text-sm text-gray-500">Your count has been recorded.</p>
          <Button className="mt-6 bg-terracotta hover:bg-terracotta-dark" onClick={() => { setSubmitted(false); }}>
            Start New Count
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title="Stock Count" />

      {/* Frequency tabs + progress */}
      <div className="sticky top-0 z-40 border-b border-gray-200 bg-white">
        <div className="px-4 pt-3 pb-2">
          <div className="mx-auto flex max-w-lg items-center gap-1">
            {(["daily", "weekly", "monthly"] as const).map((f) => (
              <button
                key={f}
                onClick={() => switchFrequency(f)}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  frequency === f
                    ? "bg-terracotta text-white"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                {f}
              </button>
            ))}
            {countedItems > 0 && (
              <button
                onClick={resetCheck}
                className="ml-auto flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
              >
                <RotateCcw className="h-3 w-3" />
                Reset
              </button>
            )}
          </div>

          {/* Progress */}
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-gray-500">
              <span className="font-semibold text-gray-900">{countedItems}/{totalItems}</span> counted
              {lastSaved && <span className="ml-2 text-green-500">· saved {lastSaved}</span>}
            </span>
            <Badge
              variant={countedItems === totalItems ? "default" : "secondary"}
              className={countedItems === totalItems ? "bg-green-500" : ""}
            >
              {progressPct}%
            </Badge>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-terracotta transition-all duration-500" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="sticky top-[105px] z-30 border-b border-gray-100 bg-white px-4 py-2">
        <div className="mx-auto max-w-lg">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search product..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3">
          <div className="mx-auto max-w-lg rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        </div>
      )}

      {/* Items */}
      <div className="px-4 py-3 pb-28">
        <div className="mx-auto max-w-lg space-y-3">
          {filteredData.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-400">
              {search ? "No products match your search." : "No products found."}
            </p>
          )}
          {filteredData.map((group) => {
            const isCollapsed = collapsedAreas.has(group.area);
            const groupTotal = group.items.length;
            const groupCounted = group.items.filter((i) => counts[i.id] != null).length;
            const allCounted = groupCounted === groupTotal;

            return (
              <div key={group.area}>
                <div className="flex items-center justify-between py-1.5">
                  <button
                    onClick={() => setCollapsedAreas((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.area)) next.delete(group.area);
                      else next.add(group.area);
                      return next;
                    })}
                    className="flex items-center gap-2"
                  >
                    {isCollapsed
                      ? <ChevronRight className="h-4 w-4 text-gray-400" />
                      : <ChevronDown className="h-4 w-4 text-gray-400" />}
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {displayLabel(group.area)}
                    </span>
                    <span className={`text-xs ${allCounted ? "text-green-500" : "text-gray-400"}`}>
                      {groupCounted}/{groupTotal}
                    </span>
                  </button>
                  {allCounted && <Check className="h-4 w-4 text-green-500" />}
                </div>

                {!isCollapsed && (
                  <div className="space-y-1.5">
                    {group.items.map((item) => {
                      const count = counts[item.id];
                      const isCounted = count != null;
                      const uom = getUomLabel(item, count?.packageId);

                      return (
                        <Card
                          key={item.id}
                          className={`overflow-hidden transition-all active:scale-[0.98] ${isCounted ? "border-green-200 bg-green-50/30" : "bg-white"}`}
                          onClick={() => openKeypad(item)}
                        >
                          <div className="flex items-center gap-3 px-3 py-3 cursor-pointer">
                            {/* Count badge */}
                            <div
                              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${
                                isCounted
                                  ? "bg-green-100 text-green-700"
                                  : "bg-gray-100 text-gray-400"
                              }`}
                            >
                              {isCounted ? count.qty : "—"}
                            </div>

                            {/* Product info — NO balance shown (blind count) */}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-gray-900">{item.name}</p>
                              <p className="text-xs text-gray-400">{uom}</p>
                            </div>

                            {isCounted && (
                              <Check className="h-4 w-4 shrink-0 text-green-500" />
                            )}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom submit bar */}
      <div className="fixed bottom-14 left-0 right-0 z-40 border-t border-gray-200 bg-white px-4 py-2.5">
        <div className="mx-auto flex max-w-lg gap-2">
          <Button
            className="flex-1 bg-terracotta hover:bg-terracotta-dark"
            disabled={countedItems < totalItems || submitting}
            onClick={handleSubmit}
          >
            {submitting ? (
              <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Submitting...</>
            ) : (
              `Submit Count (${countedItems}/${totalItems})`
            )}
          </Button>
        </div>
      </div>

      {/* ── Keypad overlay ── */}
      {keypadItem && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          {/* Header */}
          <div className="border-b border-gray-200 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-semibold text-gray-900">{keypadItem.name}</h3>
                <p className="text-xs text-gray-400">{keypadItem.sku}</p>
              </div>
              <button
                onClick={() => setKeypadItem(null)}
                className="ml-3 rounded-lg p-2 text-gray-400 hover:bg-gray-100"
              >
                <span className="text-sm font-medium">Cancel</span>
              </button>
            </div>

            {/* Package selector */}
            {keypadItem.packages.length > 1 && (
              <div className="mt-2 flex gap-1.5 overflow-x-auto">
                {keypadItem.packages.map((pkg) => (
                  <button
                    key={pkg.id}
                    onClick={() => setKeypadPkgId(pkg.id)}
                    className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      keypadPkgId === pkg.id
                        ? "border-terracotta bg-terracotta/10 text-terracotta"
                        : "border-gray-200 text-gray-500"
                    }`}
                  >
                    {pkg.label || pkg.name}
                  </button>
                ))}
              </div>
            )}
            {keypadItem.packages.length === 1 && (
              <p className="mt-1 text-xs text-gray-500">
                Count in: <span className="font-medium text-gray-700">{keypadItem.packages[0].label || keypadItem.packages[0].name}</span>
              </p>
            )}
          </div>

          {/* Display */}
          <div className="flex flex-1 flex-col items-center justify-center px-6">
            <div className="text-center">
              <p className="text-6xl font-bold tabular-nums text-gray-900">
                {keypadValue || "0"}
              </p>
              <p className="mt-2 text-sm text-gray-400">
                {getUomLabel(keypadItem, keypadPkgId)}
              </p>
            </div>
          </div>

          {/* Keypad grid */}
          <div className="border-t border-gray-200 bg-gray-50 px-4 pb-24 pt-3">
            <div className="mx-auto grid max-w-xs grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "backspace"].map((key) => (
                <button
                  key={key}
                  onClick={() => keypadPress(key)}
                  className={`flex h-14 items-center justify-center rounded-xl text-xl font-semibold transition-colors active:scale-95 ${
                    key === "backspace"
                      ? "bg-gray-200 text-gray-600 active:bg-gray-300"
                      : "bg-white text-gray-900 shadow-sm active:bg-gray-100"
                  }`}
                >
                  {key === "backspace" ? <Delete className="h-5 w-5" /> : key}
                </button>
              ))}
            </div>

            {/* Action buttons */}
            <div className="mx-auto mt-3 flex max-w-xs gap-2">
              {counts[keypadItem.id] != null && (
                <Button
                  variant="outline"
                  className="flex-1 h-12 text-red-500 border-red-200 hover:bg-red-50"
                  onClick={keypadClear}
                >
                  Clear
                </Button>
              )}
              <Button
                className="flex-1 h-12 bg-terracotta hover:bg-terracotta-dark text-base"
                onClick={keypadConfirm}
                disabled={!keypadValue && !counts[keypadItem.id]}
              >
                {keypadValue ? "Save" : "Skip"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
