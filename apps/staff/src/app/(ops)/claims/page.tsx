"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { CameraCaptureModal } from "@/components/camera-capture-modal";
import { compressImage } from "@/lib/compress-image";
import { sessionExpiryHandled } from "@/lib/session-expiry";
import {
  Camera,
  Upload,
  Sparkles,
  Check,
  Loader2,
  Receipt,
  X,
  ChevronDown,
  Plus,
  Minus,
  Trash2,
  Package,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";

type SupplierProduct = { id: string; name: string; sku: string; uom: string };
type Supplier = { id: string; name: string; products: SupplierProduct[] };
type ProductOption = {
  id: string;
  name: string;
  sku: string;
  baseUom: string;
  packages: { id: string; label: string; name: string }[];
};
type ExtractedItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  uom: string | null;
};
type ExtractedData = {
  invoiceNumber: string | null;
  issueDate: string | null;
  amount: number | null;
  supplierName: string | null;
  items: ExtractedItem[];
  confidence: string | null;
  notes: string | null;
};
type CartItem = {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  matched: boolean; // true if AI-matched
};

export default function ClaimsPage() {
  // Upload state
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  // AI extraction state
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedData | null>(null);

  // Form state
  const [selectedOutletId, setSelectedOutletId] = useState("");
  const [outletName, setOutletName] = useState("");
  const [userName, setUserName] = useState("");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [claimedById, setClaimedById] = useState("");
  const [notes, setNotes] = useState("");

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<{
    orderNumber: string;
    invoiceNumber: string;
  } | null>(null);
  const [error, setError] = useState("");

  // Load user profile and suppliers
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((me) => {
        if (me.outletId) setSelectedOutletId(me.outletId);
        if (me.outletName) setOutletName(me.outletName);
        if (me.id) setClaimedById(me.id);
        if (me.name) setUserName(me.name);
      })
      .catch(() => {});

    fetch("/api/suppliers")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setSuppliers(data);
      })
      .catch(() => {});

    fetch("/api/products/options")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setProducts(data.map((p: Record<string, unknown>) => ({
            id: p.id as string,
            name: p.name as string,
            sku: p.sku as string,
            baseUom: p.baseUom as string,
            packages: ((p.packages as Record<string, unknown>[]) ?? []).map((pkg: Record<string, unknown>) => ({
              id: pkg.id as string,
              label: pkg.label as string,
              name: pkg.name as string,
            })),
          })));
        }
      })
      .catch(() => {});
  }, []);

  // Compress + upload one file, return the resulting URL
  const uploadOne = async (file: File): Promise<string> => {
    const dataUrl = await compressImage(file);
    const blob = await fetch(dataUrl).then((r) => r.blob());
    const compressedFile = new File([blob], file.name, { type: "image/jpeg" });
    const formData = new FormData();
    formData.append("file", compressedFile);
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Upload failed");
    }
    const { url } = await res.json();
    return url as string;
  };

  // Handle a freshly-captured photo from the camera modal
  const handleCameraCapture = async (blob: Blob) => {
    setUploading(true);
    setError("");
    try {
      const file = new File([blob], `receipt-${Date.now()}.jpg`, { type: "image/jpeg" });
      const url = await uploadOne(file);
      const allPhotos = [...photos, url];
      setPhotos(allPhotos);
      triggerExtraction(allPhotos);
    } catch (err) {
      // Expired session: lib/session-expiry is already bouncing to /login.
      if (sessionExpiryHandled()) return;
      setError(err instanceof Error ? err.message : "Upload failed");
      // Rethrow so CameraCaptureModal keeps the receipt on screen for a retry
      // instead of closing over a failed upload.
      throw err;
    } finally {
      setUploading(false);
    }
  };

  // Fuzzy match product name
  const matchProduct = (aiName: string): ProductOption | null => {
    const name = aiName.toLowerCase();
    // Exact substring match
    let match = products.find((p) => p.name.toLowerCase().includes(name) || name.includes(p.name.toLowerCase()));
    if (match) return match;
    // Word overlap >= 50%
    const aiWords = name.split(/\s+/).filter((w) => w.length > 2);
    match = products.find((p) => {
      const pWords = p.name.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const overlap = aiWords.filter((w) => pWords.some((pw) => pw.includes(w) || w.includes(pw)));
      return overlap.length >= Math.max(1, Math.min(aiWords.length, pWords.length) * 0.5);
    });
    return match || null;
  };

  // AI extraction
  const triggerExtraction = async (urls: string[]) => {
    setExtracting(true);
    try {
      // Send all product names to AI for better matching
      const allProductNames = products.map((p) => p.name);
      const res = await fetch("/api/claims/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls,
          productNames: allProductNames,
        }),
      });

      if (res.ok) {
        const data: ExtractedData = await res.json();
        setExtracted(data);

        // Auto-fill form fields
        if (data.supplierName) {
          setSupplierName(data.supplierName);
          // Try to match against existing suppliers
          const aiName = data.supplierName.toLowerCase();
          const match = suppliers.find((s) => {
            const sName = s.name.toLowerCase();
            return sName.includes(aiName) || aiName.includes(sName) ||
              // Fuzzy: check if >50% of words overlap
              (() => {
                const aiWords = aiName.split(/\s+/);
                const sWords = sName.split(/\s+/);
                const overlap = aiWords.filter((w) => sWords.some((sw) => sw.includes(w) || w.includes(sw)));
                return overlap.length >= Math.min(aiWords.length, sWords.length) * 0.5;
              })();
          });
          if (match) setSupplierId(match.id);
        }
        if (data.amount) setAmount(String(data.amount));
        if (data.issueDate) setPurchaseDate(data.issueDate);
        // Match extracted items to products
        if (data.items?.length) {
          const matched: CartItem[] = [];
          for (const item of data.items) {
            const product = matchProduct(item.name);
            if (product) {
              matched.push({
                productId: product.id,
                productName: product.name,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                matched: true,
              });
            } else {
              // Keep unmatched for display but mark as unmatched
              matched.push({
                productId: "",
                productName: item.name,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                matched: false,
              });
            }
          }
          setCartItems(matched);
        }
      }
    } catch {
      // Extraction is best-effort, don't block the user
    } finally {
      setExtracting(false);
    }
  };

  // Remove a photo
  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  // Submit claim
  const handleSubmit = async () => {
    if (!selectedOutletId || !amount || photos.length === 0) {
      setError("Please fill in amount and upload at least one receipt.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outletId: selectedOutletId,
          supplierId: supplierId || undefined,
          supplierName: supplierName || null,
          claimedById,
          amount: parseFloat(amount),
          purchaseDate,
          photos,
          notes: notes || null,
          items: cartItems.filter((i) => i.productId).map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Submit failed");
      }

      const data = await res.json();
      setResult({
        orderNumber: data.order.orderNumber,
        invoiceNumber: data.invoice.invoiceNumber,
      });
      setSubmitted(true);
    } catch (err) {
      if (sessionExpiryHandled()) return;
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  // Reset for another submission
  const resetForm = () => {
    setPhotos([]);
    setExtracted(null);
    setSupplierId("");
    setSupplierName("");
    setCartItems([]);
    setAmount("");
    setPurchaseDate(new Date().toISOString().split("T")[0]);
    setNotes("");
    setSubmitted(false);
    setResult(null);
    setError("");
  };

  // Success state
  if (submitted && result) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-ok-soft">
          <Check className="h-10 w-10 text-ok-text" />
        </div>
        <h1 className="mt-4 text-xl font-bold text-text">Claim sent</h1>
        <p className="mt-1 text-sm text-text-3">
          Order {result.orderNumber}
        </p>
        <p className="text-sm text-text-3">
          Invoice {result.invoiceNumber}
        </p>
        <p className="mt-3 text-center text-xs text-text-3">
          Your claim is saved as a draft. The procurement officer will review it.
        </p>
        <Button
          onClick={resetForm}
          className="mt-6 bg-ink hover:bg-brand/90"
        >
          <Receipt className="mr-2 h-4 w-4" />
          Send another
        </Button>
      </div>
    );
  }

  return (
    <div className="px-4 pb-32">
      <div className="space-y-4">
        {/* Header */}
        <PageHeader
          title="Pay and claim"
          description="Photograph the receipt and we fill in the details."
          backHref="/inventory"
        />

        {/* Hero Upload Zone — opens fullscreen camera modal */}
        <Card
          className="relative cursor-pointer border-2 border-dashed border-brand/30 bg-brand-soft transition-colors hover:border-brand/50 hover:bg-brand-soft active:scale-[0.98]"
          onClick={() => setCameraOpen(true)}
        >
          <div className="flex flex-col items-center justify-center py-10">
            {uploading ? (
              <>
                <Loader2 className="h-12 w-12 animate-spin text-brand-text" />
                <p className="mt-3 text-sm font-medium text-brand-text">
                  Uploading...
                </p>
              </>
            ) : (
              <>
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-soft">
                  <Camera className="h-8 w-8 text-brand-text" />
                </div>
                <p className="mt-3 text-sm font-semibold text-brand-text">
                  {photos.length > 0 ? "Add another photo" : "Take a photo of the receipt"}
                </p>
                <p className="mt-1 text-xs text-text-3">
                  Tap to open camera
                </p>
              </>
            )}
          </div>
          {/* Camera-only single-shot input. NO `multiple` (Chrome on
              Android falls through to the file picker when both
              `capture` and `multiple` are set) and NO gallery option
              (audit/integrity — claims must be photographed live). The
              CameraCaptureModal below is the actual capture mechanism. */}
        </Card>

        {/* Photo Thumbnails */}
        {photos.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {photos.map((url, i) => (
              <div key={i} className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Receipt ${i + 1}`}
                  className="h-20 w-20 rounded-lg border border-line object-cover"
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removePhoto(i);
                  }}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-on-ink shadow"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* AI Extraction Status */}
        {photos.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-sunken/60 px-3 py-2">
            {extracting ? (
              <>
                <Sparkles className="h-4 w-4 animate-pulse text-warn" />
                <span className="text-xs text-text-2">
                  AI reading receipt...
                </span>
              </>
            ) : extracted ? (
              <>
                <Check className="h-4 w-4 text-ok" />
                <span className="text-xs text-text-2">
                  Details extracted
                  {extracted.confidence && (
                    <span className="ml-1 text-text-3">
                      ({extracted.confidence} confidence)
                    </span>
                  )}
                </span>
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 text-text-3" />
                <span className="text-xs text-text-3">
                  Upload complete
                </span>
              </>
            )}
          </div>
        )}

        {/* Form Fields */}
        {photos.length > 0 && (
          <div className="space-y-3">
            {/* Outlet — auto-detected from logged-in user */}
            <div>
              <label className="mb-1 block text-xs font-medium text-text-3">
                Outlet
              </label>
              <div className="rounded-lg border border-line bg-sunken/60 px-3 py-2.5 text-sm text-text">
                {outletName || "Loading..."}
              </div>
            </div>

            {/* Supplier */}
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-text-3">
                Supplier
                {extracted?.supplierName && supplierId && (
                  <span className="rounded bg-ok-soft px-1.5 py-0.5 text-[10px] font-medium text-ok-text">
                    AI matched
                  </span>
                )}
                {extracted?.supplierName && !supplierId && (
                  <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium text-warn-text">
                    AI: {extracted.supplierName}
                  </span>
                )}
              </label>
              <div className="relative">
                <select
                  value={supplierId}
                  onChange={(e) => {
                    setSupplierId(e.target.value);
                    const s = suppliers.find((s) => s.id === e.target.value);
                    if (s) setSupplierName(s.name);
                  }}
                  className="w-full appearance-none rounded-lg border border-line bg-surface px-3 py-2.5 pr-8 text-sm text-text focus:border-ink focus:outline-none focus:ring-1 focus:ring-text"
                >
                  <option value="">Select supplier</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-3 h-4 w-4 text-text-3" />
              </div>
            </div>

            {/* Items */}
            <div>
              <label className="mb-1 flex items-center justify-between text-xs font-medium text-text-3">
                <span className="flex items-center gap-1.5">
                  Items
                  {cartItems.length > 0 && cartItems.some((i) => i.matched) && (
                    <span className="rounded bg-ok-soft px-1.5 py-0.5 text-[10px] font-medium text-ok-text">
                      {cartItems.filter((i) => i.matched).length} AI matched
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setShowProductPicker(!showProductPicker)}
                  className="flex items-center gap-1 rounded-md bg-brand-soft px-2 py-1 text-[10px] font-medium text-brand-text hover:bg-brand-soft"
                >
                  <Plus className="h-3 w-3" /> Add Item
                </button>
              </label>

              {/* Product picker */}
              {showProductPicker && (() => {
                // Show supplier products first, then all others
                const selectedSupplier = suppliers.find((s) => s.id === supplierId);
                const supplierProductIds = new Set(selectedSupplier?.products.map((p) => p.id) ?? []);
                const sortedProducts = supplierId
                  ? [
                      ...products.filter((p) => supplierProductIds.has(p.id)),
                      ...products.filter((p) => !supplierProductIds.has(p.id)),
                    ]
                  : products;
                const filtered = sortedProducts.filter((p) =>
                  !productSearch ||
                  p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
                  p.sku.toLowerCase().includes(productSearch.toLowerCase())
                );
                return (
                  <div className="mb-2 rounded-lg border border-line bg-surface p-2">
                    <Input
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      placeholder="Search products..."
                      className="mb-2 text-xs"
                      autoFocus
                    />
                    <div className="max-h-40 overflow-y-auto space-y-0.5">
                      {filtered.slice(0, 20).map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            const existing = cartItems.find((c) => c.productId === p.id);
                            if (existing) {
                              setCartItems(cartItems.map((c) =>
                                c.productId === p.id ? { ...c, quantity: c.quantity + 1 } : c
                              ));
                            } else {
                              setCartItems([...cartItems, {
                                productId: p.id,
                                productName: p.name,
                                quantity: 1,
                                unitPrice: 0,
                                matched: false,
                              }]);
                            }
                            setShowProductPicker(false);
                            setProductSearch("");
                          }}
                          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-sunken/60"
                        >
                          <span className="font-medium text-text">
                            {p.name}
                            {supplierProductIds.has(p.id) && (
                              <span className="ml-1.5 text-[9px] text-ok-text">● supplier</span>
                            )}
                          </span>
                          <span className="text-text-3">{p.sku}</span>
                        </button>
                      ))}
                      {filtered.length === 0 && (
                        <p className="px-2 py-2 text-center text-xs text-text-3">No products found</p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Cart items list */}
              {cartItems.length > 0 && (
                <div className="space-y-1.5">
                  {cartItems.map((item, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
                        item.matched
                          ? "border-ok/30 bg-ok-soft/50"
                          : item.productId
                            ? "border-line bg-surface"
                            : "border-warn/30 bg-warn-soft/50"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-text truncate">
                          {item.productName}
                          {!item.productId && (
                            <span className="ml-1 text-[10px] text-warn-text">(unmatched)</span>
                          )}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="flex items-center rounded border border-line bg-surface">
                            <button
                              type="button"
                              onClick={() => {
                                if (item.quantity <= 1) {
                                  setCartItems(cartItems.filter((_, i) => i !== idx));
                                } else {
                                  setCartItems(cartItems.map((c, i) => i === idx ? { ...c, quantity: c.quantity - 1 } : c));
                                }
                              }}
                              className="px-1.5 py-0.5 text-text-3 hover:text-text-2"
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="min-w-[24px] text-center text-xs font-medium">{item.quantity}</span>
                            <button
                              type="button"
                              onClick={() => setCartItems(cartItems.map((c, i) => i === idx ? { ...c, quantity: c.quantity + 1 } : c))}
                              className="px-1.5 py-0.5 text-text-3 hover:text-text-2"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                          <span className="text-[10px] text-text-3">×</span>
                          <input
                            type="number"
                            value={item.unitPrice || ""}
                            onChange={(e) => setCartItems(cartItems.map((c, i) => i === idx ? { ...c, unitPrice: parseFloat(e.target.value) || 0 } : c))}
                            placeholder="Price"
                            className="w-16 rounded border border-line px-1.5 py-0.5 text-xs text-right"
                          />
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-medium text-text-2">
                          {(item.quantity * item.unitPrice).toFixed(2)}
                        </p>
                        <button
                          type="button"
                          onClick={() => setCartItems(cartItems.filter((_, i) => i !== idx))}
                          className="mt-1 text-line-ctl hover:text-danger"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-between rounded-lg bg-sunken/60 px-3 py-1.5 text-xs">
                    <span className="text-text-3">{cartItems.length} items</span>
                    <span className="font-medium text-text-2">
                      RM {cartItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              {cartItems.length === 0 && !extracting && (
                <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-xs text-text-3">
                  <Package className="mx-auto mb-1 h-4 w-4" />
                  AI will auto-detect items, or add manually
                </p>
              )}
            </div>

            {/* Amount */}
            <div>
              <label className="mb-1 block text-xs font-medium text-text-3">
                Amount (RM)
              </label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={extracting ? "Detecting..." : "0.00"}
                className="text-sm"
              />
            </div>

            {/* Purchase Date */}
            <div>
              <label className="mb-1 block text-xs font-medium text-text-3">
                Purchase date
              </label>
              <Input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="text-sm"
              />
            </div>

            {/* Who Paid — auto-set to logged-in user */}
            <div>
              <label className="mb-1 block text-xs font-medium text-text-3">
                Sent by
              </label>
              <div className="rounded-lg border border-line bg-sunken/60 px-3 py-2.5 text-sm text-text">
                {userName || "Loading..."}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="mb-1 block text-xs font-medium text-text-3">
                Notes (optional)
              </label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Urgent restock for weekend"
                className="text-sm"
              />
            </div>

            {/* Error */}
            {error && (
              <p className="text-xs text-danger">{error}</p>
            )}

            {/* Submit */}
            <Button
              onClick={handleSubmit}
              disabled={submitting || !selectedOutletId || !amount}
              className="w-full bg-ink py-3 text-sm font-semibold hover:bg-brand/90 disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Receipt className="mr-2 h-4 w-4" />
                  Send claim
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Fullscreen camera modal — only camera, never gallery. Uses
          getUserMedia so all Android browsers behave consistently. */}
      <CameraCaptureModal
        open={cameraOpen}
        facingMode="environment"
        title={photos.length > 0 ? "Add another receipt photo" : "Photograph the receipt"}
        onCapture={handleCameraCapture}
        onClose={() => setCameraOpen(false)}
      />
    </div>
  );
}
