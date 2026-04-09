"use client";

import { useState, useEffect, useMemo } from "react";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Check,
  X,
  Search,
  ChevronDown,
  ChevronRight,
  ScanBarcode,
  RotateCcw,
  Loader2,
  CheckCircle2,
} from "lucide-react";

const ADJUSTMENT_REASONS = [
  "Wastage/Spillage",
  "Breakage",
  "Expired",
  "Used but not recorded",
  "Theft/Loss",
  "Other",
];

const STORAGE_AREA_LABELS: Record<string, string> = {
  FRIDGE: "Fridge",
  DRY_STORE: "Dry Store",
  COUNTER: "Counter",
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

type CheckStatus = "pending" | "confirmed" | "adjusted";
interface ItemState {
  status: CheckStatus;
  actualQty?: number;
  reason?: string;
}

interface GroupedArea {
  area: string;
  items: Product[];
}

const STORAGE_KEY = "celsius-stock-check-draft";

function loadDraft(freq: string): Record<string, ItemState> {
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

function saveDraft(freq: string, items: Record<string, ItemState>) {
  try {
    const today = new Date().toISOString().split("T")[0];
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ frequency: freq, date: today, items }));
  } catch { /* ignore */ }
}

export default function StockCheckPage() {
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">("daily");
  const [search, setSearch] = useState("");
  const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(new Set());
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>(() => loadDraft("daily"));
  const [adjustDialog, setAdjustDialog] = useState<{
    open: boolean;
    itemId: string;
    itemName: string;
    uom: string;
  }>({ open: false, itemId: "", itemName: "", uom: "" });
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  // Data fetching state
  const [products, setProducts] = useState<Product[]>([]);
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Autosave to localStorage whenever items change
  useEffect(() => {
    const count = Object.keys(itemStates).length;
    if (count > 0) {
      saveDraft(frequency, itemStates);
      setLastSaved(new Date().toLocaleTimeString());
    }
  }, [itemStates, frequency]);

  // Fetch products and user on mount
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

        const productsData = await productsRes.json();
        const userData = await userRes.json();

        setProducts(productsData);
        setUser(userData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Filter products by check frequency, then group by storageArea
  // Daily: only DAILY items. Weekly: DAILY + WEEKLY. Monthly: ALL items.
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
    // Sort areas: known ones first, then alphabetical
    const knownOrder = ["FRIDGE", "COUNTER", "DRY_STORE"];
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      const ai = knownOrder.indexOf(a);
      const bi = knownOrder.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
    return sortedKeys.map((area) => ({
      area,
      items: groups[area],
    }));
  }, [products, frequency]);

  const displayLabel = (area: string) =>
    STORAGE_AREA_LABELS[area] || area.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const getUom = (product: Product) => {
    if (frequency === "monthly") {
      const bulkPkg = product.packages.find((p) => !p.isDefault);
      if (bulkPkg) return bulkPkg.uom;
    }
    return product.baseUom;
  };

  const totalItems = groupedData.reduce((acc, g) => acc + g.items.length, 0);
  const checkedItems = Object.values(itemStates).filter(
    (s) => s.status === "confirmed" || s.status === "adjusted"
  ).length;
  const adjustedItems = Object.values(itemStates).filter(
    (s) => s.status === "adjusted"
  ).length;
  const progressPct = totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0;

  const toggleArea = (area: string) => {
    setCollapsedAreas((prev) => {
      const next = new Set(prev);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return next;
    });
  };

  const confirmItem = (id: string) => {
    setItemStates((prev) => ({ ...prev, [id]: { status: "confirmed" } }));
  };

  const uncheckItem = (id: string) => {
    setItemStates((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const confirmArea = (area: string) => {
    const group = groupedData.find((g) => g.area === area);
    if (!group) return;
    setItemStates((prev) => {
      const next = { ...prev };
      group.items.forEach((item) => {
        if (!next[item.id] || next[item.id].status === "pending") {
          next[item.id] = { status: "confirmed" };
        }
      });
      return next;
    });
  };

  const openAdjustDialog = (item: Product) => {
    setAdjustDialog({
      open: true,
      itemId: item.id,
      itemName: item.name,
      uom: getUom(item),
    });
    setAdjustQty("");
    setAdjustReason("");
  };

  const submitAdjustment = () => {
    if (!adjustQty) return;
    setItemStates((prev) => ({
      ...prev,
      [adjustDialog.itemId]: {
        status: "adjusted",
        actualQty: parseFloat(adjustQty),
        reason: adjustReason,
      },
    }));
    setAdjustDialog({ open: false, itemId: "", itemName: "", uom: "" });
  };

  const confirmAll = () => {
    const newStates: Record<string, ItemState> = { ...itemStates };
    groupedData.forEach((group) =>
      group.items.forEach((item) => {
        if (!newStates[item.id]) {
          newStates[item.id] = { status: "confirmed" };
        }
      })
    );
    setItemStates(newStates);
  };

  const resetCheck = () => {
    setItemStates({});
    setSubmitted(false);
    setLastSaved(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  const switchFrequency = (f: "daily" | "weekly" | "monthly") => {
    setFrequency(f);
    setItemStates(loadDraft(f));
    setCollapsedAreas(new Set());
    setSubmitted(false);
  };

  const handleSubmit = async () => {
    if (!user?.outletId) {
      setError("No outlet assigned to your account. Cannot submit stock check.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Only submit items that are in the current frequency list
      const freqKey = frequency.toUpperCase();
      const relevantProducts = freqKey === "DAILY"
        ? products.filter((p) => p.checkFrequency === "DAILY")
        : freqKey === "WEEKLY"
          ? products.filter((p) => p.checkFrequency === "DAILY" || p.checkFrequency === "WEEKLY")
          : products;
      const items = relevantProducts.map((product) => {
        const state = itemStates[product.id];
        return {
          productId: product.id,
          countedQty: state?.status === "adjusted" ? state.actualQty ?? null : null,
          isConfirmed: state?.status === "confirmed" || state?.status === "adjusted",
          varianceReason: state?.status === "adjusted" ? state.reason || null : null,
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
      setItemStates({});
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
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

  // Loading state
  if (loading) {
    return (
      <>
        <TopBar title="Smart Stock Check" />
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-terracotta" />
          <p className="mt-3 text-sm text-gray-500">Loading products...</p>
        </div>
      </>
    );
  }

  // Error state (full page, only when no products loaded)
  if (error && products.length === 0) {
    return (
      <>
        <TopBar title="Smart Stock Check" />
        <div className="flex flex-col items-center justify-center py-20 px-4">
          <p className="text-sm font-medium text-red-600">{error}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => window.location.reload()}
          >
            Try Again
          </Button>
        </div>
      </>
    );
  }

  // Success state after submission
  if (submitted) {
    return (
      <>
        <TopBar title="Smart Stock Check" />
        <div className="flex flex-col items-center justify-center py-20 px-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-gray-900">Stock Check Submitted</h2>
          <p className="mt-1 text-sm text-gray-500">
            Your {frequency} stock check has been recorded successfully.
          </p>
          <Button
            className="mt-6 bg-terracotta hover:bg-terracotta-dark"
            onClick={() => {
              setSubmitted(false);
              setItemStates({});
              setCollapsedAreas(new Set());
            }}
          >
            Start New Check
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title="Smart Stock Check" />

      {/* Frequency toggle + progress */}
      <div className="border-b border-gray-100 bg-white px-4 py-2">
        <div className="mx-auto max-w-lg">
          {/* Daily / Monthly toggle */}
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5">
              <button
                onClick={() => switchFrequency("daily")}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  frequency === "daily"
                    ? "bg-terracotta text-white"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Daily ({products.filter((p) => p.checkFrequency === "DAILY").length})
              </button>
              <button
                onClick={() => switchFrequency("weekly")}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  frequency === "weekly"
                    ? "bg-terracotta text-white"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Weekly ({products.filter((p) => p.checkFrequency === "DAILY" || p.checkFrequency === "WEEKLY").length})
              </button>
              <button
                onClick={() => switchFrequency("monthly")}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  frequency === "monthly"
                    ? "bg-terracotta text-white"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Monthly ({products.length})
              </button>
            </div>
            {checkedItems > 0 && (
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
              <span className="font-semibold text-gray-900">
                {checkedItems}/{totalItems}
              </span>{" "}
              checked
              {adjustedItems > 0 && (
                <span className="ml-1 text-terracotta">
                  ({adjustedItems} adjusted)
                </span>
              )}
              {lastSaved && (
                <span className="ml-2 text-green-500">
                  · saved {lastSaved}
                </span>
              )}
            </span>
            <Badge
              variant={checkedItems === totalItems ? "default" : "secondary"}
              className={checkedItems === totalItems ? "bg-green-500" : ""}
            >
              {progressPct}%
            </Badge>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-terracotta transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Search + scan */}
      <div className="sticky top-[73px] z-30 border-b border-gray-100 bg-white px-4 py-2">
        <div className="mx-auto flex max-w-lg gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search product or SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="icon" className="shrink-0" disabled title="Coming soon">
            <ScanBarcode className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Inline error banner */}
      {error && (
        <div className="mx-4 mt-3">
          <div className="mx-auto max-w-lg rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        </div>
      )}

      {/* Stock items grouped by storage area */}
      <div className="px-4 py-3">
        <div className="mx-auto max-w-lg space-y-3">
          {filteredData.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-400">
              {search ? "No products match your search." : "No products found."}
            </p>
          )}
          {filteredData.map((group) => {
            const isCollapsed = collapsedAreas.has(group.area);
            const groupTotal = group.items.length;
            const groupChecked = group.items.filter(
              (i) =>
                itemStates[i.id]?.status === "confirmed" ||
                itemStates[i.id]?.status === "adjusted"
            ).length;
            const allChecked = groupChecked === groupTotal;

            return (
              <div key={group.area}>
                {/* Area header with confirm-all-area button */}
                <div className="flex items-center justify-between py-1.5">
                  <button
                    onClick={() => toggleArea(group.area)}
                    className="flex items-center gap-2"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-gray-400" />
                    )}
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {displayLabel(group.area)}
                    </span>
                    <span
                      className={`text-xs ${allChecked ? "text-green-500" : "text-gray-400"}`}
                    >
                      {groupChecked}/{groupTotal}
                    </span>
                  </button>
                  {!allChecked && !isCollapsed && (
                    <button
                      onClick={() => confirmArea(group.area)}
                      className="flex items-center gap-1 rounded-md bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-600 hover:bg-green-100"
                    >
                      <Check className="h-3 w-3" />
                      All correct
                    </button>
                  )}
                  {allChecked && (
                    <Check className="h-4 w-4 text-green-500" />
                  )}
                </div>

                {!isCollapsed && (
                  <div className="space-y-1.5">
                    {group.items.map((item) => {
                      const state = itemStates[item.id];
                      const isChecked =
                        state?.status === "confirmed" ||
                        state?.status === "adjusted";
                      const uom = getUom(item);

                      return (
                        <Card
                          key={item.id}
                          className={`overflow-hidden transition-all ${
                            isChecked ? "opacity-50" : ""
                          } bg-white`}
                        >
                          <div className="flex items-center gap-3 px-3 py-2">
                            {/* Status */}
                            <div
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                                state?.status === "confirmed"
                                  ? "bg-green-100 text-green-600"
                                  : state?.status === "adjusted"
                                    ? "bg-terracotta/10 text-terracotta"
                                    : "bg-gray-100 text-gray-400"
                              }`}
                            >
                              {state?.status === "confirmed" ? (
                                <Check className="h-4 w-4" />
                              ) : state?.status === "adjusted" ? (
                                <span className="text-[10px] font-bold">
                                  {state.actualQty}
                                </span>
                              ) : (
                                <span className="text-[10px]">
                                  {item.sku.slice(0, 4)}
                                </span>
                              )}
                            </div>

                            {/* Product info */}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-gray-900">
                                {item.name}
                              </p>
                              <div className="flex items-center gap-2 text-xs text-gray-500">
                                <span>{item.sku}</span>
                                <span className="text-gray-300">|</span>
                                <span className="font-medium text-gray-600">{uom}</span>
                                {state?.status === "adjusted" && (
                                  <span className="text-terracotta">
                                    Counted: {state.actualQty} {uom}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Action buttons */}
                            {!isChecked ? (
                              <div className="flex shrink-0 gap-1">
                                <button
                                  onClick={() => confirmItem(item.id)}
                                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-50 text-green-600 active:bg-green-200"
                                >
                                  <Check className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => openAdjustDialog(item)}
                                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-500 active:bg-red-200"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => uncheckItem(item.id)}
                                className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-gray-400 hover:bg-gray-100 hover:text-gray-600 active:bg-gray-200"
                              >
                                <RotateCcw className="h-3 w-3" />
                                Undo
                              </button>
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

      {/* Bottom action bar */}
      <div className="fixed bottom-14 left-0 right-0 z-40 border-t border-gray-200 bg-white px-4 py-2.5">
        <div className="mx-auto flex max-w-lg gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={confirmAll}
            disabled={checkedItems === totalItems}
          >
            <Check className="mr-1.5 h-4 w-4" />
            Confirm All
          </Button>
          <Button
            className="flex-1 bg-terracotta hover:bg-terracotta-dark"
            disabled={checkedItems < totalItems || submitting}
            onClick={handleSubmit}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              "Submit Check"
            )}
          </Button>
        </div>
      </div>

      {/* Adjust dialog */}
      <Dialog
        open={adjustDialog.open}
        onOpenChange={(open) =>
          setAdjustDialog((prev) => ({ ...prev, open }))
        }
      >
        <DialogContent className="mx-auto max-w-sm">
          <DialogHeader>
            <DialogTitle>Adjust: {adjustDialog.itemName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium">Actual Quantity</label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder={`Enter actual ${adjustDialog.uom}`}
                value={adjustQty}
                onChange={(e) => setAdjustQty(e.target.value)}
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium">Reason</label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {ADJUSTMENT_REASONS.map((reason) => (
                  <button
                    key={reason}
                    onClick={() => setAdjustReason(reason)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      adjustReason === reason
                        ? "border-terracotta bg-terracotta/5 text-terracotta-dark"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {reason}
                  </button>
                ))}
              </div>
            </div>
            <Button
              onClick={submitAdjustment}
              disabled={!adjustQty || !adjustReason}
              className="w-full bg-terracotta hover:bg-terracotta-dark"
            >
              Save Adjustment
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
