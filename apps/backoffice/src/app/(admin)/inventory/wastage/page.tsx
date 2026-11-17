"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { summariseWaste } from "@/lib/inventory/waste-summary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Search, Trash2, Loader2 } from "lucide-react";
import { AIInsightBanner } from "@/components/ai-insight-banner";

const REASONS = ["Expired", "Spillage", "Breakage", "Quality Issue", "Other"];

type WastageEntry = {
  id: string;
  product: string;
  sku: string;
  adjustmentType: string;
  quantity: number;
  costAmount: number | null;
  reason: string | null;
  adjustedBy: string;
  createdAt: string;
};

type Product = {
  id: string;
  name: string;
  sku: string;
  baseUom: string;
  packages: { id: string; name: string; label: string; uom: string }[];
};

type UserSession = {
  id: string;
  name: string;
  role: string;
  outletId: string | null;
};

const rmText = (v: number) => `RM ${v.toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

function WasteKpi({ label, value, note, tone, word }: { label: string; value: string | null; note: React.ReactNode; tone?: "warn"; word?: boolean }) {
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <p className="text-[12px] font-medium text-text-2">{label}</p>
      {value === null
        ? <div className="mt-1.5 h-8 w-24 animate-pulse rounded bg-sunken" />
        : <p className={"mt-1 truncate text-[21px] font-semibold leading-8 sm:text-[26px] " + (word ? "" : "font-mono ") + (tone === "warn" ? "text-warn-text" : "text-text")} title={value}>{value}</p>}
      <p className="mt-1 text-[12px] text-text-3">{note}</p>
    </div>
  );
}

export default function WastagePage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [quantity, setQuantity] = useState("");
  const [costAmount, setCostAmount] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [wastage, setWastage] = useState<WastageEntry[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWastage = useCallback(async (outletId?: string | null) => {
    const url = outletId ? `/api/wastage?outletId=${outletId}` : "/api/wastage";
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      setWastage(data);
    }
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [userRes, productsRes] = await Promise.all([
          fetch("/api/auth/me"),
          fetch("/api/inventory/products"),
        ]);

        let userData: UserSession | null = null;
        if (userRes.ok) {
          userData = await userRes.json();
          setUser(userData);
        }

        if (productsRes.ok) {
          setProducts(await productsRes.json());
        }

        await fetchWastage(userData?.outletId);
        setError(null);
      } catch {
        setError("Failed to load wastage data.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [fetchWastage]);

  // read once when the page opens, so the 7-day window does not shift on every render
  const [now] = useState(() => Date.now());
  const summary = useMemo(() => summariseWaste(wastage, now), [wastage, now]);

  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      p.sku.toLowerCase().includes(productSearch.toLowerCase())
  );

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  const resetForm = () => {
    setReason("");
    setNotes("");
    setQuantity("");
    setCostAmount("");
    setSelectedProductId("");
    setProductSearch("");
  };

  const handleSubmit = async () => {
    if (!selectedProductId || !quantity || !reason || !user) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/wastage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outletId: user.outletId,
          productId: selectedProductId,
          adjustmentType: "WASTAGE",
          quantity: parseFloat(quantity),
          costAmount: costAmount ? parseFloat(costAmount) : null,
          reason,
          notes: notes || null,
          adjustedById: user.id,
        }),
      });

      if (!res.ok) { alert("Failed to record wastage. Please try again."); return; }
      setDialogOpen(false);
      resetForm();
      await fetchWastage(user.outletId);
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-MY", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-brand-text" />
      </div>
    );
  }

  return (
    <div className="px-4 pt-6 pb-10 md:px-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Wastage</h2>
          <p className="mt-1.5 text-sm text-text-2">What we threw away, why, and whether it is going down.</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="bg-ink hover:bg-ink-hover">
          <Plus className="mr-1.5 h-4 w-4" />
          Record wastage
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* AI Suggestions */}
      <AIInsightBanner type="wastageAlerts" />

      <div className="space-y-5">
        {/* Key numbers, each against a reference (Celsius UI page pattern) */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <WasteKpi label="Last 7 days" value={loading ? null : rmText(summary.last7)}
            tone={summary.change7 !== null && summary.change7 > 0.1 ? "warn" : undefined}
            note={summary.change7 === null ? "nothing in the 7 days before" : <><b className="text-text-2">{summary.change7 > 0 ? "+" : ""}{Math.round(summary.change7 * 100)}%</b> vs {rmText(summary.prev7)} the 7 days before</>} />
          <WasteKpi label="This month" value={loading ? null : rmText(summary.thisMonth)}
            note={<>last month: <b className="text-text-2">{rmText(summary.lastMonth)}</b></>} />
          <WasteKpi label="Top reason, 7 days" word value={loading ? null : (summary.topReason?.reason ?? "None")}
            note={summary.topReason ? <><b className="text-text-2">{Math.round(summary.topReason.share * 100)}%</b> of the cost, {rmText(summary.topReason.amount)}</> : "no costed waste this week"} />
          <WasteKpi label="Most wasted, 7 days" word value={loading ? null : (summary.topItem?.product ?? "None")}
            note={summary.topItem ? <><b className="text-text-2">{rmText(summary.topItem.amount)}</b> thrown away</> : "no costed waste this week"} />
        </div>

        <section className="overflow-clip rounded-card border border-line bg-surface">
          <div className="px-4 pt-4 pb-3">
            <h3 className="text-[15px] font-semibold text-text">Recent wastage</h3>
            <p className="mt-0.5 text-[12px] text-text-3">{wastage.length} {wastage.length === 1 ? "entry" : "entries"}, newest first</p>
          </div>
          {wastage.length === 0 ? (
            <p className="border-t border-line px-4 py-10 text-center text-sm text-text-2">No wastage recorded yet. Use Record wastage when something is thrown away.</p>
          ) : (
            <ul>
              {wastage.map((w) => (
                <li key={w.id} className="flex min-h-12 items-center gap-3 border-t border-line px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-text">{w.product}</span>
                    <span className="block truncate text-[12px] text-text-3">
                      {w.quantity} · {formatDate(w.createdAt)} · by {w.adjustedBy}
                    </span>
                  </span>
                  {w.reason && <span className="hidden shrink-0 rounded-full bg-sunken px-2 py-0.5 text-[12px] text-text-2 sm:inline">{w.reason}</span>}
                  <span className="w-24 shrink-0 text-right font-mono text-[14px] font-semibold text-text">
                    {w.costAmount != null ? rmText(w.costAmount) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="mx-auto max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Record Wastage</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">Product</label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
                <Input
                  placeholder="Search product..."
                  className="pl-9"
                  value={productSearch}
                  onChange={(e) => {
                    setProductSearch(e.target.value);
                    setSelectedProductId("");
                  }}
                />
              </div>
              {productSearch && !selectedProductId && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-md border bg-surface shadow-sm">
                  {filteredProducts.length === 0 && (
                    <p className="px-3 py-2 text-xs text-text-3">No products found</p>
                  )}
                  {filteredProducts.slice(0, 10).map((p) => (
                    <button
                      key={p.id}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-sunken"
                      onClick={() => {
                        setSelectedProductId(p.id);
                        setProductSearch(p.name);
                      }}
                    >
                      <span className="text-text">{p.name}</span>
                      <span className="text-xs text-text-3">{p.sku}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedProduct && (
                <p className="mt-1 text-xs text-text-2">SKU: {selectedProduct.sku} &middot; UOM: {selectedProduct.baseUom}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Quantity</label>
                <Input
                  className="mt-1"
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Cost (RM)</label>
                <Input
                  className="mt-1"
                  type="number"
                  inputMode="decimal"
                  placeholder="Optional"
                  value={costAmount}
                  onChange={(e) => setCostAmount(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Reason</label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {REASONS.map((r) => (
                  <button key={r} onClick={() => setReason(r)} className={`rounded-full border px-3 py-1 text-xs transition-colors ${reason === r ? "border-text bg-raised font-semibold text-text" : "border-line text-text-2"}`}>{r}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Notes (optional)</label>
              <Input
                className="mt-1"
                placeholder="Additional details..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <Button
              className="w-full bg-ink hover:bg-ink-hover"
              disabled={!selectedProductId || !quantity || !reason || submitting}
              onClick={handleSubmit}
            >
              {submitting ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-4 w-4" />
              )}
              {submitting ? "Submitting..." : "Record Wastage"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
