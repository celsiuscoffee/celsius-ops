"use client";

import { useState, useEffect, useCallback } from "react";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowRightLeft, Plus, Search, ArrowRight, Loader2, X, Minus } from "lucide-react";

type Transfer = {
  id: string;
  fromBranch: string;
  toBranch: string;
  status: string;
  transferredBy: string;
  notes: string | null;
  createdAt: string;
  items: { id: string; product: string; sku: string; quantity: number }[];
};

type Branch = {
  id: string;
  name: string;
  code: string;
};

type Product = {
  id: string;
  name: string;
  sku: string;
  baseUom: string;
};

type UserSession = {
  id: string;
  name: string;
  role: string;
  branchId: string | null;
};

type TransferItem = {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
};

export default function TransferPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toBranchId, setToBranchId] = useState("");
  const [transferNotes, setTransferNotes] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [transferItems, setTransferItems] = useState<TransferItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTransfers = useCallback(async (branchId?: string | null) => {
    const url = branchId ? `/api/transfers?branchId=${branchId}` : "/api/transfers";
    const res = await fetch(url);
    if (res.ok) {
      setTransfers(await res.json());
    }
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [userRes, branchesRes, productsRes] = await Promise.all([
          fetch("/api/auth/me"),
          fetch("/api/branches"),
          fetch("/api/products"),
        ]);

        let userData: UserSession | null = null;
        if (userRes.ok) {
          userData = await userRes.json();
          setUser(userData);
        }

        if (branchesRes.ok) {
          setBranches(await branchesRes.json());
        }

        if (productsRes.ok) {
          setProducts(await productsRes.json());
        }

        await fetchTransfers(userData?.branchId);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [fetchTransfers]);

  const filteredProducts = products.filter(
    (p) =>
      (p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.sku.toLowerCase().includes(productSearch.toLowerCase())) &&
      !transferItems.some((ti) => ti.productId === p.id)
  );

  const addItem = (product: Product) => {
    setTransferItems((prev) => [
      ...prev,
      { productId: product.id, productName: product.name, sku: product.sku, quantity: 1 },
    ]);
    setProductSearch("");
  };

  const updateItemQty = (productId: string, delta: number) => {
    setTransferItems((prev) =>
      prev
        .map((item) =>
          item.productId === productId
            ? { ...item, quantity: Math.max(1, item.quantity + delta) }
            : item
        )
    );
  };

  const removeItem = (productId: string) => {
    setTransferItems((prev) => prev.filter((i) => i.productId !== productId));
  };

  const userBranch = branches.find((b) => b.id === user?.branchId);
  const otherBranches = branches.filter((b) => b.id !== user?.branchId);

  const resetForm = () => {
    setToBranchId("");
    setTransferNotes("");
    setProductSearch("");
    setTransferItems([]);
  };

  const handleSubmit = async () => {
    if (!toBranchId || transferItems.length === 0 || !user) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromBranchId: user.branchId,
          toBranchId,
          transferredById: user.id,
          notes: transferNotes || null,
          items: transferItems.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
          })),
        }),
      });

      if (res.ok) {
        setDialogOpen(false);
        resetForm();
        await fetchTransfers(user.branchId);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-MY", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  const statusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "completed":
        return "bg-green-500";
      case "pending":
        return "bg-terracotta";
      case "cancelled":
        return "bg-gray-400";
      default:
        return "bg-gray-400";
    }
  };

  if (loading) {
    return (
      <>
        <TopBar title="Stock Transfer" />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title="Stock Transfer" />
      <div className="px-4 py-3">
        <div className="mx-auto max-w-lg space-y-4">
          <Button onClick={() => setDialogOpen(true)} className="w-full bg-terracotta hover:bg-terracotta-dark">
            <Plus className="mr-1.5 h-4 w-4" />
            New Transfer
          </Button>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-gray-900">Recent Transfers</h2>
            <div className="space-y-2">
              {transfers.length === 0 && (
                <p className="py-6 text-center text-sm text-gray-400">No transfers yet</p>
              )}
              {transfers.map((t) => (
                <Card key={t.id} className="px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-gray-900">{t.fromBranch}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-gray-400" />
                        <span className="font-medium text-gray-900">{t.toBranch}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {t.items.length} item{t.items.length !== 1 ? "s" : ""} &middot; {formatDate(t.createdAt)} &middot; by {t.transferredBy}
                      </p>
                    </div>
                    <Badge className={`text-[10px] ${statusColor(t.status)}`}>{t.status.toLowerCase()}</Badge>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="mx-auto max-w-sm">
          <DialogHeader><DialogTitle>New Stock Transfer</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">From Branch</label>
              <div className="mt-1 w-full rounded-md border bg-gray-50 px-3 py-2 text-sm text-gray-700">
                {userBranch?.name ?? "Your branch"}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">To Branch</label>
              <select
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                value={toBranchId}
                onChange={(e) => setToBranchId(e.target.value)}
              >
                <option value="">Select destination...</option>
                {otherBranches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Add Products</label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  placeholder="Search by name or SKU..."
                  className="pl-9"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                />
              </div>
              {productSearch && (
                <div className="mt-1 max-h-36 overflow-y-auto rounded-md border bg-white shadow-sm">
                  {filteredProducts.length === 0 && (
                    <p className="px-3 py-2 text-xs text-gray-400">No products found</p>
                  )}
                  {filteredProducts.slice(0, 8).map((p) => (
                    <button
                      key={p.id}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                      onClick={() => addItem(p)}
                    >
                      <span className="text-gray-900">{p.name}</span>
                      <span className="text-xs text-gray-400">{p.sku}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Selected items */}
            {transferItems.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Items ({transferItems.length})</label>
                {transferItems.map((item) => (
                  <div key={item.productId} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-gray-900">{item.productName}</p>
                      <p className="text-xs text-gray-400">{item.sku}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => updateItemQty(item.productId, -1)}
                        className="flex h-6 w-6 items-center justify-center rounded bg-gray-100 text-gray-600"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="min-w-[1.5rem] text-center text-sm font-medium">{item.quantity}</span>
                      <button
                        onClick={() => updateItemQty(item.productId, 1)}
                        className="flex h-6 w-6 items-center justify-center rounded bg-terracotta/10 text-terracotta-dark"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => removeItem(item.productId)}
                        className="ml-1 flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:text-red-500"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="text-sm font-medium">Notes (optional)</label>
              <Input
                className="mt-1"
                placeholder="Transfer notes..."
                value={transferNotes}
                onChange={(e) => setTransferNotes(e.target.value)}
              />
            </div>

            <Button
              className="w-full bg-terracotta hover:bg-terracotta-dark"
              disabled={!toBranchId || transferItems.length === 0 || submitting}
              onClick={handleSubmit}
            >
              {submitting ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <ArrowRightLeft className="mr-1.5 h-4 w-4" />
              )}
              {submitting ? "Creating..." : "Create Transfer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
