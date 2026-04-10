"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { compressImage } from "@/lib/compress-image";
import {
  Camera,
  Upload,
  Sparkles,
  Check,
  Loader2,
  Receipt,
  X,
  ChevronDown,
} from "lucide-react";

type Supplier = { id: string; name: string };
type ExtractedData = {
  invoiceNumber: string | null;
  issueDate: string | null;
  amount: number | null;
  supplierName: string | null;
  confidence: string | null;
  notes: string | null;
};

export default function ClaimsPage() {
  // Upload state
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  }, []);

  // Handle file selection
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;

    setUploading(true);
    setError("");

    try {
      const uploadedUrls: string[] = [];

      for (const file of Array.from(files)) {
        // Compress image before uploading
        const dataUrl = await compressImage(file);
        const blob = await fetch(dataUrl).then((r) => r.blob());
        const compressedFile = new File([blob], file.name, {
          type: "image/jpeg",
        });

        const formData = new FormData();
        formData.append("file", compressedFile);

        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Upload failed");
        }

        const { url } = await res.json();
        uploadedUrls.push(url);
      }

      const allPhotos = [...photos, ...uploadedUrls];
      setPhotos(allPhotos);

      // Trigger AI extraction immediately
      triggerExtraction(allPhotos);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // AI extraction
  const triggerExtraction = async (urls: string[]) => {
    setExtracting(true);
    try {
      const res = await fetch("/api/claims/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
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
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
          <Check className="h-10 w-10 text-green-600" />
        </div>
        <h1 className="mt-4 text-xl font-bold text-gray-900">Claim Submitted!</h1>
        <p className="mt-1 text-sm text-gray-500">
          Order {result.orderNumber}
        </p>
        <p className="text-sm text-gray-500">
          Invoice {result.invoiceNumber}
        </p>
        <p className="mt-3 text-center text-xs text-gray-400">
          Your claim is saved as a draft. The procurement officer will review it.
        </p>
        <Button
          onClick={resetForm}
          className="mt-6 bg-terracotta hover:bg-terracotta/90"
        >
          <Receipt className="mr-2 h-4 w-4" />
          Submit Another
        </Button>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 pb-32">
      <div className="space-y-4">
        {/* Header */}
        <div>
          <h1 className="font-heading text-lg font-bold text-brand-dark">
            Submit Claim
          </h1>
          <p className="text-sm text-gray-500">
            Upload receipt, we'll extract the details
          </p>
        </div>

        {/* Hero Upload Zone */}
        <Card
          className="relative cursor-pointer border-2 border-dashed border-terracotta/30 bg-terracotta/5 transition-colors hover:border-terracotta/50 hover:bg-terracotta/10 active:scale-[0.98]"
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="flex flex-col items-center justify-center py-10">
            {uploading ? (
              <>
                <Loader2 className="h-12 w-12 animate-spin text-terracotta" />
                <p className="mt-3 text-sm font-medium text-terracotta">
                  Uploading...
                </p>
              </>
            ) : (
              <>
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-terracotta/10">
                  <Camera className="h-8 w-8 text-terracotta" />
                </div>
                <p className="mt-3 text-sm font-semibold text-terracotta-dark">
                  {photos.length > 0 ? "Add More Photos" : "Snap or Upload Receipt"}
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  Tap to take a photo or choose from gallery
                </p>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />
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
                  className="h-20 w-20 rounded-lg border border-gray-200 object-cover"
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removePhoto(i);
                  }}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-white shadow"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* AI Extraction Status */}
        {photos.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
            {extracting ? (
              <>
                <Sparkles className="h-4 w-4 animate-pulse text-amber-500" />
                <span className="text-xs text-gray-600">
                  AI reading receipt...
                </span>
              </>
            ) : extracted ? (
              <>
                <Check className="h-4 w-4 text-green-500" />
                <span className="text-xs text-gray-600">
                  Details extracted
                  {extracted.confidence && (
                    <span className="ml-1 text-gray-400">
                      ({extracted.confidence} confidence)
                    </span>
                  )}
                </span>
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 text-gray-400" />
                <span className="text-xs text-gray-400">
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
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Outlet
              </label>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900">
                {outletName || "Loading..."}
              </div>
            </div>

            {/* Supplier */}
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-500">
                Supplier
                {extracted?.supplierName && supplierId && (
                  <span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-600">
                    AI matched
                  </span>
                )}
                {extracted?.supplierName && !supplierId && (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
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
                  className="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 pr-8 text-sm text-gray-900 focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
                >
                  <option value="">Select supplier</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-3 h-4 w-4 text-gray-400" />
              </div>
            </div>

            {/* Amount */}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
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
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Purchase Date
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
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Submitted By
              </label>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900">
                {userName || "Loading..."}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
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
              <p className="text-xs text-red-500">{error}</p>
            )}

            {/* Submit */}
            <Button
              onClick={handleSubmit}
              disabled={submitting || !selectedOutletId || !amount}
              className="w-full bg-terracotta py-3 text-sm font-semibold hover:bg-terracotta/90 disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Receipt className="mr-2 h-4 w-4" />
                  Submit Claim
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
