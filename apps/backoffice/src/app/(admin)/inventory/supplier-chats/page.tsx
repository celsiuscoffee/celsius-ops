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
  Pencil,
  X,
  Hand,
  ShoppingCart,
  Reply,
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
type PoView = {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number | string;
  deliveryDate: string | null;
  outlet?: { name: string } | null;
  items: { id: string; quantity: number | string; unitPrice: number | string; product?: { name: string } | null }[];
};
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
  };
  windowOpen: boolean;
  humanHandling: boolean;
  messages: Msg[];
  agentProposal?: {
    messageId: string;
    orderId: string | null;
    intent: string;
    escalationReason: string;
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

  // ── PO management panel ───────────────────────────────────────
  const [poViewId, setPoViewId] = useState<string | null>(null);
  const [poView, setPoView] = useState<PoView | null>(null);
  const [poViewBusy, setPoViewBusy] = useState(false);
  const [poViewError, setPoViewError] = useState<string | null>(null);
  const [poDate, setPoDate] = useState("");

  async function fetchPo(id: string): Promise<PoView | null> {
    const r = await fetch(`/api/inventory/orders/${id}`);
    return r.ok ? r.json() : null;
  }
  async function openPoView(id: string) {
    setPoViewId(id);
    setPoView(null);
    setPoViewError(null);
    const po = await fetchPo(id);
    if (po) {
      setPoView(po);
      setPoDate(po.deliveryDate ? String(po.deliveryDate).slice(0, 10) : "");
    } else setPoViewError("Couldn't load this PO.");
  }
  async function poPatch(body: Record<string, unknown>) {
    if (!poViewId) return;
    setPoViewBusy(true);
    setPoViewError(null);
    try {
      const r = await fetch(`/api/inventory/orders/${poViewId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Action failed");
      const po = await fetchPo(poViewId);
      if (po) {
        setPoView(po);
        setPoDate(po.deliveryDate ? String(po.deliveryDate).slice(0, 10) : "");
      }
      mutateDetail();
    } catch (e) {
      setPoViewError(e instanceof Error ? e.message : "Failed");
    } finally {
      setPoViewBusy(false);
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
    try {
      const r = await fetch(`/api/inventory/orders/${id}`);
      if (!r.ok) {
        setPoViewError("Couldn't load this PO for editing.");
        return;
      }
      const raw = (await r.json()) as RawOrder;
      setEditOrder(adaptOrder(raw));
    } catch {
      setPoViewError("Couldn't load this PO for editing.");
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
  // Land on "Need ordering" by default (what to order today). Once the reorder data
  // loads, if nothing is below reorder point, fall back to All so we never sit on an
  // empty view. One-shot — never overrides a manual filter pick afterwards.
  const didDefaultFilter = useRef(false);
  useEffect(() => {
    if (didDefaultFilter.current || !needData) return;
    didDefaultFilter.current = true;
    if (needSupplierIds.size === 0) setFilter("all");
  }, [needData, needSupplierIds.size]);

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
  const shown = threads.filter((t) => {
    if (q && !(t.name.toLowerCase().includes(q) || t.phone.includes(q) || t.preview.toLowerCase().includes(q))) {
      return false;
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

  useEffect(() => {
    if (!selected && threads.length) setSelected(threads[0].key);
  }, [threads, selected]);

  useEffect(() => {
    setDraft("");
    setSendError(null);
    setApplyError(null);
    setReplyingTo(null);
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
    <div className="flex h-[calc(100vh-64px)] min-h-[560px] gap-3 p-3 text-foreground">
      {/* ── Thread list ─────────────────────────────── */}
      <div className="flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
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
                onClick={() => setFilter("need")}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${filter === "need" ? "bg-amber-500/20 text-amber-800 dark:text-amber-300" : "bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-400"}`}
              >
                <ShoppingCart size={11} /> Need ordering {needSupplierIds.size}
              </button>
            )}
            {(filter === "reply" || (counts?.needsReply ?? 0) > 0) && (
              <Chip on={filter === "reply"} tone="danger" onClick={() => setFilter("reply")}>
                Needs reply {counts?.needsReply ?? 0}
              </Chip>
            )}
            {(filter === "topay" || (counts?.toPay ?? 0) > 0) && (
              <Chip on={filter === "topay"} onClick={() => setFilter("topay")}>To pay {counts?.toPay ?? 0}</Chip>
            )}
            {(filter === "awaiting" || (counts?.awaitingDelivery ?? 0) > 0) && (
              <Chip on={filter === "awaiting"} onClick={() => setFilter("awaiting")}>
                Awaiting delivery {counts?.awaitingDelivery ?? 0}
              </Chip>
            )}
            <Chip on={filter === "all"} onClick={() => setFilter("all")}>All {counts?.suppliers ?? 0}</Chip>
            <select
              value={(["auto", "assist", "off", "other"] as string[]).includes(filter) ? filter : ""}
              onChange={(e) => e.target.value && setFilter(e.target.value as "auto" | "assist" | "off" | "other")}
              title="Filter by automation mode"
              className={`rounded-full border px-2 py-[3px] text-[11px] ${(["auto", "assist", "off", "other"] as string[]).includes(filter) ? "border-primary/40 bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground"}`}
            >
              <option value="">Mode</option>
              <option value="auto">Auto {counts?.auto ?? 0}</option>
              <option value="assist">Assist {counts?.assist ?? 0}</option>
              <option value="off">Off {counts?.off ?? 0}</option>
              {(counts?.other ?? 0) > 0 && <option value="other">Other {counts?.other ?? 0}</option>}
            </select>
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
          {shown.map((t) => (
            <button
              key={t.key}
              onClick={() => setSelected(t.key)}
              className={`flex w-full gap-2.5 border-b border-border p-2.5 text-left ${selected === t.key ? "bg-muted" : "hover:bg-muted/50"}`}
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-medium text-primary">
                {initials(t.name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
                    {t.registered && t.automationMode && <ModeDot mode={t.automationMode} />}
                    <span className="truncate">{t.name}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{t.lastAt ? rel(t.lastAt) : ""}</span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  {t.needsAttention && <AlertCircle size={11} className="shrink-0 text-destructive" />}
                  <span className="truncate">{t.hasMessages ? t.preview : "No messages yet"}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Conversation ────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
        {!detail ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a chat
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <div>
                <div className="text-sm font-medium">{detail.supplier?.name ?? `+${detail.key}`}</div>
                <div className="text-xs text-muted-foreground">+{detail.key}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] text-green-600 dark:text-green-400">
                  WhatsApp
                </span>
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
                    className={`min-w-0 rounded-lg px-3 py-2 text-[13px] leading-snug ${
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
      <div className="flex w-96 shrink-0 flex-col overflow-y-auto rounded-xl border border-border bg-background p-3 shadow-sm">
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
                        No price-list products for this supplier yet. Add them on the supplier record first.
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
                  <div className="rounded-md bg-muted px-2.5 py-1.5">
                    <div className="text-[11px] text-muted-foreground">Unpaid</div>
                    <div className="text-[15px] font-medium">{formatRM(detail.context.unpaidTotal)}</div>
                  </div>
                  {detail.context.overdueTotal > 0 && (
                    <div className="rounded-md bg-destructive/10 px-2.5 py-1.5">
                      <div className="text-[11px] text-destructive">Overdue</div>
                      <div className="text-[15px] font-medium text-destructive">
                        {formatRM(detail.context.overdueTotal)}
                      </div>
                    </div>
                  )}
                </div>
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
                {detail.agentProposal && (
                  <div className="border-b border-border py-3">
                    <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-800 dark:bg-amber-950/40">
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                        <AlertCircle size={12} /> Agent suggests — your call
                      </div>
                      <div className="text-[12px] text-foreground">
                        {detail.agentProposal.poAction
                          ? <>
                              {detail.agentProposal.poAction.type === "substitute_item" && "Substitution offered"}
                              {detail.agentProposal.poAction.type === "cancel_order" && "Cancel requested"}
                              {detail.agentProposal.poAction.type === "remove_item" && "Remove line"}
                              {detail.agentProposal.poAction.type === "reduce_qty" && "Reduce qty"}
                              {detail.agentProposal.poAction.itemName && <> · <span className="font-medium">{detail.agentProposal.poAction.itemName}</span></>}
                              {detail.agentProposal.poAction.newQuantity != null && <> → {detail.agentProposal.poAction.newQuantity}</>}
                              {detail.agentProposal.poAction.note && <div className="mt-0.5 text-[11px] text-muted-foreground">“{detail.agentProposal.poAction.note}”</div>}
                            </>
                          : <span className="capitalize">{detail.agentProposal.intent.replace(/_/g, " ")}</span>}
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
                              <a
                                href={`/inventory/orders/${detail.agentProposal.orderId}`}
                                className="inline-flex items-center gap-1 rounded border border-amber-300 px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/40"
                              >
                                Open PO <ExternalLink size={11} />
                              </a>
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
                      {applyError && (
                        <div className="mt-1 text-[10.5px] text-destructive">{applyError}</div>
                      )}
                    </div>
                  </div>
                )}
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
                  {detail.context.recentPOs.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">None open.</p>
                  )}
                  {detail.context.recentPOs.map((po) => (
                    <button
                      key={po.id}
                      onClick={() => openPoView(po.id)}
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

      {poViewId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            if (!poViewBusy) {
              setPoViewId(null);
              setPoView(null);
            }
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[82vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-background shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{poView?.orderNumber ?? "Loading…"}</span>
                {poView && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                    {poView.status.replace(/_/g, " ").toLowerCase()}
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  setPoViewId(null);
                  setPoView(null);
                }}
                aria-label="Close"
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>
            {!poView ? (
              <div className="flex items-center justify-center p-8">
                {poViewError ? (
                  <span className="text-xs text-destructive">{poViewError}</span>
                ) : (
                  <Loader2 size={18} className="animate-spin text-muted-foreground" />
                )}
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-4 py-2">
                  {poView.outlet?.name && <div className="mb-1 text-[11px] text-muted-foreground">{poView.outlet.name}</div>}
                  {poView.items.map((it) => (
                    <div key={it.id} className="flex items-center justify-between border-b border-border py-1.5 text-[13px]">
                      <span className="truncate">{it.product?.name ?? "item"}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {Number(it.quantity)} × {formatRM(Number(it.unitPrice))}
                      </span>
                    </div>
                  ))}
                  <div className="mt-2 flex justify-between text-[13px]">
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-medium">{formatRM(Number(poView.totalAmount))}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">Delivery</span>
                    <input
                      type="date"
                      value={poDate}
                      onChange={(e) => setPoDate(e.target.value)}
                      className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                    />
                    <button
                      onClick={() => poPatch({ deliveryDate: poDate || null })}
                      disabled={poViewBusy || poDate === (poView.deliveryDate ? String(poView.deliveryDate).slice(0, 10) : "")}
                      className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-40"
                    >
                      Save
                    </button>
                  </div>
                </div>
                <div className="border-t border-border px-4 py-3">
                  {poViewError && <div className="mb-2 text-[11px] text-destructive">{poViewError}</div>}
                  <div className="flex flex-wrap gap-2">
                    {(poView.status === "DRAFT" || poView.status === "PENDING_APPROVAL") && (
                      <button
                        onClick={() => poPatch({ status: "APPROVED" })}
                        disabled={poViewBusy}
                        className="flex-1 rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        Approve
                      </button>
                    )}
                    {poView.status === "APPROVED" && (
                      <button
                        onClick={() => poPatch({ status: "SENT" })}
                        disabled={poViewBusy}
                        className="flex flex-1 items-center justify-center gap-1 rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        {poViewBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send to supplier
                      </button>
                    )}
                    {["SENT", "CONFIRMED", "AWAITING_DELIVERY", "PARTIALLY_RECEIVED"].includes(poView.status) && (
                      <a
                        href="/inventory/receivings"
                        className="flex-1 rounded-md border border-border px-3 py-2 text-center text-[13px] font-medium hover:bg-muted"
                      >
                        Record delivery
                      </a>
                    )}
                    {poView.status !== "COMPLETED" && poView.status !== "CANCELLED" && (
                      <button
                        onClick={() => poPatch({ status: "CANCELLED" })}
                        disabled={poViewBusy}
                        className="rounded-md border border-destructive/40 px-3 py-2 text-[13px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      onClick={() => openEditOrder(poView.id)}
                      disabled={editLoading}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-[13px] font-medium hover:bg-muted disabled:opacity-50"
                    >
                      {editLoading ? <Loader2 size={14} className="animate-spin" /> : <Pencil size={14} />} Edit
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Full PO edit — shared modal (same one the Purchase Orders page uses) */}
      <EditOrderModal
        order={editOrder}
        onClose={() => setEditOrder(null)}
        onSaved={() => { mutateDetail(); mutateThreads(); if (poViewId) void openPoView(poViewId); }}
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
