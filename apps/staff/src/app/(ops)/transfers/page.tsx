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
  fromOutlet: string;
  toOutlet: string;
  toOutletCode: string;
  status: string;
  transferredBy: string;
  notes: string | null;
  createdAt: string;
  items: { id: string; product: string; sku: string; package: string; quantity: number }[];
};

type Package = {
  id: string;
  name: string;
  label: string | null;
  conversion: number;
  isDefault: boolean;
};

type Outlet = {
  id: string;
  name: string;
  code: string;
};

type Product = {
  id: string;
  name: string;
  sku: string;
  baseUom: string;
  packages: Package[];
};

type UserSession = {
  id: string;
  name: string;
  role: string;
  outletId: string | null;
};

type TransferItem = {
  productId: string;
  productName: string;
  sku: string;
  packages: Package[];
  // Quantity is counted in this package ("6 cartons"). Without it the server
  // can't convert to base UOM, and transfers were stored as 6 ml of milk.
  productPackageId: string | null;
  quantity: number;
};

const packageLabel = (p: Package) => p.label || p.name;

export default function TransferPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toOutletId, setToOutletId] = useState("");
  const [transferNotes, setTransferNotes] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [transferItems, setTransferItems] = useState<TransferItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTransfers = useCallback(async (outletId?: string | null) => {
    const url = outletId ? `/api/transfers?outletId=${outletId}` : "/api/transfers";
    const res = await fetch(url);
    if (res.ok) {
      setTransfers(await res.json());
    }
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [userRes, outletsRes, productsRes] = await Promise.all([
          fetch("/api/auth/me"),
          fetch("/api/outlets"),
          fetch("/api/products/options"),
        ]);

        let userData: UserSession | null = null;
        if (userRes.ok) {
          userData = await userRes.json();
          setUser(userData);
        }

        if (outletsRes.ok) {
          setOutlets(await outletsRes.json());
        }

        if (productsRes.ok) {
          setProducts(await productsRes.json());
        }

        await fetchTransfers(userData?.outletId);
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
    const packages = product.packages ?? [];
    const preset = packages.find((p) => p.isDefault) ?? (packages.length === 1 ? packages[0] : undefined);
    setTransferItems((prev) => [
      ...prev,
      {
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        packages,
        productPackageId: preset?.id ?? null,
        quantity: 1,
      },
    ]);
    setProductSearch("");
  };

  const setItemPackage = (productId: string, productPackageId: string) => {
    setTransferItems((prev) =>
      prev.map((item) => (item.productId === productId ? { ...item, productPackageId } : item)),
    );
  };

  // A product with packages must have one chosen; the API refuses otherwise.
  const missingPackage = transferItems.some((i) => i.packages.length > 0 && !i.productPackageId);

  const [receivingId, setReceivingId] = useState<string | null>(null);
  const markReceived = async (t: Transfer) => {
    setReceivingId(t.id);
    try {
      const res = await fetch(`/api/transfers/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        alert(body?.error ?? `Couldn't mark this transfer received (${res.status}).`);
      }
      await fetchTransfers(user?.outletId);
    } finally {
      setReceivingId(null);
    }
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

  const userOutlet = outlets.find((b) => b.id === user?.outletId);
  const otherOutlets = outlets.filter((b) => b.id !== user?.outletId);

  const resetForm = () => {
    setToOutletId("");
    setTransferNotes("");
    setProductSearch("");
    setTransferItems([]);
  };

  const handleSubmit = async () => {
    if (!toOutletId || transferItems.length === 0 || missingPackage || !user) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromOutletId: user.outletId,
          toOutletId,
          transferredById: user.id,
          notes: transferNotes || null,
          items: transferItems.map((i) => ({
            productId: i.productId,
            productPackageId: i.productPackageId ?? undefined,
            quantity: i.quantity,
          })),
        }),
      });

      if (res.ok) {
        setDialogOpen(false);
        resetForm();
        await fetchTransfers(user.outletId);
      } else {
        const body = await res.json().catch(() => null);
        setSubmitError(
          body?.error ??
            (body?.details?.length
              ? body.details.join(" ")
              : `Couldn't create this transfer (${res.status}). Nothing was moved — try again.`),
        );
      }
    } catch {
      setSubmitError("Network error — nothing was moved. Try again.");
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
        return "bg-ok";
      case "pending":
        return "bg-ink";
      case "cancelled":
        return "bg-line-ctl";
      default:
        return "bg-line-ctl";
    }
  };

  if (loading) {
    return (
      <>
        <TopBar title="Transfers" />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-brand-text" />
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title="Transfers" />
      <div className="px-4 py-3">
        <div className="mx-auto max-w-lg space-y-4">
          <Button onClick={() => setDialogOpen(true)} className="w-full bg-ink hover:bg-ink-hover">
            <Plus className="mr-1.5 h-4 w-4" />
            New transfer
          </Button>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-text">Recent transfers</h2>
            <div className="space-y-2">
              {transfers.length === 0 && (
                <p className="py-6 text-center text-sm text-text-3">No transfers yet</p>
              )}
              {transfers.map((t) => (
                <Card key={t.id} className="px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-text">{t.fromOutlet}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-text-3" />
                        <span className="font-medium text-text">{t.toOutlet}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-text-3">
                        {t.items.length} item{t.items.length !== 1 ? "s" : ""} &middot; {formatDate(t.createdAt)} &middot; by {t.transferredBy}
                      </p>
                      <p className="mt-0.5 text-xs text-text-3">
                        {t.items.map((i) => `${i.quantity} ${i.package || "?"} ${i.product}`).join(", ")}
                      </p>
                    </div>
                    <Badge className={`text-[10px] ${statusColor(t.status)}`}>{t.status.toLowerCase()}</Badge>
                  </div>
                  {/* The receiving outlet confirms arrival; until then the
                      stock sits in neither outlet's books. */}
                  {t.status === "PENDING" && t.toOutletCode === userOutlet?.code && (
                    <Button
                      size="sm"
                      className="mt-2 w-full bg-ok hover:bg-ok"
                      disabled={receivingId === t.id}
                      onClick={() => markReceived(t)}
                    >
                      {receivingId === t.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                      Mark received
                    </Button>
                  )}
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="mx-auto max-w-sm">
          <DialogHeader><DialogTitle>New transfer</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">From</label>
              <div className="mt-1 w-full rounded-md border bg-sunken/60 px-3 py-2 text-sm text-text-2">
                {userOutlet?.name ?? "Your outlet"}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">To</label>
              <select
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                value={toOutletId}
                onChange={(e) => setToOutletId(e.target.value)}
              >
                <option value="">Select destination...</option>
                {otherOutlets.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Add products</label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
                <Input
                  placeholder="Search by name or SKU..."
                  className="pl-9"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                />
              </div>
              {productSearch && (
                <div className="mt-1 max-h-36 overflow-y-auto rounded-md border bg-surface shadow-sm">
                  {filteredProducts.length === 0 && (
                    <p className="px-3 py-2 text-xs text-text-3">No products found</p>
                  )}
                  {filteredProducts.slice(0, 8).map((p) => (
                    <button
                      key={p.id}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-sunken/60"
                      onClick={() => addItem(p)}
                    >
                      <span className="text-text">{p.name}</span>
                      <span className="text-xs text-text-3">{p.sku}</span>
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
                      <p className="truncate text-sm text-text">{item.productName}</p>
                      {item.packages.length > 1 ? (
                        <select
                          className={`mt-0.5 w-full rounded border px-1.5 py-0.5 text-xs ${item.productPackageId ? "text-text-2" : "border-danger text-danger-text"}`}
                          value={item.productPackageId ?? ""}
                          onChange={(e) => setItemPackage(item.productId, e.target.value)}
                        >
                          <option value="">Choose unit…</option>
                          {item.packages.map((p) => (
                            <option key={p.id} value={p.id}>{packageLabel(p)}</option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-xs text-text-3">
                          {item.packages[0] ? packageLabel(item.packages[0]) : item.sku}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => updateItemQty(item.productId, -1)}
                        className="flex h-6 w-6 items-center justify-center rounded bg-sunken text-text-2"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="min-w-[1.5rem] text-center text-sm font-medium">{item.quantity}</span>
                      <button
                        onClick={() => updateItemQty(item.productId, 1)}
                        className="flex h-6 w-6 items-center justify-center rounded bg-brand-soft text-brand-text"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => removeItem(item.productId)}
                        className="ml-1 flex h-6 w-6 items-center justify-center rounded text-text-3 hover:text-danger"
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

            {submitError && (
              <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-text">
                {submitError}
              </div>
            )}
            <Button
              className="w-full bg-ink hover:bg-ink-hover"
              disabled={!toOutletId || transferItems.length === 0 || missingPackage || submitting}
              onClick={handleSubmit}
            >
              {submitting ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <ArrowRightLeft className="mr-1.5 h-4 w-4" />
              )}
              {submitting ? "Creating..." : "Create transfer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
