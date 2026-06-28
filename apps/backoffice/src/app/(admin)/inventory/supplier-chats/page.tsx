"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useFetch } from "@/lib/use-fetch";
import { formatRM } from "@celsius/shared";
import { EditOrderModal, type Order as EditOrder } from "@/components/inventory/EditOrderModal";
import {
  MessageCircle,
  AlertCircle,
  Clock,
  FileText,
  Send,
  Loader2,
  Phone,
  Check,
  ExternalLink,
  Search,
  Plus,
  X,
  Hand,
  ShoppingCart,
  Reply,
  Pin,
  MoreHorizontal,
  ChevronLeft,
  Info,
} from "lucide-react";

type AutomationMode = "OFF" | "ASSIST" | "AUTO";
type Thread = {
  key: string;
  supplierId: string | null;
  name: string;
  phone: string;
  preview: string;
  lastAt: string | null;
  count: number;
  needsAttention: boolean;
  awaitingReply: boolean;
  toPay: boolean;
  awaitingDelivery: boolean;
  registered: boolean;
  automationMode: AutomationMode | null;
  hasMessages: boolean;
};
type Counts = {
  all: number;
  suppliers: number;
  needsAttention: number;
  needsReply: number;
  toPay: number;
  awaitingDelivery: number;
  other: number;
  auto: number;
  assist: number;
  off: number;
};
type PoProduct = { supplierProductId: string; productId: string; name: string; packageLabel: string; productPackageId: string | null; price: number; moq: number };
type NeedItem = { productId: string; productPackageId: string | null; name: string; qty: number; unitPrice: number; packageLabel: string; onHand: number; reorderPoint: number };
type NeedGroup = { supplierId: string; supplierName: string; outletId: string; outletName: string; items: NeedItem[]; total: number; itemCount: number };

type Msg = {
  id: string;
  waMessageId: string | null;
  direction: "inbound" | "outbound";
  type: string;
  body: string | null;
  mediaUrl: string | null;
  status: string | null;
  timestamp: string;
};

type Detail = {
  key: string;
  supplierId: string | null;
  supplier: null | {
    id: string;
    name: string;
    phone: string | null;
    deliveryDays: string[];
    paymentTerms: string | null;
    leadTimeDays: number;
    automationMode: AutomationMode;
    paymentModel?: { model: string; label: string; note: string; popDeliveryCritical: boolean };
  };
  context: {
    openPOs: number;
    unpaidTotal: number;
    overdueTotal: number;
    recentPOs: { id: string; orderNumber: string; status: string }[];
    unpaidInvoices: { id: string; invoiceNumber: string; balance: number; status: string; dueDate: string | null; overdue: boolean }[];
  };
  windowOpen: boolean;
  humanHandling: boolean;
  messages: Msg[];
  agentProposal?: {
    messageId: string;
    orderId: string | null;
    intent: string;
    escalationReason: string;
    insight?: string;
    paymentModel?: string;
    popDeliveryCritical?: boolean;
    poAction: { type: string; poItemId: string | null; itemName: string | null; newQuantity: number | null; note: string | null } | null;
    at: string;
  } | null;
  agentReSource?: { orderId: string | null; supplierName: string; orderNumber: string; qty: number; unit: string; existing: boolean } | null;
};

function rel(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "now";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function initials(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
}

// Short one-line preview of a message for the "Replying to" bar.
function msgPreview(m: Msg): string {
  if (m.body && m.body.trim()) return m.body.trim().slice(0, 80);
  if (m.type === "image") return "📷 Photo";
  if (m.type === "document") return "📄 Document";
  return m.type;
}

export default function SupplierChatsPage() {
  const searchParams = useSearchParams();
  // Deep-link support: /inventory/supplier-chats?key=<number> opens that thread
  // (e.g. from Agent QA). Lazy init so it wins over the auto-select-first effect.
  const [selected, setSelected] = useState<string | null>(() => searchParams.get("key"));
  const [filter, setFilter] = useState<
    "all" | "reply" | "topay" | "awaiting" | "auto" | "assist" | "off" | "other" | "need"
  >("need");
  const [query, setQuery] = useState("");
  // Mobile-only: the supplier-context rail renders as a full-screen overlay below `lg`.
  const [mobileRailOpen, setMobileRailOpen] = useState(false);

  // ── List organization (pins + custom segments) ────────────────
  // Client-only, persisted per-browser in localStorage. No backend/schema.
  type Segment = { id: string; name: string; keys: string[] };
  // Start EMPTY on both server + client (no hydration mismatch); the persisted values load from
  // localStorage just after mount (below). This is the fix for pins/segments vanishing on
  // refresh: reading localStorage in the initializer mismatched the empty SSR render, and the
  // persist effect then overwrote storage with that empty state before the real values loaded.
  const [pinnedKeys, setPinnedKeys] = useState<Set<string>>(new Set());
  const [segments, setSegments] = useState<Segment[]>([]);
  // Which custom segment is active (overrides the built-in `filter` while set).
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  // Per-row "…" menu: the open row's key, or null.
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);

  // Load persisted pins + segments once, after mount (client-only).
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem("sc-pinned-keys") || "[]");
      if (Array.isArray(p)) setPinnedKeys(new Set(p as string[]));
    } catch {}
    try {
      const s = JSON.parse(localStorage.getItem("sc-segments") || "[]");
      if (Array.isArray(s)) setSegments(s as Segment[]);
    } catch {}
  }, []);

  // Persist on change — but SKIP the initial mount render, else we'd overwrite storage with the
  // empty initial state before the load effect above runs (the bug that wiped pins on refresh).
  const pinnedReady = useRef(false);
  useEffect(() => {
    if (!pinnedReady.current) {
      pinnedReady.current = true;
      return;
    }
    localStorage.setItem("sc-pinned-keys", JSON.stringify([...pinnedKeys]));
  }, [pinnedKeys]);
  const segmentsReady = useRef(false);
  useEffect(() => {
    if (!segmentsReady.current) {
      segmentsReady.current = true;
      return;
    }
    localStorage.setItem("sc-segments", JSON.stringify(segments));
  }, [segments]);

  function togglePin(key: string) {
    setPinnedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  // Toggle a thread key in/out of a segment (immutable update).
  function toggleSegmentMember(segmentId: string, key: string) {
    setSegments((prev) =>
      prev.map((s) =>
        s.id === segmentId
          ? { ...s, keys: s.keys.includes(key) ? s.keys.filter((k) => k !== key) : [...s.keys, key] }
          : s,
      ),
    );
  }
  // Create a new segment from a prompt; optionally seed it with one thread key.
  function createSegment(seedKey?: string): string | null {
    const name = window.prompt("Segment name")?.trim();
    if (!name) return null;
    const id = crypto.randomUUID();
    setSegments((prev) => [...prev, { id, name, keys: seedKey ? [seedKey] : [] }]);
    return id;
  }
  function deleteSegment(segmentId: string) {
    const seg = segments.find((s) => s.id === segmentId);
    if (!window.confirm(`Delete segment "${seg?.name ?? ""}"?`)) return;
    setSegments((prev) => prev.filter((s) => s.id !== segmentId));
    setActiveSegmentId((cur) => (cur === segmentId ? null : cur));
  }

  // Poll so inbound supplier messages + the agent's auto-replies appear without
  // a manual refresh. The open thread polls faster than the list.
  const { data: threadsData, isLoading, mutate: mutateThreads } = useFetch<{ threads: Thread[]; counts: Counts; needsAttention: number }>(
    "/api/inventory/supplier-chats",
    { refreshInterval: 10000, revalidateOnFocus: true },
  );
  const { data: detail, mutate: mutateDetail } = useFetch<Detail>(
    selected ? `/api/inventory/supplier-chats/${selected}` : null,
    { refreshInterval: 6000, revalidateOnFocus: true },
  );

  // Auto-scroll to the newest message when the thread or its message count
  // changes (so polled-in messages land in view, not below the fold).
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const msgCount = detail?.messages.length ?? 0;
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [selected, msgCount]);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Quoted reply: the message the composer is replying to (clears on send/cancel).
  const [replyingTo, setReplyingTo] = useState<Msg | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // ── New PO panel ──────────────────────────────────────────────
  const [poOpen, setPoOpen] = useState(false);
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([]);
  const [poOutlet, setPoOutlet] = useState("");
  const [poProducts, setPoProducts] = useState<PoProduct[]>([]);
  const [poQty, setPoQty] = useState<Record<string, number>>({});
  const [poBusy, setPoBusy] = useState(false);
  const [poError, setPoError] = useState<string | null>(null);

  async function openPO() {
    if (!detail?.supplierId) return;
    setPoOpen(true);
    setPoError(null);
    setPoQty({});
    try {
      const [oRaw, pRaw] = await Promise.all([
        fetch("/api/settings/outlets?status=ACTIVE").then((r) => r.json()),
        fetch(`/api/inventory/suppliers/${detail.supplierId}/products`).then((r) => r.json()),
      ]);
      const oList: { id: string; name: string }[] = Array.isArray(oRaw) ? oRaw : (oRaw.outlets ?? []);
      setOutlets(oList.map((o) => ({ id: o.id, name: o.name })));
      setPoOutlet((prev) => prev || oList[0]?.id || "");
      setPoProducts(Array.isArray(pRaw) ? pRaw : []);
    } catch {
      setPoError("Couldn't load outlets / products.");
    }
  }

  async function createPO(send: boolean) {
    if (!detail?.supplierId || !poOutlet) {
      setPoError("Pick an outlet first.");
      return;
    }
    const items = poProducts
      .filter((p) => (poQty[p.productId] ?? 0) > 0)
      .map((p) => ({ productId: p.productId, productPackageId: p.productPackageId, quantity: poQty[p.productId], unitPrice: p.price }));
    if (items.length === 0) {
      setPoError("Set a quantity on at least one item.");
      return;
    }
    setPoBusy(true);
    setPoError(null);
    try {
      const cRes = await fetch("/api/inventory/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outletId: poOutlet, supplierId: detail.supplierId, items, clientRequestId: crypto.randomUUID() }),
      });
      if (!cRes.ok) throw new Error((await cRes.json().catch(() => ({}))).error || "Create failed");
      const order = await cRes.json();
      if (send && order.id) {
        const sRes = await fetch(`/api/inventory/orders/${order.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "SENT" }),
        });
        if (!sRes.ok) throw new Error((await sRes.json().catch(() => ({}))).error || "Created, but send failed");
      }
      setPoOpen(false);
      mutateDetail();
    } catch (e) {
      setPoError(e instanceof Error ? e.message : "Failed");
    } finally {
      setPoBusy(false);
    }
  }
  const poTotal = poProducts.reduce((s, p) => s + (poQty[p.productId] ?? 0) * p.price, 0);

  const [modeBusy, setModeBusy] = useState(false);
  async function setMode(mode: AutomationMode) {
    if (!detail?.supplierId || detail.supplier?.automationMode === mode) return;
    setModeBusy(true);
    try {
      const res = await fetch(`/api/inventory/suppliers/${detail.supplierId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ automationMode: mode }),
      });
      if (res.ok) {
        mutateDetail();
        mutateThreads();
      }
    } finally {
      setModeBusy(false);
    }
  }

  // ── Full PO edit (shared EditOrderModal) ──────────────────────
  // The simple PO panel above only adjusts delivery date + status. The
  // "Edit" button opens the same rich modal the Purchase Orders page uses
  // (invoice upload + AI extract, deposit, editable line items). The GET
  // /api/inventory/orders/[id] response is a raw Prisma row, so we adapt
  // it into the modal's Order shape. It doesn't include invoices, so
  // `invoice` is null here — the modal creates one on save as needed.
  const [editOrder, setEditOrder] = useState<EditOrder | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  type RawOrder = {
    id: string;
    orderNumber: string;
    status: string;
    totalAmount: number | string;
    deliveryCharge?: number | string | null;
    notes?: string | null;
    photos?: string[] | null;
    deliveryDate?: string | null;
    sentAt?: string | null;
    approvedAt?: string | null;
    createdAt?: string | null;
    outlet?: { name?: string | null; code?: string | null } | null;
    supplier?: { id?: string | null; name?: string | null; phone?: string | null; depositPercent?: number | null; depositTermsDays?: number | null } | null;
    items?: {
      id: string;
      quantity: number | string;
      unitPrice: number | string;
      totalPrice: number | string;
      notes?: string | null;
      product?: { name?: string | null; sku?: string | null; baseUom?: string | null } | null;
      productPackage?: { packageLabel?: string | null; packageName?: string | null } | null;
    }[] | null;
    invoices?: {
      id: string;
      invoiceNumber: string;
      amount: number | string;
      status: string;
      issueDate?: string | null;
      dueDate?: string | null;
      photos?: string[] | null;
      depositPercent?: number | null;
      depositTermsDays?: number | null;
      depositAmount?: number | string | null;
      depositPaidAt?: string | null;
      deliveryDate?: string | null;
    }[] | null;
  };

  function adaptOrder(o: RawOrder): EditOrder {
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      outlet: o.outlet?.name ?? "",
      outletCode: o.outlet?.code ?? "",
      supplierId: o.supplier?.id ?? "",
      supplier: o.supplier?.name ?? "Unknown",
      supplierPhone: o.supplier?.phone ?? "",
      status: o.status,
      totalAmount: Number(o.totalAmount),
      notes: o.notes ?? null,
      photos: o.photos ?? [],
      deliveryDate: o.deliveryDate ? String(o.deliveryDate).slice(0, 10) : null,
      deliveryCharge: Number(o.deliveryCharge ?? 0),
      createdBy: "",
      approvedBy: null,
      approvedAt: o.approvedAt ? String(o.approvedAt) : null,
      sentAt: o.sentAt ? String(o.sentAt) : null,
      createdAt: o.createdAt ? String(o.createdAt) : "",
      items: (o.items ?? []).map((i) => ({
        id: i.id,
        product: i.product?.name ?? "item",
        sku: i.product?.sku ?? "",
        uom: i.productPackage?.packageLabel ?? i.product?.baseUom ?? "",
        package: i.productPackage?.packageLabel ?? i.productPackage?.packageName ?? "",
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        totalPrice: Number(i.totalPrice),
        notes: i.notes ?? null,
      })),
      receivingCount: 0,
      invoice:
        o.invoices && o.invoices[0]
          ? {
              id: o.invoices[0].id,
              invoiceNumber: o.invoices[0].invoiceNumber,
              amount: Number(o.invoices[0].amount),
              status: o.invoices[0].status,
              issueDate: o.invoices[0].issueDate ? String(o.invoices[0].issueDate).slice(0, 10) : "",
              dueDate: o.invoices[0].dueDate ? String(o.invoices[0].dueDate).slice(0, 10) : null,
              photoCount: o.invoices[0].photos?.length ?? 0,
              photos: o.invoices[0].photos ?? [],
              depositPercent: o.invoices[0].depositPercent ?? null,
              depositTermsDays: o.invoices[0].depositTermsDays ?? null,
              depositAmount: o.invoices[0].depositAmount != null ? Number(o.invoices[0].depositAmount) : null,
              depositPaidAt: o.invoices[0].depositPaidAt ? String(o.invoices[0].depositPaidAt) : null,
              deliveryDate: o.invoices[0].deliveryDate ? String(o.invoices[0].deliveryDate).slice(0, 10) : null,
            }
          : null,
      supplierDepositPercent: o.supplier?.depositPercent ?? null,
      supplierDepositTermsDays: o.supplier?.depositTermsDays ?? null,
    };
  }

  async function openEditOrder(id: string) {
    setEditLoading(true);
    setEditError(null);
    try {
      const r = await fetch(`/api/inventory/orders/${id}`);
      if (!r.ok) {
        setEditError("Couldn't load this PO for editing.");
        return;
      }
      const raw = (await r.json()) as RawOrder;
      setEditOrder(adaptOrder(raw));
    } catch {
      setEditError("Couldn't load this PO for editing.");
    } finally {
      setEditLoading(false);
    }
  }

  // ── Need ordering (suggested draft POs) ───────────────────────
  const [needCreated, setNeedCreated] = useState<Set<string>>(new Set());
  const [needCreatingKey, setNeedCreatingKey] = useState<string | null>(null);
  // Loaded on mount so the "Need ordering" filter chip + the per-supplier rail card
  // both have the data (the modal reads it too).
  const { data: needData, mutate: mutateNeed } = useFetch<{ groups: NeedGroup[] }>(
    "/api/inventory/reorder-suggestions",
    { revalidateOnFocus: true },
  );
  const needGroups: NeedGroup[] | null = needData?.groups ?? null;
  const needSupplierIds = new Set((needGroups ?? []).map((g) => g.supplierId));
  // Land on "Need ordering" by default (what to order today), and STAY there while there's
  // something to order. Once the list drains (you created the last draft) — or there was
  // nothing on load — fall back to All, so we never sit on the now-hidden "need" chip with
  // an empty list. Only ever falls back; never yanks you onto "need".
  useEffect(() => {
    if (needData && filter === "need" && needSupplierIds.size === 0) setFilter("all");
  }, [needData, needSupplierIds.size, filter]);

  async function createDraftFromGroup(g: NeedGroup) {
    const key = `${g.supplierId}_${g.outletId}`;
    setNeedCreatingKey(key);
    try {
      const r = await fetch("/api/inventory/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outletId: g.outletId,
          supplierId: g.supplierId,
          notes: "Suggested reorder (below par)",
          items: g.items.map((i) => ({ productId: i.productId, productPackageId: i.productPackageId, quantity: i.qty, unitPrice: i.unitPrice })),
          clientRequestId: crypto.randomUUID(),
        }),
      });
      if (r.ok) {
        setNeedCreated((prev) => new Set(prev).add(key));
        mutateDetail();
        mutateThreads();
        mutateNeed();
      }
    } finally {
      setNeedCreatingKey(null);
    }
  }

  const threads = threadsData?.threads ?? [];
  const counts = threadsData?.counts;
  const q = query.trim().toLowerCase();
  // When a custom segment is active it overrides the built-in `filter` (search still applies).
  const activeSegment = activeSegmentId ? segments.find((s) => s.id === activeSegmentId) ?? null : null;
  const filtered = threads.filter((t) => {
    if (q && !(t.name.toLowerCase().includes(q) || t.phone.includes(q) || t.preview.toLowerCase().includes(q))) {
      return false;
    }
    if (activeSegment) {
      return activeSegment.keys.includes(t.key);
    }
    switch (filter) {
      case "reply":
        return t.awaitingReply;
      case "topay":
        return t.toPay;
      case "awaiting":
        return t.awaitingDelivery;
      case "auto":
        return t.automationMode === "AUTO";
      case "assist":
        return t.automationMode === "ASSIST";
      case "off":
        return t.registered && t.automationMode === "OFF";
      case "other":
        return !t.registered;
      case "need":
        return !!t.supplierId && needSupplierIds.has(t.supplierId);
      default:
        return t.registered; // "all" = every supplier (non-suppliers live under "Other")
    }
  });
  // Pinned threads float to the top. Stable sort preserves the existing relative
  // order within the pinned and unpinned groups.
  const shown = [...filtered].sort((a, b) => {
    const ap = pinnedKeys.has(a.key) ? 0 : 1;
    const bp = pinnedKeys.has(b.key) ? 0 : 1;
    return ap - bp;
  });

  // Default landing = the Need-ordering list ("what to order today"), NOT an auto-opened
  // thread. Only a ?key= deep-link selects a thread on load; otherwise the conversation pane
  // stays on "Select a chat" until you pick one.

  useEffect(() => {
    setDraft("");
    setSendError(null);
    setApplyError(null);
    setReplyingTo(null);
    // Mobile: collapse the rail overlay when switching threads.
    setMobileRailOpen(false);
    // Close the New PO composer on thread switch — its products/qty/outlet belong to the
    // supplier it was opened for; leaving it open showed the previous supplier's items.
    setPoOpen(false);
    setPoProducts([]);
    setPoQty({});
    setPoError(null);
  }, [selected]);

  async function send() {
    if (!selected || !draft.trim() || sending) return;
    setSending(true);
    setSendError(null);
    // Prefer the Meta message id (so WhatsApp threads the quote); fall back to
    // our DB row id, which the send route resolves to the Meta id server-side.
    const replyTo = replyingTo ? replyingTo.waMessageId ?? replyingTo.id : undefined;
    try {
      const res = await fetch(`/api/inventory/supplier-chats/${selected}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft.trim(), ...(replyTo ? { replyTo } : {}) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSendError(json.error ?? "Send failed");
        return;
      }
      setDraft("");
      setReplyingTo(null);
      mutateDetail();
    } catch {
      setSendError("Network error");
    } finally {
      setSending(false);
    }
  }

  // Apply the agent's held proposal to the PO (remove_item / reduce_qty only).
  async function applyProposal() {
    const p = detail?.agentProposal;
    if (!selected || applying || !p?.poAction?.poItemId || !p.orderId) return;
    setApplying(true);
    setApplyError(null);
    try {
      const res = await fetch(`/api/inventory/supplier-chats/${selected}/apply-proposal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId: p.messageId,
          orderId: p.orderId,
          poItemId: p.poAction.poItemId,
          action: p.poAction.type,
          newQuantity: p.poAction.newQuantity,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setApplyError(json.error ?? "Apply failed");
        return;
      }
      mutateDetail();
    } catch {
      setApplyError("Network error");
    } finally {
      setApplying(false);
    }
  }

  // Clear the "Agent suggests" banner once you've handled it your own way (paid the
  // invoice, replied yourself, no PO change) — the resolution for escalations that have
  // no auto-appliable PO action, so the banner isn't a dead-end redirect.
  async function dismissProposal() {
    const p = detail?.agentProposal;
    if (!selected || applying || !p?.messageId) return;
    setApplying(true);
    setApplyError(null);
    try {
      const res = await fetch(`/api/inventory/supplier-chats/${selected}/apply-proposal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: p.messageId, action: "dismiss" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setApplyError(json.error ?? "Failed");
        return;
      }
      mutateDetail();
    } catch {
      setApplyError("Network error");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="flex h-[calc(100dvh-64px)] gap-3 p-3 text-foreground lg:min-h-[560px]">
      {/* ── Thread list ─────────────────────────────── */}
      <div className={`${selected ? "hidden lg:flex" : "flex"} w-full lg:w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm`}>
        <div className="border-b border-border p-3">
          <div className="flex items-center justify-between gap-2 text-sm font-medium">
            <span className="flex items-center gap-2">
              <MessageCircle size={16} /> Suppliers
            </span>
          </div>
          <div className="relative mt-2">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or number…"
              className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground"
            />
          </div>
          {/* Action tabs in workflow order (order → reply → pay → receive). Each shows
              only when it has items (or is the active filter). Automation config lives in
              the Mode dropdown so it doesn't clutter the daily view. */}
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {(needSupplierIds.size > 0 || filter === "need") && (
              <button
                onClick={() => { setActiveSegmentId(null); setFilter("need"); }}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${!activeSegment && filter === "need" ? "bg-amber-500/20 text-amber-800 dark:text-amber-300" : "bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-400"}`}
              >
                <ShoppingCart size={11} /> Need ordering {needSupplierIds.size}
              </button>
            )}
            {(filter === "reply" || (counts?.needsReply ?? 0) > 0) && (
              <Chip on={!activeSegment && filter === "reply"} tone="danger" onClick={() => { setActiveSegmentId(null); setFilter("reply"); }}>
                Needs reply {counts?.needsReply ?? 0}
              </Chip>
            )}
            {(filter === "topay" || (counts?.toPay ?? 0) > 0) && (
              <Chip on={!activeSegment && filter === "topay"} onClick={() => { setActiveSegmentId(null); setFilter("topay"); }}>To pay {counts?.toPay ?? 0}</Chip>
            )}
            {(filter === "awaiting" || (counts?.awaitingDelivery ?? 0) > 0) && (
              <Chip on={!activeSegment && filter === "awaiting"} onClick={() => { setActiveSegmentId(null); setFilter("awaiting"); }}>
                Awaiting delivery {counts?.awaitingDelivery ?? 0}
              </Chip>
            )}
            <Chip on={!activeSegment && filter === "all"} onClick={() => { setActiveSegmentId(null); setFilter("all"); }}>All {counts?.suppliers ?? 0}</Chip>
            <select
              value={!activeSegment && (["auto", "assist", "off", "other"] as string[]).includes(filter) ? filter : ""}
              onChange={(e) => { if (e.target.value) { setActiveSegmentId(null); setFilter(e.target.value as "auto" | "assist" | "off" | "other"); } }}
              title="Filter by automation mode"
              className={`rounded-full border px-2 py-[3px] text-[11px] ${!activeSegment && (["auto", "assist", "off", "other"] as string[]).includes(filter) ? "border-primary/40 bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground"}`}
            >
              <option value="">Mode</option>
              <option value="auto">Auto {counts?.auto ?? 0}</option>
              <option value="assist">Assist {counts?.assist ?? 0}</option>
              <option value="off">Off {counts?.off ?? 0}</option>
              {(counts?.other ?? 0) > 0 && <option value="other">Other {counts?.other ?? 0}</option>}
            </select>
            {/* ── Custom segments ── render after the built-in chips, same wrap row. */}
            {segments.map((seg) => {
              const on = activeSegmentId === seg.id;
              return (
                <span
                  key={seg.id}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] ${on ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted"}`}
                >
                  <button onClick={() => setActiveSegmentId(seg.id)} className="inline-flex items-center gap-1">
                    {seg.name} {seg.keys.length}
                  </button>
                  {on && (
                    <button
                      onClick={() => deleteSegment(seg.id)}
                      aria-label="Delete segment"
                      title="Delete segment"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <X size={11} />
                    </button>
                  )}
                </span>
              );
            })}
            <button
              onClick={() => { const id = createSegment(); if (id) setActiveSegmentId(id); }}
              title="New segment"
              className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
            >
              <Plus size={11} /> Segment
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center p-6 text-muted-foreground">
              <Loader2 size={18} className="animate-spin" />
            </div>
          )}
          {!isLoading && shown.length === 0 && (
            <p className="p-4 text-xs text-muted-foreground">No suppliers match this filter.</p>
          )}
          {shown.map((t) => {
            const isPinned = pinnedKeys.has(t.key);
            return (
            <div
              key={t.key}
              role="button"
              tabIndex={0}
              onClick={() => setSelected(t.key)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(t.key); } }}
              className={`group relative flex w-full cursor-pointer gap-2.5 border-b border-border p-2.5 text-left ${selected === t.key ? "bg-muted" : "hover:bg-muted/50"}`}
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-medium text-primary">
                {initials(t.name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
                    {isPinned && <Pin size={11} className="shrink-0 fill-primary text-primary" />}
                    {t.registered && t.automationMode && <ModeDot mode={t.automationMode} />}
                    <span className="truncate">{t.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span className="text-[11px] text-muted-foreground group-hover:hidden">{t.lastAt ? rel(t.lastAt) : ""}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setOpenMenuKey((k) => (k === t.key ? null : t.key)); }}
                      aria-label="Organize chat"
                      title="Pin / add to segment"
                      className="hidden rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground group-hover:inline-flex"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  {t.needsAttention && <AlertCircle size={11} className="shrink-0 text-destructive" />}
                  <span className="truncate">{t.hasMessages ? t.preview : "No messages yet"}</span>
                </div>
              </div>
              {openMenuKey === t.key && (
                <>
                  {/* Backdrop dismiss */}
                  <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setOpenMenuKey(null); }} />
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-2 top-9 z-20 w-52 rounded-md border border-border bg-popover p-1 text-[12px] text-popover-foreground shadow-lg"
                  >
                    <button
                      onClick={() => { togglePin(t.key); setOpenMenuKey(null); }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
                    >
                      <Pin size={12} className={isPinned ? "fill-primary text-primary" : ""} />
                      {isPinned ? "Unpin" : "Pin to top"}
                    </button>
                    <div className="my-1 border-t border-border" />
                    <div className="px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                      Add to segment
                    </div>
                    {segments.length === 0 && (
                      <div className="px-2 py-1 text-[11px] text-muted-foreground">No segments yet.</div>
                    )}
                    {segments.map((seg) => {
                      const member = seg.keys.includes(t.key);
                      return (
                        <button
                          key={seg.id}
                          onClick={() => toggleSegmentMember(seg.id, t.key)}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
                        >
                          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-border">
                            {member && <Check size={11} className="text-primary" />}
                          </span>
                          <span className="truncate">{seg.name}</span>
                        </button>
                      );
                    })}
                    <button
                      onClick={() => { createSegment(t.key); setOpenMenuKey(null); }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-muted-foreground hover:bg-muted"
                    >
                      <Plus size={12} /> New segment…
                    </button>
                  </div>
                </>
              )}
            </div>
            );
          })}
        </div>
      </div>

      {/* ── Conversation ────────────────────────────── */}
      <div className={`${selected ? "flex" : "hidden lg:flex"} w-full min-w-0 lg:flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm`}>
        {!detail ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a chat
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  onClick={() => setSelected(null)}
                  aria-label="Back to list"
                  title="Back"
                  className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
                >
                  <ChevronLeft size={18} />
                </button>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{detail.supplier?.name ?? `+${detail.key}`}</div>
                  <div className="text-xs text-muted-foreground">+{detail.key}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] text-green-600 dark:text-green-400">
                  WhatsApp
                </span>
                <button
                  onClick={() => setMobileRailOpen(true)}
                  aria-label="Supplier details"
                  title="Supplier details"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
                >
                  <Info size={16} />
                </button>
              </div>
            </div>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
              {detail.messages.length === 0 && (
                <p className="m-auto text-xs text-muted-foreground">No messages in this thread yet.</p>
              )}
              {detail.messages.map((m) => (
                <div
                  key={m.id}
                  className={`group flex items-center gap-1.5 ${
                    m.direction === "outbound" ? "flex-row-reverse self-end" : "self-start"
                  } max-w-[80%]`}
                >
                  <div
                    onDoubleClick={() => setReplyingTo(m)}
                    title="Double-click to reply"
                    className={`min-w-0 cursor-default select-none rounded-lg px-3 py-2 text-[13px] leading-snug ${
                      m.direction === "outbound"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    }`}
                  >
                    {m.type === "image" && m.mediaUrl ? (
                      <a href={m.mediaUrl} target="_blank" rel="noopener noreferrer" className="block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={m.mediaUrl}
                          alt={m.body ?? "Photo"}
                          className="max-h-[180px] max-w-full rounded-md object-cover"
                        />
                        {m.body && <div className="mt-1">{m.body}</div>}
                      </a>
                    ) : m.type === "document" && m.mediaUrl ? (
                      <a
                        href={m.mediaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                      >
                        <FileText size={13} /> {m.body || "Document"}
                      </a>
                    ) : (
                      m.body ?? (
                        <span className="inline-flex items-center gap-1">
                          <FileText size={13} /> {m.type}
                        </span>
                      )
                    )}
                    <div
                      className={`mt-1 text-[10px] ${m.direction === "outbound" ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                    >
                      {clock(m.timestamp)}
                    </div>
                  </div>
                  <button
                    onClick={() => setReplyingTo(m)}
                    aria-label="Reply"
                    title="Reply"
                    className="shrink-0 rounded-full p-1 text-muted-foreground opacity-50 transition-opacity hover:bg-muted hover:text-foreground hover:opacity-100"
                  >
                    <Reply size={13} />
                  </button>
                </div>
              ))}
              {/* Agent's ASSIST suggestion — inline at the bottom of the thread, in the
                  conversation flow, instead of off in the side panel. */}
              {detail.agentProposal && (
                <div className="pt-1">
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
                    <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                      <AlertCircle size={12} /> Agent suggests — your call
                    </div>
                    {detail.agentProposal.insight && (
                      <div className="mb-1.5 text-[12px] leading-snug text-foreground">
                        {detail.agentProposal.insight}
                      </div>
                    )}
                    <div className="text-[12px] text-foreground">
                      {detail.agentProposal.poAction ? (
                        <>
                          {detail.agentProposal.poAction.type === "substitute_item" && "Substitution offered"}
                          {detail.agentProposal.poAction.type === "cancel_order" && "Cancel requested"}
                          {detail.agentProposal.poAction.type === "remove_item" && "Remove line"}
                          {detail.agentProposal.poAction.type === "reduce_qty" && "Reduce qty"}
                          {detail.agentProposal.poAction.itemName && <> · <span className="font-medium">{detail.agentProposal.poAction.itemName}</span></>}
                          {detail.agentProposal.poAction.newQuantity != null && <> → {detail.agentProposal.poAction.newQuantity}</>}
                          {detail.agentProposal.poAction.note && <div className="mt-0.5 text-[11px] text-muted-foreground">“{detail.agentProposal.poAction.note}”</div>}
                        </>
                      ) : (
                        <span className="capitalize">{detail.agentProposal.intent.replace(/_/g, " ")}</span>
                      )}
                    </div>
                    <div className="mt-1 text-[10.5px] text-muted-foreground">
                      Held for review: {detail.agentProposal.escalationReason}. The agent did not change the PO.
                    </div>
                    {(() => {
                      const pa = detail.agentProposal.poAction;
                      const canApply =
                        !!pa?.poItemId &&
                        !!detail.agentProposal.orderId &&
                        (pa.type === "remove_item" || pa.type === "reduce_qty");
                      return (
                        <div className="mt-2 flex items-center gap-2">
                          {canApply && (
                            <button
                              onClick={applyProposal}
                              disabled={applying}
                              className="inline-flex items-center gap-1 rounded bg-amber-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                            >
                              {applying ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                              {pa?.type === "remove_item" ? "Apply: remove line" : "Apply: reduce qty"}
                            </button>
                          )}
                          {detail.agentProposal.orderId && (
                            <button
                              onClick={() => detail.agentProposal?.orderId && openEditOrder(detail.agentProposal.orderId)}
                              disabled={editLoading}
                              className="inline-flex items-center gap-1 rounded border border-amber-300 px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/40"
                            >
                              Open PO {editLoading ? <Loader2 size={11} className="animate-spin" /> : <ExternalLink size={11} />}
                            </button>
                          )}
                          <button
                            onClick={dismissProposal}
                            disabled={applying}
                            title="Clear this suggestion once you've handled it"
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                          >
                            <Check size={11} /> Mark handled
                          </button>
                        </div>
                      );
                    })()}
                    {applyError && <div className="mt-1 text-[10.5px] text-destructive">{applyError}</div>}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="border-t border-border px-4 py-2.5">
              {detail.humanHandling && (
                <div className="mb-2 flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                  <Hand size={13} className="shrink-0" />
                  You&apos;re handling this chat — AI paused here. It resumes once you go quiet.
                </div>
              )}
              {replyingTo && (
                <div className="mb-2 flex items-center gap-2 rounded-md border-l-2 border-primary bg-muted px-2.5 py-1.5 text-[11px]">
                  <Reply size={12} className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    Replying to: {msgPreview(replyingTo)}
                  </span>
                  <button
                    onClick={() => setReplyingTo(null)}
                    aria-label="Cancel reply"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") send();
                  }}
                  disabled={!detail.windowOpen || sending}
                  placeholder={
                    detail.windowOpen ? "Type a reply…" : "Window closed — free text not allowed (template only)"
                  }
                  className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground disabled:opacity-50"
                />
                <button
                  onClick={send}
                  disabled={!detail.windowOpen || sending || !draft.trim()}
                  aria-label="Send"
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground hover:bg-muted disabled:opacity-40"
                >
                  {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                <Clock
                  size={12}
                  className={detail.windowOpen ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}
                />
                <span className="text-muted-foreground">
                  {detail.windowOpen ? "24h window open — free reply" : "24h window closed — template only"}
                </span>
                {sendError && <span className="ml-auto text-destructive">{sendError}</span>}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Supplier context ────────────────────────── */}
      <div
        className={`${mobileRailOpen ? "flex" : "hidden"} fixed inset-0 z-40 flex-col overflow-y-auto bg-background p-3 lg:static lg:z-auto lg:inset-auto lg:flex lg:w-96 lg:shrink-0 lg:overflow-y-auto lg:rounded-xl lg:border lg:border-border lg:bg-background lg:p-3 lg:shadow-sm`}
      >
        {/* Mobile-only close row for the overlay. */}
        <div className="mb-2 flex justify-end lg:hidden">
          <button
            onClick={() => setMobileRailOpen(false)}
            aria-label="Close details"
            title="Close"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>
        {!detail ? null : (
          <>
            <div className="flex flex-col items-center gap-1.5 border-b border-border pb-3 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                {initials(detail.supplier?.name ?? detail.key)}
              </div>
              <div className="text-[13px] font-medium">{detail.supplier?.name ?? `+${detail.key}`}</div>
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Phone size={11} /> +{detail.key}
              </div>
            </div>

            {detail.supplierId ? (
              poOpen ? (
                <div>
                  <div className="flex items-center justify-between border-b border-border pb-2 pt-1">
                    <span className="text-[12px] font-medium">New PO</span>
                    <button onClick={() => !poBusy && setPoOpen(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 border-b border-border py-2">
                    <span className="text-[11px] text-muted-foreground">Outlet</span>
                    <select
                      value={poOutlet}
                      onChange={(e) => setPoOutlet(e.target.value)}
                      className="h-7 flex-1 rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground"
                    >
                      {outlets.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="py-1">
                    {poProducts.length === 0 ? (
                      <p className="py-6 text-center text-[11px] text-muted-foreground">
                        No price-list products for this supplier yet.{" "}
                        <a href="/inventory/suppliers" className="font-medium text-primary hover:underline">
                          Add them on the supplier record
                        </a>{" "}
                        first.
                      </p>
                    ) : (
                      poProducts.map((p) => (
                        <div key={p.productId} className="flex items-center gap-2 border-b border-border py-1.5">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12px]">{p.name}</div>
                            <div className="text-[10.5px] text-muted-foreground">
                              {formatRM(p.price)} / {p.packageLabel}
                              {p.moq ? ` · MOQ ${p.moq}` : ""}
                            </div>
                          </div>
                          <input
                            type="number"
                            min={0}
                            value={poQty[p.productId] ?? ""}
                            onChange={(e) =>
                              setPoQty((q) => ({ ...q, [p.productId]: Math.max(0, Number(e.target.value) || 0) }))
                            }
                            placeholder="0"
                            className="h-7 w-14 rounded-md border border-border bg-background px-1.5 text-right text-[12px] text-foreground"
                          />
                        </div>
                      ))
                    )}
                  </div>
                  <div className="sticky bottom-0 -mx-3 border-t border-border bg-background px-3 pb-1 pt-2">
                    {poError && <div className="mb-1.5 text-[10.5px] text-destructive">{poError}</div>}
                    <div className="mb-1.5 flex justify-between text-[12px]">
                      <span className="text-muted-foreground">Total</span>
                      <span className="font-medium">{formatRM(poTotal)}</span>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => createPO(false)}
                        disabled={poBusy}
                        className="flex-1 rounded-md border border-border px-2 py-1.5 text-[12px] font-medium hover:bg-muted disabled:opacity-50"
                      >
                        Create draft
                      </button>
                      <button
                        onClick={() => createPO(true)}
                        disabled={poBusy || !detail.windowOpen}
                        title={detail.windowOpen ? "" : "24h window closed — create a draft, then send via template"}
                        className="flex flex-1 items-center justify-center gap-1 rounded-md bg-primary px-2 py-1.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        {poBusy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Create &amp; send
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
              <>
                <div className="border-b border-border py-3">
                  <button
                    onClick={openPO}
                    className="flex w-full items-center justify-center gap-1 rounded-md bg-primary px-3 py-2 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <Plus size={13} /> New PO
                  </button>
                </div>
                <div className="border-b border-border py-3">
                  <div className="mb-1.5 text-[11px] text-muted-foreground">Automation</div>
                  <div className="flex rounded-md border border-border p-0.5">
                    {(["OFF", "ASSIST", "AUTO"] as AutomationMode[]).map((m) => {
                      const on = detail.supplier?.automationMode === m;
                      const tone =
                        m === "AUTO"
                          ? "bg-green-500/15 text-green-700 dark:text-green-400"
                          : m === "ASSIST"
                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                            : "bg-muted text-foreground";
                      return (
                        <button
                          key={m}
                          onClick={() => setMode(m)}
                          disabled={modeBusy}
                          className={`flex-1 rounded px-1.5 py-1 text-[11px] font-medium capitalize disabled:opacity-50 ${on ? tone : "text-muted-foreground hover:bg-muted/60"}`}
                        >
                          {m.toLowerCase()}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-1 text-[10.5px] text-muted-foreground">
                    {detail.supplier?.automationMode === "AUTO"
                      ? "Agent acts + sends automatically."
                      : detail.supplier?.automationMode === "ASSIST"
                        ? "Agent drafts — you approve before it sends."
                        : "Manual — agent won't act on this supplier."}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 border-b border-border py-3">
                  <div className="rounded-md bg-muted px-2.5 py-1.5">
                    <div className="text-[11px] text-muted-foreground">Open POs</div>
                    <div className="text-[15px] font-medium">{detail.context.openPOs}</div>
                  </div>
                  <a
                    href={`/inventory/invoices?supplier=${detail.supplierId ?? ""}&cardFilter=payable`}
                    className="block rounded-md bg-muted px-2.5 py-1.5 transition hover:bg-muted/70"
                  >
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>Unpaid</span>
                      <ExternalLink size={11} className="opacity-50" />
                    </div>
                    <div className="text-[15px] font-medium">{formatRM(detail.context.unpaidTotal)}</div>
                  </a>
                  {detail.context.overdueTotal > 0 && (
                    <div className="rounded-md bg-destructive/10 px-2.5 py-1.5">
                      <div className="text-[11px] text-destructive">Overdue</div>
                      <div className="text-[15px] font-medium text-destructive">
                        {formatRM(detail.context.overdueTotal)}
                      </div>
                    </div>
                  )}
                </div>
                {detail.context.unpaidInvoices.length > 0 && (
                  <div className="border-b border-border py-3">
                    <div className="mb-1.5 text-[11px] text-muted-foreground">Unpaid invoices</div>
                    {detail.context.unpaidInvoices.map((inv) => (
                      <a
                        key={inv.id}
                        href={`/inventory/invoices?supplier=${detail.supplierId ?? ""}&cardFilter=payable&search=${encodeURIComponent(inv.invoiceNumber)}`}
                        className="flex items-center justify-between gap-2 rounded px-1 py-1 text-[11px] hover:bg-muted"
                      >
                        <span className="truncate font-medium text-primary">{inv.invoiceNumber}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {inv.overdue && (
                            <span className="rounded bg-destructive/10 px-1 text-[9.5px] font-medium text-destructive">overdue</span>
                          )}
                          <span className="text-muted-foreground">{formatRM(inv.balance)}</span>
                        </span>
                      </a>
                    ))}
                  </div>
                )}
                {(() => {
                  const myNeed = (needGroups ?? []).filter((g) => g.supplierId === detail.supplierId);
                  if (myNeed.length === 0) return null;
                  return (
                    <div className="border-b border-border py-3">
                      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                        <ShoppingCart size={12} /> Need ordering
                      </div>
                      {myNeed.map((g) => {
                        const key = `${g.supplierId}_${g.outletId}`;
                        const done = needCreated.has(key);
                        return (
                          <div key={key} className="mb-2 rounded-md border border-amber-200 bg-amber-50/50 p-2 dark:border-amber-900 dark:bg-amber-950/30">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="truncate text-[10.5px] text-muted-foreground">
                                {g.outletName} · {g.itemCount} item{g.itemCount > 1 ? "s" : ""} · {formatRM(g.total)}
                              </span>
                              {done ? (
                                <span className="shrink-0 text-[10px] font-medium text-green-600 dark:text-green-400">✓ draft</span>
                              ) : (
                                <button
                                  onClick={() => createDraftFromGroup(g)}
                                  disabled={needCreatingKey === key}
                                  className="shrink-0 rounded bg-amber-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                                >
                                  {needCreatingKey === key ? "…" : "Create draft"}
                                </button>
                              )}
                            </div>
                            {g.items.map((it) => (
                              <div key={it.productId} className="flex items-center justify-between gap-2 text-[10.5px]">
                                <span className="truncate">{it.name}</span>
                                <span className="shrink-0 text-muted-foreground">order {it.qty} {it.packageLabel}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                {detail.agentReSource && (
                  <div className="border-b border-border py-3">
                    <div className="rounded-md border border-sky-300 bg-sky-50 p-2.5 dark:border-sky-800 dark:bg-sky-950/40">
                      <div className="mb-1 text-[11px] font-semibold text-sky-700 dark:text-sky-300">
                        Re-sourced (OOS)
                      </div>
                      <div className="text-[12px] text-foreground">
                        Draft PO <span className="font-medium">{detail.agentReSource.orderNumber}</span> to{" "}
                        <span className="font-medium">{detail.agentReSource.supplierName}</span> · {detail.agentReSource.qty} {detail.agentReSource.unit}
                      </div>
                      <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                        {detail.agentReSource.existing ? "Already pending — review & send." : "Review & send in Purchase Orders. Not visible to this supplier."}
                      </div>
                      {detail.agentReSource.orderId && (
                        <div className="mt-2">
                          <a
                            href={`/inventory/orders/${detail.agentReSource.orderId}`}
                            className="inline-flex items-center gap-1 rounded bg-sky-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-sky-700"
                          >
                            Open draft PO <ExternalLink size={11} />
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div className="flex flex-col gap-1 border-b border-border py-3 text-[12px]">
                  <Row label="Delivery" value={detail.supplier?.deliveryDays?.join(", ") || "—"} />
                  <Row label="Lead time" value={`${detail.supplier?.leadTimeDays ?? 0}d`} />
                  <Row label="Terms" value={detail.supplier?.paymentTerms || "—"} />
                  {detail.supplier?.paymentModel && (
                    <Row
                      label="Payment"
                      value={
                        detail.supplier.paymentModel.label +
                        (detail.supplier.paymentModel.popDeliveryCritical ? " ⚡" : "")
                      }
                    />
                  )}
                </div>
                <div className="pt-3">
                  <div className="mb-1.5 text-[11px] text-muted-foreground">Open purchase orders</div>
                  {editError && <p className="mb-1 text-[11px] text-destructive">{editError}</p>}
                  {detail.context.recentPOs.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">None open.</p>
                  )}
                  {detail.context.recentPOs.map((po) => (
                    <button
                      key={po.id}
                      onClick={() => openEditOrder(po.id)}
                      className="flex w-full items-center justify-between rounded px-1 py-1 text-left text-[11px] hover:bg-muted"
                    >
                      <span className="font-medium text-primary">{po.orderNumber}</span>
                      <span className="text-muted-foreground">{po.status.replace(/_/g, " ").toLowerCase()}</span>
                    </button>
                  ))}
                </div>
              </>
              )
            ) : (
              <p className="py-4 text-[11px] text-muted-foreground">
                Not linked to a supplier yet — no procurement context. Match this number on the supplier record to see open POs and balances.
              </p>
            )}
          </>
        )}
      </div>

      {/* Full PO edit — shared modal (same one the Purchase Orders page uses) */}
      <EditOrderModal
        order={editOrder}
        onClose={() => setEditOrder(null)}
        onSaved={() => { mutateDetail(); mutateThreads(); }}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function Chip({
  on,
  tone,
  onClick,
  children,
}: {
  on: boolean;
  tone?: "danger" | "auto" | "assist";
  onClick: () => void;
  children: ReactNode;
}) {
  const active =
    tone === "danger"
      ? "bg-destructive/10 text-destructive"
      : tone === "auto"
        ? "bg-green-500/15 text-green-700 dark:text-green-400"
        : tone === "assist"
          ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
          : "bg-muted text-foreground";
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-0.5 text-[11px] ${on ? active : "text-muted-foreground hover:bg-muted"}`}
    >
      {children}
    </button>
  );
}

function ModeDot({ mode }: { mode: AutomationMode }) {
  const c = mode === "AUTO" ? "bg-green-500" : mode === "ASSIST" ? "bg-amber-500" : "bg-muted-foreground/40";
  return <span title={`Automation: ${mode}`} className={`inline-block h-2 w-2 shrink-0 rounded-full ${c}`} />;
}
