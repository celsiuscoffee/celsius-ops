"use client";

import { useState, useEffect, useCallback } from "react";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Search, Trash2, AlertTriangle, Loader2 } from "lucide-react";

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
  branchId: string | null;
};

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

  const fetchWastage = useCallback(async (branchId?: string | null) => {
    const url = branchId ? `/api/wastage?branchId=${branchId}` : "/api/wastage";
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
          fetch("/api/products"),
        ]);

        let userData: UserSession | null = null;
        if (userRes.ok) {
          userData = await userRes.json();
          setUser(userData);
        }

        if (productsRes.ok) {
          setProducts(await productsRes.json());
        }

        await fetchWastage(userData?.branchId);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [fetchWastage]);

  const totalWaste = wastage.reduce((a, w) => a + (w.costAmount ?? 0), 0);

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
          branchId: user.branchId,
          productId: selectedProductId,
          adjustmentType: "WASTAGE",
          quantity: parseFloat(quantity),
          costAmount: costAmount ? parseFloat(costAmount) : null,
          reason,
          adjustedById: user.id,
        }),
      });

      if (res.ok) {
        setDialogOpen(false);
        resetForm();
        await fetchWastage(user.branchId);
      }
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
      <>
        <TopBar title="Record Wastage" />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title="Record Wastage" />
      <div className="px-4 py-3">
        <div className="mx-auto max-w-lg space-y-4">
          {/* Summary */}
          <Card className="bg-red-50 border-red-200 px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-red-500">Total Waste Cost</p>
                <p className="text-xl font-bold text-red-700">RM {totalWaste.toFixed(2)}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-300" />
            </div>
          </Card>

          <Button onClick={() => setDialogOpen(true)} className="w-full bg-terracotta hover:bg-terracotta-dark">
            <Plus className="mr-1.5 h-4 w-4" />
            Record Wastage
          </Button>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-gray-900">Recent Wastage</h2>
            <div className="space-y-1.5">
              {wastage.length === 0 && (
                <p className="py-6 text-center text-sm text-gray-400">No wastage records yet</p>
              )}
              {wastage.map((w) => (
                <Card key={w.id} className="px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{w.product}</p>
                      <p className="text-xs text-gray-500">
                        {w.quantity} &middot; {w.reason ?? "—"} &middot; {formatDate(w.createdAt)}
                      </p>
                      <p className="text-xs text-gray-400">by {w.adjustedBy}</p>
                    </div>
                    <div className="text-right">
                      {w.costAmount != null && (
                        <p className="text-sm font-medium text-red-600">-RM {w.costAmount.toFixed(2)}</p>
                      )}
                      {w.reason && <Badge variant="outline" className="text-[10px]">{w.reason}</Badge>}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="mx-auto max-w-sm">
          <DialogHeader><DialogTitle>Record Wastage</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">Product</label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
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
                <div className="mt-1 max-h-40 overflow-y-auto rounded-md border bg-white shadow-sm">
                  {filteredProducts.length === 0 && (
                    <p className="px-3 py-2 text-xs text-gray-400">No products found</p>
                  )}
                  {filteredProducts.slice(0, 10).map((p) => (
                    <button
                      key={p.id}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                      onClick={() => {
                        setSelectedProductId(p.id);
                        setProductSearch(p.name);
                      }}
                    >
                      <span className="text-gray-900">{p.name}</span>
                      <span className="text-xs text-gray-400">{p.sku}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedProduct && (
                <p className="mt-1 text-xs text-gray-500">SKU: {selectedProduct.sku} &middot; UOM: {selectedProduct.baseUom}</p>
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
                  <button key={r} onClick={() => setReason(r)} className={`rounded-full border px-3 py-1 text-xs transition-colors ${reason === r ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-600"}`}>{r}</button>
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
              className="w-full bg-terracotta hover:bg-terracotta-dark"
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
    </>
  );
}
