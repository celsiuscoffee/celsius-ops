"use client";

import { useState, useEffect, Fragment } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useFetch } from "@/lib/use-fetch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Search,
  ChevronDown,
  Loader2,
  Plus,
  Minus,
  Trash2,
  Receipt,
  Upload,
  X,
  ImageIcon,
  DollarSign,
  Clock,
  CheckCircle2,
  UserCircle,
  FileText,
  Sparkles,
  Eye,
  XCircle,
  Save,
  AlertTriangle,
  ZoomIn,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────

type ClaimItem = {
  id: string;
  productId: string;
  product: string;
  sku: string;
  uom: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
};

type Claim = {
  id: string;
  orderNumber: string;
  orderType?: string;
  flow?: "CLAIM" | "REQUEST";
  expenseCategory?: "INGREDIENT" | "ASSET" | "MAINTENANCE" | "OTHER";
  outlet: string;
  outletCode: string;
  supplierId: string;
  supplier: string;
  claimedBy: string | null;
  claimedByBank: { bankName: string | null; bankAccountNumber: string | null; bankAccountName: string | null } | null;
  createdBy: string;
  totalAmount: number;
  notes: string | null;
  status: string;
  createdAt: string;
  items: ClaimItem[];
  invoice: {
    id: string;
    invoiceNumber: string;
    amount: number;
    status: string;
    photoCount: number;
    photos: string[];
    vendorName?: string | null;
    vendorBank?: { bankName: string; accountNumber: string | null; accountName: string | null } | null;
  } | null;
};

type OutletOption = { id: string; code: string; name: string };
type SupplierOption = { id: string; name: string; products: SupplierProduct[] };
type SupplierProduct = {
  id: string;
  name: string;
  sku: string;
  packageId: string | null;
  packageLabel: string;
  price: number;
};
type StaffOption = { id: string; name: string; role: string };

type CartItem = {
  productId: string;
  productPackageId: string | null;
  name: string;
  sku: string;
  packageLabel: string;
  quantity: number;
  unitPrice: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────

function aiConfidenceBadge(claim: Claim) {
  const hasSupplier = !!claim.supplierId;
  const hasItems = claim.items.length > 0;
  const hasAmount = claim.totalAmount > 0;
  const hasPhotos = (claim.invoice?.photoCount ?? 0) > 0;

  const score = [hasSupplier, hasItems, hasAmount, hasPhotos].filter(Boolean).length;
  if (score >= 3) return { label: "High", className: "border-green-200 bg-green-50 text-green-700" };
  if (score >= 2) return { label: "Medium", className: "border-amber-200 bg-amber-50 text-amber-700" };
  return { label: "Low", className: "border-red-200 bg-red-50 text-red-700" };
}

// ── Component ─────────────────────────────────────────────────────────────

export default function PayAndClaimPage() {
  // Current user
  const [currentUserId, setCurrentUserId] = useState("");
  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((me) => {
      if (me?.id) setCurrentUserId(me.id);
    }).catch(() => {});
  }, []);

  // List state
  const [tab, setTab] = useState<"draft" | "pending" | "reimbursed" | "all">("draft");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [outletFilter, setOutletFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  // Review dialog state
  const [reviewClaim, setReviewClaim] = useState<Claim | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  // Quick Upload dialog state
  const [quickUploadOpen, setQuickUploadOpen] = useState(false);

  // Shared options (loaded on demand)
  const [outlets, setOutlets] = useState<OutletOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);

  // Review form state
  const [rvSupplierId, setRvSupplierId] = useState("");
  const [rvStaffId, setRvStaffId] = useState("");
  const [rvAmount, setRvAmount] = useState("");
  const [rvDate, setRvDate] = useState("");
  const [rvInvoiceNum, setRvInvoiceNum] = useState("");
  const [rvNotes, setRvNotes] = useState("");
  const [rvCart, setRvCart] = useState<CartItem[]>([]);
  const [rvProductSearch, setRvProductSearch] = useState("");
  const [rvPhotoIdx, setRvPhotoIdx] = useState(0);
  const [rvSaving, setRvSaving] = useState(false);
  const [rvAiHints, setRvAiHints] = useState<Record<string, string>>({});
  const [rvAiFields, setRvAiFields] = useState<Record<string, boolean>>({});

  // Quick upload state
  const [quPhotos, setQuPhotos] = useState<string[]>([]);
  const [quOutletId, setQuOutletId] = useState("");
  const [quStaffId, setQuStaffId] = useState("");
  const [quNotes, setQuNotes] = useState("");
  const [quUploading, setQuUploading] = useState(false);
  const [quDragging, setQuDragging] = useState(false);
  const [quExtracting, setQuExtracting] = useState(false);
  const [quSubmitting, setQuSubmitting] = useState(false);
  const [quAiData, setQuAiData] = useState<Record<string, unknown>>({});
  const [quSupplierId, setQuSupplierId] = useState("");
  const [quAmount, setQuAmount] = useState("");
  const [quDate, setQuDate] = useState(new Date().toISOString().split("T")[0]);
  const [quDueDate, setQuDueDate] = useState("");
  const [quInvoiceNum, setQuInvoiceNum] = useState("");
  const [quCart, setQuCart] = useState<CartItem[]>([]);
  const [quProductSearch, setQuProductSearch] = useState("");
  const [quPhotoIdx, setQuPhotoIdx] = useState(0);
  // Expense request fields — category + flow drive the whole form shape
  const [quCategory, setQuCategory] = useState<"INGREDIENT" | "ASSET" | "MAINTENANCE" | "OTHER">("INGREDIENT");
  const [quFlow, setQuFlow] = useState<"CLAIM" | "REQUEST">("CLAIM");
  const [quVendorName, setQuVendorName] = useState("");
  const [quVendorBankName, setQuVendorBankName] = useState("");
  const [quVendorAccNum, setQuVendorAccNum] = useState("");
  const [quVendorAccName, setQuVendorAccName] = useState("");

  // Reimburse dialog state
  const [reimburseDialogOpen, setReimburseDialogOpen] = useState(false);
  const [reimburseClaim, setReimburseClaim] = useState<Claim | null>(null);
  const [reimbursePaymentRef, setReimbursePaymentRef] = useState("");
  const [reimbursePaymentVia, setReimbursePaymentVia] = useState("Bank Transfer");
  const [reimburseSaving, setReimburseSaving] = useState(false);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch claims list
  const queryUrl = `/api/inventory/pay-and-claim?tab=${tab}&search=${debouncedSearch}${outletFilter ? `&outlet=${outletFilter}` : ""}`;
  const { data: claims, isLoading, mutate } = useFetch<Claim[]>(queryUrl);

  // Summary counts (fetch all for counts)
  const { data: allClaims } = useFetch<Claim[]>(`/api/inventory/pay-and-claim?tab=all`);

  const draftClaims = allClaims?.filter((c) => c.status === "DRAFT") ?? [];
  const pendingClaims = allClaims?.filter((c) => c.status !== "DRAFT" && (c.invoice?.status === "PENDING" || c.invoice?.status === "OVERDUE")) ?? [];
  const reimbursedClaims = allClaims?.filter((c) => c.invoice?.status === "PAID") ?? [];

  const draftAmount = draftClaims.reduce((s, c) => s + c.totalAmount, 0);
  const pendingAmount = pendingClaims.reduce((s, c) => s + c.totalAmount, 0);
  const reimbursedAmount = reimbursedClaims.reduce((s, c) => s + c.totalAmount, 0);

  // Load options — returns suppliers list for immediate use
  const loadOptions = async (): Promise<SupplierOption[]> => {
    if (optionsLoaded || loadingOptions) return suppliers;
    setLoadingOptions(true);
    try {
      const [o, s, st] = await Promise.all([
        fetch("/api/settings/outlets?status=ACTIVE").then((r) => r.json()),
        fetch("/api/inventory/suppliers/products").then((r) => r.json()),
        fetch("/api/settings/staff").then((r) => r.json()),
      ]);
      setOutlets(o);
      setSuppliers(s);
      setStaff(Array.isArray(st) ? st : st.staff ?? []);
      setOptionsLoaded(true);
      setLoadingOptions(false);
      return s;
    } catch { /* ignore */ }
    setLoadingOptions(false);
    return suppliers;
  };

  // ── Review Dialog ───────────────────────────────────────────────────────

  const openReview = async (claim: Claim) => {
    const loadedSuppliers = await loadOptions();
    setReviewClaim(claim);

    // Parse AI hints from notes if JSON
    let aiHints: Record<string, string> = {};
    let aiFields: Record<string, boolean> = {};
    let userNotes = claim.notes ?? "";
    try {
      const parsed = JSON.parse(claim.notes ?? "");
      if (parsed?.aiExtracted) {
        aiHints = {
          supplierName: parsed.aiExtracted.supplierName ?? "",
          totalAmount: parsed.aiExtracted.totalAmount ?? "",
          issueDate: parsed.aiExtracted.issueDate ?? "",
          invoiceNumber: parsed.aiExtracted.invoiceNumber ?? "",
        };
        userNotes = parsed.userNotes ?? "";
        if (parsed.aiExtracted.supplierName) aiFields.supplier = true;
        if (parsed.aiExtracted.totalAmount) aiFields.amount = true;
        if (parsed.aiExtracted.issueDate) aiFields.date = true;
        if (parsed.aiExtracted.invoiceNumber) aiFields.invoiceNumber = true;
      }
    } catch { /* not JSON, use as-is */ }

    setRvAiHints(aiHints);
    setRvAiFields(aiFields);
    // Default to ADHOC supplier for pay & claim
    const adhocSupplier = loadedSuppliers.find((s) => s.name === "Ad-hoc Purchase");
    setRvSupplierId(claim.supplierId || adhocSupplier?.id || "");
    setRvStaffId(claim.claimedBy ? "" : currentUserId);
    setRvAmount(claim.totalAmount > 0 ? claim.totalAmount.toString() : (aiHints.totalAmount || ""));
    setRvDate(aiHints.issueDate || new Date(claim.createdAt).toISOString().split("T")[0]);
    setRvInvoiceNum(claim.invoice?.invoiceNumber ?? (aiHints.invoiceNumber || ""));
    setRvNotes(userNotes);
    setRvCart(
      claim.items.map((i) => ({
        productId: i.productId,
        productPackageId: null,
        name: i.product,
        sku: i.sku,
        packageLabel: i.uom,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
    );
    setRvProductSearch("");
    setRvPhotoIdx(0);
    setRvSaving(false);
    setReviewOpen(true);
  };

  const closeReview = () => {
    setReviewOpen(false);
    setReviewClaim(null);
  };

  // Review cart helpers
  const rvAddToCart = (p: SupplierProduct) => {
    const existing = rvCart.find((c) => c.productId === p.id && c.productPackageId === (p.packageId || null));
    if (existing) {
      setRvCart(rvCart.map((c) =>
        c.productId === p.id && c.productPackageId === (p.packageId || null)
          ? { ...c, quantity: c.quantity + 1 }
          : c,
      ));
    } else {
      setRvCart([...rvCart, {
        productId: p.id,
        productPackageId: p.packageId || null,
        name: p.name,
        sku: p.sku,
        packageLabel: p.packageLabel,
        quantity: 1,
        unitPrice: p.price,
      }]);
    }
  };

  const rvUpdateQty = (idx: number, qty: number) => {
    if (qty <= 0) setRvCart(rvCart.filter((_, i) => i !== idx));
    else setRvCart(rvCart.map((c, i) => (i === idx ? { ...c, quantity: qty } : c)));
  };

  const rvUpdatePrice = (idx: number, price: number) => {
    setRvCart(rvCart.map((c, i) => (i === idx ? { ...c, unitPrice: price } : c)));
  };

  const rvCartTotal = rvCart.reduce((s, c) => s + c.quantity * c.unitPrice, 0);

  const rvFilteredProducts = rvSupplierId
    ? (suppliers.find((s) => s.id === rvSupplierId)?.products ?? []).filter(
        (p) =>
          !rvProductSearch ||
          p.name.toLowerCase().includes(rvProductSearch.toLowerCase()) ||
          p.sku.toLowerCase().includes(rvProductSearch.toLowerCase()),
      )
    : [];

  // Quick upload cart helpers
  const quAddToCart = (p: SupplierProduct) => {
    const existing = quCart.find((c) => c.productId === p.id && c.productPackageId === (p.packageId || null));
    if (existing) {
      setQuCart(quCart.map((c) =>
        c.productId === p.id && c.productPackageId === (p.packageId || null)
          ? { ...c, quantity: c.quantity + 1 }
          : c,
      ));
    } else {
      setQuCart([...quCart, {
        productId: p.id,
        productPackageId: p.packageId || null,
        name: p.name,
        sku: p.sku,
        packageLabel: p.packageLabel,
        quantity: 1,
        unitPrice: p.price,
      }]);
    }
  };
  const quUpdateQty = (idx: number, qty: number) => {
    if (qty <= 0) setQuCart(quCart.filter((_, i) => i !== idx));
    else setQuCart(quCart.map((c, i) => (i === idx ? { ...c, quantity: qty } : c)));
  };
  const quUpdatePrice = (idx: number, price: number) => {
    setQuCart(quCart.map((c, i) => (i === idx ? { ...c, unitPrice: price } : c)));
  };
  const quCartTotal = quCart.reduce((s, c) => s + c.quantity * c.unitPrice, 0);
  const quFilteredProducts = quSupplierId
    ? (suppliers.find((s) => s.id === quSupplierId)?.products ?? []).filter(
        (p) =>
          !quProductSearch ||
          p.name.toLowerCase().includes(quProductSearch.toLowerCase()) ||
          p.sku.toLowerCase().includes(quProductSearch.toLowerCase()),
      )
    : [];

  const reviewPhotos = reviewClaim?.invoice?.photos ?? [];

  // Fix Cloudinary raw URLs for image display
  const toImageUrl = (url: string) => url.replace("/raw/upload/", "/image/upload/");
  const isPdf = (url: string) => /\.pdf($|\?)/i.test(url) || url.includes("/raw/upload/");

  const handleReviewAction = async (action: "approve" | "reject" | "save") => {
    if (!reviewClaim) return;
    setRvSaving(true);
    try {
      const payload: Record<string, unknown> = { action };
      if (action !== "reject") {
        payload.supplierId = rvSupplierId || undefined;
        payload.claimedById = rvStaffId || undefined;
        payload.amount = parseFloat(rvAmount) || undefined;
        payload.purchaseDate = rvDate || undefined;
        payload.invoiceNumber = rvInvoiceNum || undefined;
        payload.notes = rvNotes;
        if (rvCart.length > 0) {
          payload.items = rvCart.map((c) => ({
            productId: c.productId,
            productPackageId: c.productPackageId,
            quantity: c.quantity,
            unitPrice: c.unitPrice,
          }));
        }
      }

      const res = await fetch(`/api/inventory/pay-and-claim/${reviewClaim.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        closeReview();
        mutate();
      }
    } catch { /* ignore */ }
    setRvSaving(false);
  };

  // ── Quick Upload ────────────────────────────────────────────────────────

  const openQuickUpload = async () => {
    const loadedSuppliers = await loadOptions();
    setQuPhotos([]);
    setQuOutletId(outlets[0]?.id ?? "");
    setQuStaffId(currentUserId);
    setQuNotes("");
    setQuAiData({});
    const adhoc = loadedSuppliers.find((s) => s.name === "Ad-hoc Purchase");
    setQuSupplierId(adhoc?.id || "");
    setQuAmount("");
    setQuDate(new Date().toISOString().split("T")[0]);
    setQuDueDate("");
    setQuInvoiceNum("");
    setQuCart([]);
    setQuProductSearch("");
    setQuPhotoIdx(0);
    setQuickUploadOpen(true);
  };

  const processQuickUploadFiles = async (files: File[]) => {
    const valid = files.filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    if (!valid.length) return;
    setQuUploading(true);
    const newUrls: string[] = [];
    try {
      for (const file of valid) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/inventory/upload", { method: "POST", body: formData });
        if (res.ok) {
          const data = await res.json();
          newUrls.push(data.url);
          setQuPhotos((prev) => [...prev, data.url]);
        }
      }
    } catch { /* ignore */ }
    setQuUploading(false);

    // AI extraction — send supplier names + product catalog for matching
    if (newUrls.length > 0) {
      setQuExtracting(true);
      try {
        const supplierNames = suppliers.map((s) => s.name);
        // Build product catalog from all suppliers
        const productNames = suppliers.flatMap((s) =>
          (s.products ?? []).map((p) => `${p.name} [${p.sku}] (${p.packageLabel}) RM${p.price.toFixed(2)}`)
        );

        const res = await fetch("/api/inventory/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            urls: newUrls,
            context: "Staff pay & claim receipt/invoice. Extract supplier name, total amount, purchase date, invoice number, line items, delivery/shipping charges, outlet (from bill-to/ship-to address), and vendor bank details if printed on the invoice.",
            supplierNames,
            productNames: productNames.length > 0 ? productNames : undefined,
            outletNames: outlets.map((o) => o.name),
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setQuAiData(data);

          // Auto-populate fields from AI
          const total = data.amount ?? data.totalAmount;
          if (total) setQuAmount(String(total));
          if (data.issueDate) setQuDate(data.issueDate);
          if (data.invoiceNumber) setQuInvoiceNum(data.invoiceNumber);

          // Auto-populate vendor bank details (used by REQUEST flow for
          // asset/maintenance one-off vendors). Always populate — if the user
          // ends up in CLAIM flow, these get ignored on submit.
          if (data.vendorBankName) setQuVendorBankName(data.vendorBankName);
          if (data.vendorBankAccountNumber) setQuVendorAccNum(String(data.vendorBankAccountNumber).replace(/[\s-]/g, ""));
          if (data.vendorBankAccountName) setQuVendorAccName(data.vendorBankAccountName);
          // Prefill vendor name from supplier name if AI caught one
          if (data.supplierName && !quVendorName) setQuVendorName(data.supplierName);

          // Auto-select outlet from AI (billed-to / ship-to on invoice)
          if (data.outletName && !quOutletId) {
            const aiOutlet = data.outletName.toLowerCase();
            const match = outlets.find((o) => {
              const dbName = o.name.toLowerCase();
              return dbName === aiOutlet || dbName.includes(aiOutlet) || aiOutlet.includes(dbName);
            });
            if (match) setQuOutletId(match.id);
          }

          // Auto-select supplier
          if (data.supplierName) {
            const aiName = data.supplierName.toLowerCase();
            const match = suppliers.find((s) => {
              const dbName = s.name.toLowerCase();
              return dbName.includes(aiName) || aiName.includes(dbName) || dbName === aiName;
            });
            if (match) {
              setQuSupplierId(match.id);

              // Auto-populate cart from extracted items
              if (data.items?.length > 0 && match.products?.length > 0) {
                const cartItems: CartItem[] = [];
                for (const item of data.items) {
                  // Match extracted item to supplier product
                  const itemName = (item.name || "").toLowerCase();
                  const product = match.products.find((p) => {
                    const pName = p.name.toLowerCase();
                    return pName === itemName || pName.includes(itemName) || itemName.includes(pName);
                  });
                  if (product) {
                    cartItems.push({
                      productId: product.id,
                      productPackageId: product.packageId || null,
                      name: product.name,
                      sku: product.sku,
                      packageLabel: product.packageLabel,
                      quantity: item.quantity || 1,
                      unitPrice: item.unitPrice || product.price,
                    });
                  }
                }
                if (cartItems.length > 0) setQuCart(cartItems);
              }
            }
          }

          // Auto-add delivery charge as a note if present
          if (data.deliveryCharge && data.deliveryCharge > 0) {
            setQuNotes((prev) => prev ? `${prev} | Delivery: RM${data.deliveryCharge.toFixed(2)}` : `Delivery: RM${data.deliveryCharge.toFixed(2)}`);
          }
        }
      } catch { /* ignore */ }
      setQuExtracting(false);
    }
  };

  const handleQuickPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    await processQuickUploadFiles(Array.from(files));
    e.target.value = "";
  };

  const handleQuickDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setQuDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) await processQuickUploadFiles(files);
  };

  const handleQuickSubmit = async (asDraft: boolean) => {
    if (!quOutletId) return;
    setQuSubmitting(true);
    try {
      const isIngredient = quCategory === "INGREDIENT";
      const res = await fetch("/api/inventory/pay-and-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outletId: quOutletId,
          // REQUEST flow has no claimant; CLAIM flow requires one
          claimedById: quFlow === "REQUEST" ? undefined : (quStaffId || undefined),
          photos: quPhotos,
          notes: quNotes,
          draft: asDraft,
          quickUpload: true,
          aiExtracted: quAiData,
          supplierId: quSupplierId || undefined,
          amount: quAmount ? parseFloat(quAmount) : undefined,
          purchaseDate: quDate || (quAiData as Record<string, string>).issueDate || undefined,
          dueDate: quDueDate || undefined,
          invoiceNumber: quInvoiceNum || undefined,
          expenseCategory: quCategory,
          flow: quFlow,
          // Vendor fields only relevant for REQUEST flow with non-ingredient
          vendorName: quFlow === "REQUEST" && !isIngredient ? quVendorName || undefined : undefined,
          vendorBankName: quFlow === "REQUEST" && !isIngredient ? quVendorBankName || undefined : undefined,
          vendorBankAccountNumber: quFlow === "REQUEST" && !isIngredient ? quVendorAccNum || undefined : undefined,
          vendorBankAccountName: quFlow === "REQUEST" && !isIngredient ? quVendorAccName || undefined : undefined,
          // Items only for ingredient flow — asset/maintenance/other is a single amount
          items: isIngredient && quCart.length > 0 ? quCart.map((c) => ({
            productId: c.productId,
            productPackageId: c.productPackageId,
            name: c.name,
            sku: c.sku,
            packageLabel: c.packageLabel,
            quantity: c.quantity,
            unitPrice: c.unitPrice,
          })) : undefined,
        }),
      });
      if (res.ok) {
        setQuickUploadOpen(false);
        mutate();
      } else {
        const data = await res.json().catch(() => null);
        alert(data?.error || "Failed to save receipt. Please try again.");
      }
    } catch {
      alert("Network error. Please check your connection and try again.");
    }
    setQuSubmitting(false);
  };

  // Open "mark as paid" dialog (step 2 of two-step flow)
  const openReimburseDialog = (claim: Claim) => {
    setReimburseClaim(claim);
    setReimbursePaymentRef("");
    setReimbursePaymentVia("Bank Transfer");
    setReimburseDialogOpen(true);
  };

  // Step 1 of two-step flow — single click transitions PENDING/OVERDUE → INITIATED.
  // Mirrors the supplier invoice flow. No extra data needed; once initiated,
  // POP via Telegram (or manual "Mark Paid") closes it out.
  const [initiatingId, setInitiatingId] = useState<string | null>(null);
  const handleInitiatePayment = async (claim: Claim) => {
    if (!claim.invoice) return;
    setInitiatingId(claim.invoice.id);
    try {
      const res = await fetch(`/api/inventory/invoices/${claim.invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "INITIATED" }),
      });
      if (res.ok) mutate();
      else {
        const data = await res.json().catch(() => null);
        alert(data?.error || "Failed to initiate payment.");
      }
    } finally {
      setInitiatingId(null);
    }
  };

  // Mark invoice as paid (reimbursed) with payment details
  const handleReimburse = async () => {
    if (!reimburseClaim?.invoice) return;
    setReimburseSaving(true);
    try {
      await fetch(`/api/inventory/invoices/${reimburseClaim.invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "PAID",
          paidVia: reimbursePaymentVia,
          paymentRef: reimbursePaymentRef || undefined,
        }),
      });
      setReimburseDialogOpen(false);
      mutate();
    } finally {
      setReimburseSaving(false);
    }
  };

  const TABS = [
    { key: "draft" as const, label: "Draft" },
    { key: "pending" as const, label: "Pending" },
    { key: "reimbursed" as const, label: "Paid" },
    { key: "all" as const, label: "All" },
  ];

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-gray-900">Payment Requests</h1>
          <p className="mt-0.5 text-xs sm:text-sm text-gray-500">Staff claims and direct vendor payment requests</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/inventory/pay-and-claim/batches" className="flex-1 sm:flex-none">
            <Button size="sm" variant="outline" className="w-full sm:w-auto">
              Claim Batches
            </Button>
          </Link>
          <Button size="sm" variant="outline" onClick={openQuickUpload} className="flex-1 sm:flex-none">
            <Upload className="mr-1.5 h-4 w-4" /> New Request
          </Button>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {([
          { key: "draft" as const, label: "Draft / Review", icon: AlertTriangle, iconColor: "text-amber-500", valueColor: "text-amber-600", ring: "ring-amber-300", border: "border-amber-300", count: draftClaims.length, amount: draftAmount },
          { key: "pending" as const, label: "Pending Payment", icon: Clock, iconColor: "text-[#C2714F]", valueColor: "text-[#C2714F]", ring: "ring-[#C2714F]/30", border: "border-[#C2714F]", count: pendingClaims.length, amount: pendingAmount },
          { key: "reimbursed" as const, label: "Paid", icon: CheckCircle2, iconColor: "text-green-500", valueColor: "text-green-600", ring: "ring-green-300", border: "border-green-300", count: reimbursedClaims.length, amount: reimbursedAmount },
        ]).map((card) => (
          <Card
            key={card.key}
            className={`p-5 cursor-pointer transition-all hover:shadow-sm ${
              tab === card.key
                ? `${card.border} ring-2 ${card.ring} shadow-sm`
                : "hover:ring-2 hover:ring-gray-200"
            }`}
            onClick={() => setTab(card.key)}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <card.icon className={`h-4 w-4 ${card.iconColor}`} />
                <span className="text-xs text-gray-500">{card.label}</span>
              </div>
              {card.count > 0 && (
                <span className={`flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-white ${
                  card.key === "draft" ? "bg-amber-500" : card.key === "pending" ? "bg-[#C2714F]" : "bg-green-500"
                }`}>
                  {card.count}
                </span>
              )}
            </div>
            <p className={`text-xl font-bold font-sans ${card.valueColor}`}>
              {card.count} <span className="text-sm font-normal text-gray-400">requests</span>
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              RM {card.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
          </Card>
        ))}
      </div>

      {/* ── Tabs + Search + Outlet Filter ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <div className="-mx-3 flex rounded-none border-y sm:mx-0 sm:rounded-lg sm:border overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t.key ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {t.label}
              {t.key === "draft" && draftClaims.length > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-500 text-white px-1.5 py-0.5 text-[9px]">
                  {draftClaims.length}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:flex-1 sm:min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <Input
            placeholder="Search requests..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
        {outlets.length > 0 && (
          <select
            value={outletFilter}
            onChange={(e) => setOutletFilter(e.target.value)}
            className="rounded-md border px-2 py-1.5 text-xs h-8"
          >
            <option value="">All Outlets</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* ── Claims Table ── */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
      ) : !claims?.length ? (
        <div className="text-center py-12 text-sm text-gray-400">
          {tab === "draft" ? "No draft requests to review" : "No requests found"}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b bg-gray-50/50 text-gray-500 text-left">
                <th className="px-4 py-3 font-medium w-10"></th>
                <th className="px-4 py-3 font-medium">Claim #</th>
                <th className="px-4 py-3 font-medium">Outlet</th>
                <th className="px-4 py-3 font-medium">Supplier</th>
                <th className="px-4 py-3 font-medium">Paid By</th>
                <th className="px-4 py-3 font-medium text-right">Amount (RM)</th>
                <th className="px-4 py-3 font-medium">Status</th>
                {tab !== "reimbursed" && <th className="px-4 py-3 font-medium">AI</th>}
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {claims.map((c) => {
                const confidence = aiConfidenceBadge(c);
                return (
                  <Fragment key={c.id}>
                    <tr
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                    >
                      {/* Photo thumbnail */}
                      <td className="px-4 py-3">
                        {c.invoice && c.invoice.photos?.length > 0 ? (
                          <div
                            className="w-9 h-9 rounded border overflow-hidden cursor-pointer"
                            onClick={(e) => { e.stopPropagation(); openReview(c); }}
                          >
                            {isPdf(c.invoice.photos[0]) ? (
                              <div className="w-full h-full flex items-center justify-center bg-gray-50">
                                <FileText className="h-4 w-4 text-red-400" />
                              </div>
                            ) : (
                              <img
                                src={c.invoice.photos[0]}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            )}
                          </div>
                        ) : (
                          <div className="w-9 h-9 rounded border flex items-center justify-center bg-gray-50">
                            <ImageIcon className="h-3.5 w-3.5 text-gray-300" />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono font-medium">
                        <div className="flex items-center gap-1">
                          <ChevronDown className={`h-3 w-3 transition-transform ${expanded === c.id ? "rotate-180" : ""}`} />
                          {c.orderNumber}
                        </div>
                      </td>
                      <td className="px-4 py-3">{c.outlet}</td>
                      <td className="px-4 py-3">{c.supplier || <span className="text-gray-300">--</span>}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <UserCircle className="h-3 w-3 text-gray-400" />
                          {c.flow === "REQUEST"
                            ? (c.invoice?.vendorName ? `${c.invoice.vendorName} (vendor)` : "Vendor —")
                            : (c.claimedBy ?? "---")}
                        </div>
                        {c.expenseCategory && c.expenseCategory !== "INGREDIENT" && (
                          <Badge variant="outline" className="mt-1 h-4 px-1 text-[9px] uppercase border-gray-200 text-gray-600">
                            {c.expenseCategory}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {c.totalAmount > 0 ? `RM ${c.totalAmount.toFixed(2)}` : "---"}
                      </td>
                      <td className="px-4 py-3">
                        {c.status === "DRAFT" ? (
                          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                            Draft
                          </Badge>
                        ) : c.invoice ? (
                          <Badge
                            variant="outline"
                            className={
                              c.invoice.status === "PAID"
                                ? "border-green-200 bg-green-50 text-green-700"
                                : c.invoice.status === "OVERDUE"
                                  ? "border-red-200 bg-red-50 text-red-700"
                                  : "border-[#C2714F]/20 bg-[#C2714F]/5 text-[#C2714F]"
                            }
                          >
                            {c.invoice.status === "PAID" ? "Paid" : c.invoice.status}
                          </Badge>
                        ) : (
                          <Badge variant="outline">No Invoice</Badge>
                        )}
                      </td>
                      {tab !== "reimbursed" && (
                        <td className="px-4 py-3">
                          {c.status === "DRAFT" && (
                            <Badge variant="outline" className={confidence.className}>
                              <Sparkles className="h-2.5 w-2.5 mr-1" />
                              {confidence.label}
                            </Badge>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3 text-gray-500">{new Date(c.createdAt).toLocaleDateString("en-MY")}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {c.status === "DRAFT" && (
                            <Button
                              size="sm"
                              className="h-6 text-[10px] px-2 bg-[#C2714F] hover:bg-[#A85D3F] text-white"
                              onClick={(e) => { e.stopPropagation(); openReview(c); }}
                            >
                              <Eye className="mr-1 h-3 w-3" /> Review
                            </Button>
                          )}
                          {c.invoice && c.invoice.status !== "PAID" && c.status !== "DRAFT" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px] px-2"
                              onClick={(e) => { e.stopPropagation(); openReview(c); }}
                            >
                              <Eye className="mr-1 h-3 w-3" /> Edit
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded === c.id && (
                      <tr>
                        <td colSpan={tab !== "reimbursed" ? 10 : 9} className="bg-gray-50 px-6 py-3">
                          <div className="space-y-2">
                            <p className="text-[10px] text-gray-500 uppercase font-medium">Items</p>
                            {c.items.length === 0 ? (
                              <p className="text-[11px] text-gray-400 italic">No items yet -- needs review</p>
                            ) : (
                              <div className="grid grid-cols-[1fr_80px_80px_80px] gap-1 text-[11px]">
                                <span className="font-medium text-gray-500">Product</span>
                                <span className="font-medium text-gray-500 text-right">Qty</span>
                                <span className="font-medium text-gray-500 text-right">Price</span>
                                <span className="font-medium text-gray-500 text-right">Total</span>
                                {c.items.map((i) => (
                                  <Fragment key={i.id}>
                                    <span>{i.product} <span className="text-gray-400">({i.uom})</span></span>
                                    <span className="text-right font-mono">{i.quantity}</span>
                                    <span className="text-right font-mono">{i.unitPrice.toFixed(2)}</span>
                                    <span className="text-right font-mono">{i.totalPrice.toFixed(2)}</span>
                                  </Fragment>
                                ))}
                              </div>
                            )}
                            {c.notes && (() => {
                              // Notes field may contain raw JSON from AI extraction
                              // (shape: { userNotes, aiExtracted: {...} }). Parse it
                              // into readable lines when that's the case; otherwise
                              // just show the plain string.
                              type Ai = {
                                supplierName?: string | null;
                                issueDate?: string | null;
                                invoiceNumber?: string | null;
                                amount?: number | null;
                                deliveryCharge?: number | null;
                                notes?: string | null;
                                confidence?: string | null;
                                items?: unknown;
                              };
                              let userNotes: string | null = null;
                              let ai: Ai | null = null;
                              try {
                                const parsed = JSON.parse(c.notes);
                                if (parsed && typeof parsed === "object") {
                                  if ("aiExtracted" in parsed) ai = parsed.aiExtracted as Ai;
                                  if ("userNotes" in parsed) userNotes = (parsed.userNotes ?? null) as string | null;
                                }
                              } catch {
                                userNotes = c.notes;
                              }
                              return (
                                <div className="mt-2 space-y-1 text-[11px] text-gray-500">
                                  {userNotes && <p><span className="font-medium text-gray-600">Notes:</span> {userNotes}</p>}
                                  {ai && (
                                    <div className="rounded border border-gray-200 bg-white px-2 py-1.5">
                                      <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1 flex items-center gap-1">
                                        <Sparkles className="h-2.5 w-2.5" />
                                        Auto-extracted
                                        {ai.confidence && (
                                          <span className={`ml-1 rounded px-1 py-[1px] text-[9px] ${
                                            ai.confidence === "high" ? "bg-green-50 text-green-700"
                                            : ai.confidence === "low" ? "bg-red-50 text-red-700"
                                            : "bg-amber-50 text-amber-700"
                                          }`}>{ai.confidence}</span>
                                        )}
                                      </p>
                                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                                        {ai.supplierName && <div><span className="text-gray-400">Supplier</span> <span className="text-gray-700">{ai.supplierName}</span></div>}
                                        {ai.invoiceNumber && <div><span className="text-gray-400">Invoice #</span> <span className="text-gray-700 font-mono">{ai.invoiceNumber}</span></div>}
                                        {ai.issueDate && <div><span className="text-gray-400">Date</span> <span className="text-gray-700">{ai.issueDate}</span></div>}
                                        {ai.amount != null && <div><span className="text-gray-400">Amount</span> <span className="text-gray-700 font-mono">RM {Number(ai.amount).toFixed(2)}</span></div>}
                                        {ai.deliveryCharge != null && ai.deliveryCharge > 0 && <div><span className="text-gray-400">Delivery</span> <span className="text-gray-700 font-mono">RM {Number(ai.deliveryCharge).toFixed(2)}</span></div>}
                                      </div>
                                      {ai.notes && <p className="mt-1 text-[10px] text-gray-500 italic">{ai.notes}</p>}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                            {c.invoice && (
                              <p className="text-[11px] text-gray-500">
                                Invoice: {c.invoice.invoiceNumber}
                                {c.invoice.photoCount > 0 && (
                                  <span className="ml-2 inline-flex items-center gap-0.5">
                                    <ImageIcon className="h-3 w-3" /> {c.invoice.photoCount}
                                  </span>
                                )}
                              </p>
                            )}
                            <p className="text-[11px] text-gray-400">Created by: {c.createdBy}</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Review Dialog ── */}
      <Dialog open={reviewOpen} onOpenChange={(open) => { if (!open) closeReview(); }}>
        <DialogContent className="!max-w-6xl max-h-[95vh] overflow-hidden p-0">
          <div className="flex h-[90vh] flex-col lg:h-[85vh] lg:flex-row">
            {/* Left: Photo viewer (40% desktop, top 40vh on mobile) */}
            <div className="h-[40vh] w-full bg-gray-900 flex flex-col lg:h-auto lg:w-[40%]">
              <div className="p-4 border-b border-gray-700">
                <p className="text-xs text-gray-400 font-medium">Receipt / Invoice</p>
                {reviewPhotos.length > 0 && (
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    {rvPhotoIdx + 1} of {reviewPhotos.length}
                  </p>
                )}
              </div>
              <div className="flex-1 flex items-center justify-center relative p-4">
                {reviewPhotos.length === 0 ? (
                  <div className="text-center text-gray-500">
                    <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-30" />
                    <p className="text-xs">No receipt attached</p>
                  </div>
                ) : isPdf(reviewPhotos[rvPhotoIdx]) ? (
                  <iframe
                    src={reviewPhotos[rvPhotoIdx]}
                    className="w-full h-full rounded"
                    title="Receipt PDF"
                  />
                ) : (
                  <a
                    href={toImageUrl(reviewPhotos[rvPhotoIdx])}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative group"
                  >
                    <img
                      src={toImageUrl(reviewPhotos[rvPhotoIdx])}
                      alt="Receipt"
                      className="max-w-full max-h-full object-contain rounded"
                    />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/20 rounded transition-opacity">
                      <ZoomIn className="h-8 w-8 text-white" />
                    </div>
                  </a>
                )}
                {/* Nav arrows */}
                {reviewPhotos.length > 1 && (
                  <>
                    <button
                      onClick={() => setRvPhotoIdx((i) => (i > 0 ? i - 1 : reviewPhotos.length - 1))}
                      className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 rounded-full p-1.5 text-white hover:bg-black/70"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setRvPhotoIdx((i) => (i < reviewPhotos.length - 1 ? i + 1 : 0))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 rounded-full p-1.5 text-white hover:bg-black/70"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
              {/* Thumbnails */}
              {reviewPhotos.length > 1 && (
                <div className="p-3 border-t border-gray-700 flex gap-2 overflow-x-auto">
                  {reviewPhotos.map((url, i) => (
                    <button
                      key={i}
                      onClick={() => setRvPhotoIdx(i)}
                      className={`w-12 h-12 rounded border-2 overflow-hidden shrink-0 ${
                        i === rvPhotoIdx ? "border-white" : "border-gray-600 opacity-50"
                      }`}
                    >
                      {isPdf(url) ? (
                        <div className="w-full h-full flex items-center justify-center bg-gray-700">
                          <FileText className="h-4 w-4 text-gray-400" />
                        </div>
                      ) : (
                        <img src={toImageUrl(url)} alt="" className="w-full h-full object-cover" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Right: Editable form (60%) */}
            <div className="flex flex-1 flex-col lg:w-[60%] lg:flex-none">
              <div className="p-4 sm:p-5 border-b">
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <Receipt className="h-4 w-4" />
                  Review Claim: {reviewClaim?.orderNumber}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Submitted by {reviewClaim?.createdBy} on{" "}
                  {reviewClaim ? new Date(reviewClaim.createdAt).toLocaleDateString("en-MY") : ""}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {loadingOptions ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : (
                  <>
                    {/* Form fields */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1.5 flex items-center gap-1.5">
                          Supplier
                          {rvAiFields.supplier && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium text-purple-600">AI</span>}
                        </label>
                        <select
                          value={rvSupplierId}
                          onChange={(e) => setRvSupplierId(e.target.value)}
                          className="w-full rounded-md border px-3 py-2 text-sm"
                        >
                          <option value="">Select supplier</option>
                          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        {rvAiHints.supplierName && rvAiHints.supplierName !== "Ad-hoc Purchase" && (
                          <p className="text-[10px] text-purple-500 mt-1">
                            <Sparkles className="h-2.5 w-2.5 inline mr-0.5" />
                            Detected: &quot;{rvAiHints.supplierName}&quot;
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1.5 flex items-center gap-1.5">
                          Amount (RM)
                          {rvAiFields.amount && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium text-purple-600">AI</span>}
                        </label>
                        <Input
                          type="number"
                          step="0.01"
                          value={rvAmount}
                          onChange={(e) => setRvAmount(e.target.value)}
                          placeholder="0.00"
                          className={`h-9 text-sm ${rvAiFields.amount ? "border-purple-300 bg-purple-50/30" : ""}`}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1.5 flex items-center gap-1.5">
                          Purchase Date
                          {rvAiFields.date && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium text-purple-600">AI</span>}
                        </label>
                        <Input
                          type="date"
                          value={rvDate}
                          onChange={(e) => setRvDate(e.target.value)}
                          className={`h-9 text-sm ${rvAiFields.date ? "border-purple-300 bg-purple-50/30" : ""}`}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1.5 flex items-center gap-1.5">
                          Invoice Number
                          {rvAiFields.invoiceNumber && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium text-purple-600">AI</span>}
                        </label>
                        <Input
                          value={rvInvoiceNum}
                          onChange={(e) => setRvInvoiceNum(e.target.value)}
                          placeholder="Auto-generated if empty"
                          className={`h-9 text-sm ${rvAiFields.invoiceNumber ? "border-purple-300 bg-purple-50/30" : ""}`}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1.5 block">Claimed By (Staff)</label>
                        <select
                          value={rvStaffId}
                          onChange={(e) => setRvStaffId(e.target.value)}
                          className="w-full rounded-md border px-3 py-2 text-sm"
                        >
                          <option value="">{reviewClaim?.claimedBy || "Select staff"}</option>
                          {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1.5 block">Outlet</label>
                        <Input value={reviewClaim?.outlet ?? ""} disabled className="h-9 text-sm bg-gray-50" />
                      </div>
                    </div>

                    {/* Notes */}
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1.5 block">Notes</label>
                      <Input
                        value={rvNotes}
                        onChange={(e) => setRvNotes(e.target.value)}
                        placeholder="Add notes..."
                        className="h-9 text-sm"
                      />
                    </div>

                    {/* Product items */}
                    <div className="border-t pt-4">
                      <label className="text-xs font-semibold text-gray-700 mb-2 block">
                        Product Items
                        {rvCart.length === 0 && (
                          <span className="ml-2 text-[10px] font-normal text-amber-500">Add items before approving</span>
                        )}
                      </label>

                      {/* Product picker */}
                      {rvSupplierId && (
                        <div className="mb-3">
                          <div className="relative mb-2">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <Input
                              placeholder="Search products to add..."
                              value={rvProductSearch}
                              onChange={(e) => setRvProductSearch(e.target.value)}
                              className="pl-9 h-9 text-sm"
                            />
                          </div>
                          {rvProductSearch && rvFilteredProducts.length > 0 && (
                            <div className="border rounded-lg max-h-36 overflow-y-auto divide-y mb-2">
                              {rvFilteredProducts.slice(0, 10).map((p) => (
                                <button
                                  key={`${p.id}-${p.packageId}`}
                                  onClick={() => { rvAddToCart(p); setRvProductSearch(""); }}
                                  className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50"
                                >
                                  <div>
                                    <span className="font-medium">{p.name}</span>
                                    <span className="text-gray-400 ml-1.5 text-xs">({p.packageLabel})</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-500 font-mono text-xs">RM {p.price.toFixed(2)}</span>
                                    <Plus className="h-3.5 w-3.5 text-gray-400" />
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Cart */}
                      {rvCart.length > 0 ? (
                        <div className="border rounded-lg divide-y">
                          {rvCart.map((item, idx) => (
                            <div key={idx} className="flex items-center gap-2 px-3 py-2.5">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{item.name}</p>
                                <p className="text-[10px] text-gray-400">{item.packageLabel}</p>
                              </div>
                              <div className="flex items-center gap-1">
                                <button onClick={() => rvUpdateQty(idx, item.quantity - 1)} className="rounded p-0.5 hover:bg-gray-100">
                                  <Minus className="h-3 w-3" />
                                </button>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={item.quantity}
                                  onChange={(e) => rvUpdateQty(idx, parseFloat(e.target.value) || 0)}
                                  className="w-14 h-7 text-xs text-center"
                                />
                                <button onClick={() => rvUpdateQty(idx, item.quantity + 1)} className="rounded p-0.5 hover:bg-gray-100">
                                  <Plus className="h-3 w-3" />
                                </button>
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-gray-400">RM</span>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={item.unitPrice}
                                  onChange={(e) => rvUpdatePrice(idx, parseFloat(e.target.value) || 0)}
                                  className="w-20 h-7 text-xs text-right"
                                />
                              </div>
                              <span className="text-xs font-mono w-20 text-right">
                                RM {(item.quantity * item.unitPrice).toFixed(2)}
                              </span>
                              <button onClick={() => setRvCart(rvCart.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600 p-0.5">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                          <div className="flex items-center justify-between px-3 py-2.5 bg-gray-50 font-medium text-sm">
                            <span>Total</span>
                            <span className="font-mono">RM {rvCartTotal.toFixed(2)}</span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </>
                )}
              </div>

              {/* Action buttons */}
              <div className="border-t px-5 py-3 flex items-center justify-between bg-white">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-red-200 text-red-600 hover:bg-red-50"
                  disabled={rvSaving}
                  onClick={() => handleReviewAction("reject")}
                >
                  <XCircle className="mr-1.5 h-3.5 w-3.5" /> Reject
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={rvSaving}
                    onClick={() => handleReviewAction("save")}
                  >
                    {rvSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                    Save Draft
                  </Button>
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    disabled={rvSaving || rvCart.length === 0 || !rvSupplierId}
                    onClick={() => handleReviewAction("approve")}
                  >
                    {rvSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                    Approve
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Quick Upload Dialog (full layout like review) ── */}
      <Dialog open={quickUploadOpen} onOpenChange={(open) => { if (!open) { setQuickUploadOpen(false); setQuSupplierId(""); setQuAmount(""); setQuDate(new Date().toISOString().split("T")[0]); setQuInvoiceNum(""); setQuCart([]); setQuProductSearch(""); setQuPhotoIdx(0); setQuPhotos([]); setQuAiData({}); setQuNotes(""); setQuOutletId(""); setQuStaffId(""); setQuCategory("INGREDIENT"); setQuFlow("CLAIM"); setQuVendorName(""); setQuVendorBankName(""); setQuVendorAccNum(""); setQuVendorAccName(""); } }}>
        <DialogContent className="!max-w-6xl max-h-[95vh] overflow-hidden p-0">
          <div className="flex h-[90vh] flex-col lg:h-[85vh] lg:flex-row">
            {/* Left: Photo upload & viewer (40% desktop, top 40vh mobile) */}
            <div className="h-[40vh] w-full bg-gray-900 flex flex-col lg:h-auto lg:w-[40%]"
              onDragOver={(e) => { e.preventDefault(); setQuDragging(true); }}
              onDragEnter={(e) => { e.preventDefault(); setQuDragging(true); }}
              onDragLeave={(e) => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setQuDragging(false); }}
              onDrop={handleQuickDrop}
            >
              <div className="p-4 border-b border-gray-700">
                <p className="text-xs text-gray-400 font-medium">Receipt / Invoice</p>
                {quPhotos.length > 0 && (
                  <p className="text-[10px] text-gray-500 mt-0.5">{quPhotoIdx + 1} of {quPhotos.length}</p>
                )}
              </div>
              <div className="flex-1 flex items-center justify-center relative p-4">
                {quPhotos.length === 0 ? (
                  <label className={`flex flex-col items-center justify-center cursor-pointer text-center rounded-lg border-2 border-dashed p-8 w-full h-full transition-colors ${quDragging ? "border-[#C2714F] bg-orange-900/20" : "border-gray-600"}`}>
                    {quUploading ? (
                      <Loader2 className="h-10 w-10 animate-spin text-gray-400 mb-3" />
                    ) : (
                      <Upload className="h-10 w-10 text-gray-500 mb-3" />
                    )}
                    <span className="text-sm text-gray-400">{quDragging ? "Drop files here" : "Click or drag to upload"}</span>
                    <span className="text-[10px] text-gray-500 mt-1">Images or PDFs</span>
                    <input type="file" accept="image/*,.pdf" multiple onChange={handleQuickPhotoUpload} className="hidden" />
                  </label>
                ) : isPdf(quPhotos[quPhotoIdx]) ? (
                  <iframe src={quPhotos[quPhotoIdx]} className="w-full h-full rounded" title="Receipt PDF" />
                ) : (
                  <img src={toImageUrl(quPhotos[quPhotoIdx])} alt="Receipt" className="max-w-full max-h-full object-contain rounded" />
                )}
                {quPhotos.length > 1 && (
                  <>
                    <button onClick={() => setQuPhotoIdx((i) => (i > 0 ? i - 1 : quPhotos.length - 1))} className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 rounded-full p-1.5 text-white hover:bg-black/70">
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button onClick={() => setQuPhotoIdx((i) => (i < quPhotos.length - 1 ? i + 1 : 0))} className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 rounded-full p-1.5 text-white hover:bg-black/70">
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </>
                )}
                {quExtracting && (
                  <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-lg border border-purple-400/50 bg-purple-900/80 px-4 py-2">
                    <Sparkles className="h-4 w-4 animate-pulse text-purple-300" />
                    <span className="text-xs text-purple-200">AI reading receipt...</span>
                  </div>
                )}
              </div>
              {/* Thumbnails + add more */}
              {quPhotos.length > 0 && (
                <div className="p-3 border-t border-gray-700 flex gap-2 overflow-x-auto">
                  {quPhotos.map((url, i) => (
                    <button key={i} onClick={() => setQuPhotoIdx(i)} className={`w-12 h-12 rounded border-2 overflow-hidden shrink-0 relative group ${i === quPhotoIdx ? "border-white" : "border-gray-600 opacity-50"}`}>
                      {isPdf(url) ? (
                        <div className="w-full h-full flex items-center justify-center bg-gray-700"><FileText className="h-4 w-4 text-gray-400" /></div>
                      ) : (
                        <img src={toImageUrl(url)} alt="" className="w-full h-full object-cover" />
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); setQuPhotos(quPhotos.filter((_, j) => j !== i)); if (quPhotoIdx >= quPhotos.length - 1) setQuPhotoIdx(Math.max(0, quPhotos.length - 2)); }}
                        className="absolute top-0 right-0 bg-black/60 rounded-bl p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-2.5 w-2.5 text-white" />
                      </button>
                    </button>
                  ))}
                  <label className="w-12 h-12 rounded border-2 border-dashed border-gray-600 flex items-center justify-center cursor-pointer hover:border-gray-400 shrink-0">
                    {quUploading ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : <Plus className="h-4 w-4 text-gray-500" />}
                    <input type="file" accept="image/*,.pdf" multiple onChange={handleQuickPhotoUpload} className="hidden" />
                  </label>
                </div>
              )}
            </div>

            {/* Right: Form (60%) */}
            <div className="flex flex-1 flex-col lg:w-[60%] lg:flex-none">
              <div className="p-4 sm:p-5 border-b">
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <Receipt className="h-4 w-4" /> New Expense Request
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {quFlow === "REQUEST"
                    ? "Finance pays the vendor directly. Upload invoice and vendor bank details."
                    : quCategory === "INGREDIENT"
                      ? "Upload receipt and fill in claim details"
                      : "You paid out of pocket. Upload receipt — finance will reimburse you to your HR bank account."}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {/* Category + Flow toggles — drive form shape */}
                <div className="space-y-3 rounded-lg border bg-gray-50 p-3">
                  <div>
                    <label className="text-[10px] uppercase font-semibold tracking-wider text-gray-500 mb-1.5 block">Category</label>
                    <div className="flex gap-1">
                      {(["INGREDIENT", "ASSET", "MAINTENANCE", "OTHER"] as const).map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setQuCategory(cat)}
                          className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                            quCategory === cat
                              ? "border-[#C2714F] bg-[#C2714F] text-white"
                              : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                          }`}
                        >
                          {cat === "INGREDIENT" ? "Ingredient" : cat === "ASSET" ? "Asset" : cat === "MAINTENANCE" ? "Maintenance" : "Other"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-semibold tracking-wider text-gray-500 mb-1.5 block">Flow</label>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setQuFlow("CLAIM")}
                        className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium text-left transition-colors ${
                          quFlow === "CLAIM"
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        <div className="font-semibold">Reimburse me</div>
                        <div className="text-[10px] font-normal opacity-80">I already paid out of pocket</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setQuFlow("REQUEST")}
                        className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium text-left transition-colors ${
                          quFlow === "REQUEST"
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        <div className="font-semibold">Pay vendor directly</div>
                        <div className="text-[10px] font-normal opacity-80">Finance transfers to vendor</div>
                      </button>
                    </div>
                  </div>
                </div>

                {/* AI detection banner */}
                {Object.keys(quAiData).length > 0 && !quExtracting && (
                  <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                    <Sparkles className="h-4 w-4 text-green-500" />
                    <span className="text-xs text-green-700">
                      AI detected:{" "}
                      {(quAiData as Record<string, string>).supplierName && `${(quAiData as Record<string, string>).supplierName}`}
                      {(quAiData as Record<string, string>).totalAmount && ` / RM ${(quAiData as Record<string, string>).totalAmount}`}
                      {(quAiData as Record<string, string>).issueDate && ` / ${(quAiData as Record<string, string>).issueDate}`}
                    </span>
                  </div>
                )}

                {/* Form fields — shape depends on category + flow */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Supplier — only for INGREDIENT (others use free-text vendor or staff-paid) */}
                  {quCategory === "INGREDIENT" && (
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1.5 flex items-center gap-1.5">
                        Supplier
                        {(quAiData as Record<string, string>).supplierName && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium text-purple-600">AI</span>}
                      </label>
                      <select value={quSupplierId} onChange={(e) => setQuSupplierId(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm">
                        <option value="">Select supplier</option>
                        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1.5 flex items-center gap-1.5">
                      Amount (RM) *
                      {(quAiData as Record<string, string>).totalAmount && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium text-purple-600">AI</span>}
                    </label>
                    <Input type="number" step="0.01" value={quAmount} onChange={(e) => setQuAmount(e.target.value)} placeholder="0.00" className={`h-9 text-sm ${(quAiData as Record<string, string>).totalAmount ? "border-purple-300 bg-purple-50/30" : ""}`} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1.5 flex items-center gap-1.5">
                      {quCategory === "INGREDIENT" ? "Purchase Date" : "Request Date"}
                      {(quAiData as Record<string, string>).issueDate && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium text-purple-600">AI</span>}
                    </label>
                    <Input type="date" value={quDate} onChange={(e) => setQuDate(e.target.value)} className={`h-9 text-sm ${(quAiData as Record<string, string>).issueDate ? "border-purple-300 bg-purple-50/30" : ""}`} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1.5 block">Due Date</label>
                    <Input type="date" value={quDueDate} onChange={(e) => setQuDueDate(e.target.value)} min={quDate || undefined} className="h-9 text-sm" placeholder="When payment is due" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1.5 flex items-center gap-1.5">
                      Invoice / Ref Number
                      {(quAiData as Record<string, string>).invoiceNumber && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium text-purple-600">AI</span>}
                    </label>
                    <Input value={quInvoiceNum} onChange={(e) => setQuInvoiceNum(e.target.value)} placeholder="Auto-generated if empty" className={`h-9 text-sm ${(quAiData as Record<string, string>).invoiceNumber ? "border-purple-300 bg-purple-50/30" : ""}`} />
                  </div>
                  {/* Claimed By — only for CLAIM flow (REQUEST has no staff payee) */}
                  {quFlow === "CLAIM" && (
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1.5 block">Claimed By (Staff) *</label>
                      <select value={quStaffId} onChange={(e) => setQuStaffId(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm">
                        <option value="">Select staff</option>
                        {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1.5 block">Outlet *</label>
                    <select value={quOutletId} onChange={(e) => setQuOutletId(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm">
                      <option value="">Select outlet</option>
                      {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                </div>

                {/* One-off vendor block — REQUEST flow for asset/maintenance/other */}
                {quFlow === "REQUEST" && quCategory !== "INGREDIENT" && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] uppercase font-semibold tracking-wider text-blue-700">One-off Vendor Details</p>
                      <p className="text-[10px] text-blue-600">Finance will transfer to this account</p>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 mb-1 block">Vendor Name *</label>
                      <Input value={quVendorName} onChange={(e) => setQuVendorName(e.target.value)} placeholder="e.g. Pak Man Aircond, Shopee, IKEA" className="h-9 text-sm" />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1 block">Bank</label>
                        <Input value={quVendorBankName} onChange={(e) => setQuVendorBankName(e.target.value)} placeholder="Maybank" className="h-9 text-sm" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1 block">Account No.</label>
                        <Input value={quVendorAccNum} onChange={(e) => setQuVendorAccNum(e.target.value)} placeholder="1234567890" className="h-9 text-sm font-mono" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-500 mb-1 block">Account Name</label>
                        <Input value={quVendorAccName} onChange={(e) => setQuVendorAccName(e.target.value)} placeholder="Account holder" className="h-9 text-sm" />
                      </div>
                    </div>
                  </div>
                )}

                {/* Notes */}
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1.5 block">Notes</label>
                  <Input value={quNotes} onChange={(e) => setQuNotes(e.target.value)} placeholder="Add notes..." className="h-9 text-sm" />
                </div>

                {/* Product items — INGREDIENT only (asset/maintenance/other are amount-only) */}
                {quCategory === "INGREDIENT" && (
                <div className="border-t pt-4">
                  <label className="text-xs font-semibold text-gray-700 mb-2 block">
                    Product Items
                    {quCart.length === 0 && <span className="ml-2 text-[10px] font-normal text-amber-500">Add items before approving</span>}
                  </label>

                  <div className="mb-3">
                    {!quSupplierId && (
                      <p className="text-[11px] text-gray-400 italic mb-2">Select a supplier above to search products</p>
                    )}
                    {quSupplierId && (
                      <div className="relative mb-2">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <Input placeholder="Search products to add..." value={quProductSearch} onChange={(e) => setQuProductSearch(e.target.value)} className="pl-9 h-9 text-sm" />
                      </div>
                    )}
                      {quProductSearch && quFilteredProducts.length > 0 && (
                        <div className="border rounded-lg max-h-36 overflow-y-auto divide-y mb-2">
                          {quFilteredProducts.slice(0, 10).map((p) => (
                            <button key={`${p.id}-${p.packageId}`} onClick={() => { quAddToCart(p); setQuProductSearch(""); }} className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50">
                              <div>
                                <span className="font-medium">{p.name}</span>
                                <span className="text-gray-400 ml-1.5 text-xs">({p.packageLabel})</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-gray-500 font-mono text-xs">RM {p.price.toFixed(2)}</span>
                                <Plus className="h-3.5 w-3.5 text-gray-400" />
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                  </div>

                  {/* Cart */}
                  {quCart.length > 0 && (
                    <div className="border rounded-lg divide-y">
                      {quCart.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2 px-3 py-2.5">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.name}</p>
                            <p className="text-[10px] text-gray-400">{item.packageLabel}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button onClick={() => quUpdateQty(idx, item.quantity - 1)} className="rounded p-0.5 hover:bg-gray-100"><Minus className="h-3 w-3" /></button>
                            <Input type="number" step="0.01" value={item.quantity} onChange={(e) => quUpdateQty(idx, parseFloat(e.target.value) || 0)} className="w-14 h-7 text-xs text-center" />
                            <button onClick={() => quUpdateQty(idx, item.quantity + 1)} className="rounded p-0.5 hover:bg-gray-100"><Plus className="h-3 w-3" /></button>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-gray-400">RM</span>
                            <Input type="number" step="0.01" value={item.unitPrice} onChange={(e) => quUpdatePrice(idx, parseFloat(e.target.value) || 0)} className="w-20 h-7 text-xs text-right" />
                          </div>
                          <span className="text-xs font-mono w-20 text-right">RM {(item.quantity * item.unitPrice).toFixed(2)}</span>
                          <button onClick={() => setQuCart(quCart.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600 p-0.5"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      ))}
                      <div className="flex items-center justify-between px-3 py-2.5 bg-gray-50 font-medium text-sm">
                        <span>Total</span>
                        <span className="font-mono">RM {quCartTotal.toFixed(2)}</span>
                      </div>
                    </div>
                  )}
                </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="border-t px-5 py-3 flex items-center justify-end gap-2 bg-white">
                <Button variant="outline" onClick={() => setQuickUploadOpen(false)}>Cancel</Button>
                <Button
                  variant="outline"
                  disabled={quSubmitting || !quOutletId || quPhotos.length === 0}
                  onClick={() => handleQuickSubmit(true)}
                >
                  {quSubmitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                  Save Draft
                </Button>
                <Button
                  disabled={quSubmitting || !quOutletId || quPhotos.length === 0}
                  onClick={() => handleQuickSubmit(false)}
                  className="bg-[#C2714F] hover:bg-[#A85D3F] text-white"
                >
                  {quSubmitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                  Submit
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Reimburse Dialog ── */}
      <Dialog open={reimburseDialogOpen} onOpenChange={(open) => { if (!open) setReimburseDialogOpen(false); }}>
        <DialogContent className="!max-w-md p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" /> Mark as Paid
            </DialogTitle>
          </DialogHeader>

          {reimburseClaim && (
            <div className="space-y-4">
              {/* Claim summary */}
              <div className="rounded-lg border bg-gray-50 p-3 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Claim</span>
                  <span className="font-medium">{reimburseClaim.orderNumber}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Paid by</span>
                  <span className="font-medium">{reimburseClaim.claimedBy || reimburseClaim.createdBy}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Amount</span>
                  <span className="font-semibold text-lg text-[#C2714F]">RM {reimburseClaim.invoice?.amount.toFixed(2) || reimburseClaim.totalAmount.toFixed(2)}</span>
                </div>
              </div>

              {/* Payee bank details — vendor (REQUEST) or staff (CLAIM) */}
              {(() => {
                const isRequest = reimburseClaim.flow === "REQUEST";
                const payeeLabel = isRequest
                  ? (reimburseClaim.invoice?.vendorName ? `Vendor: ${reimburseClaim.invoice.vendorName}` : "Vendor")
                  : `Staff: ${reimburseClaim.claimedBy ?? reimburseClaim.createdBy}`;
                const bank = isRequest
                  ? reimburseClaim.invoice?.vendorBank
                    ? {
                        bankName: reimburseClaim.invoice.vendorBank.bankName,
                        bankAccountNumber: reimburseClaim.invoice.vendorBank.accountNumber,
                        bankAccountName: reimburseClaim.invoice.vendorBank.accountName,
                      }
                    : null
                  : reimburseClaim.claimedByBank;
                return (
                  <div className="rounded-lg border p-3 space-y-1.5">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Transfer To</p>
                      <p className="text-[10px] text-gray-500">{payeeLabel}</p>
                    </div>
                    {bank?.bankAccountNumber ? (
                      <>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Bank</span>
                          <span className="font-medium">{bank.bankName || "—"}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Account No.</span>
                          <span className="font-mono font-medium">{bank.bankAccountNumber}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Account Name</span>
                          <span className="font-medium">{bank.bankAccountName || "—"}</span>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-amber-600">
                        {isRequest
                          ? "No vendor bank details on the request — check the invoice photo."
                          : "No bank details on file for this staff member."}
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Payment details */}
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1.5 block">Payment Method</label>
                  <select
                    value={reimbursePaymentVia}
                    onChange={(e) => setReimbursePaymentVia(e.target.value)}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  >
                    <option>Bank Transfer</option>
                    <option>Cash</option>
                    <option>E-Wallet</option>
                    <option>Cheque</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1.5 block">Payment Reference (optional)</label>
                  <Input
                    value={reimbursePaymentRef}
                    onChange={(e) => setReimbursePaymentRef(e.target.value)}
                    placeholder="e.g. transfer ref, cheque no."
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setReimburseDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={reimburseSaving}
              onClick={handleReimburse}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {reimburseSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
              Confirm Paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
