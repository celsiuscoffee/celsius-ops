"use client";

import { formatRM } from "@celsius/shared";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFetch } from "@/lib/use-fetch";
import { KeyNumber } from "@/components/ui/key-number";
import { EditOrderModal } from "@/components/inventory/EditOrderModal";
import {
  Search,
  ChevronDown,
  ShoppingCart,
  MessageCircle,
  Truck,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  AlertTriangle,
  Plus,
  Trash2,
  Pencil,
  Receipt,
  CalendarDays,
  X,
  Filter,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────

type OrderItem = {
  id: string;
  product: string;
  sku: string;
  uom: string;
  package: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes: string | null;
};

type OrderInvoice = {
  id: string;
  invoiceNumber: string;
  amount: number;
  status: string;
  issueDate: string;
  dueDate: string | null;
  photoCount: number;
  photos: string[];
  depositPercent: number | null;
  depositTermsDays: number | null;
  depositAmount: number | null;
  depositPaidAt: string | null;
  deliveryDate: string | null;
};

type Order = {
  id: string;
  orderNumber: string;
  outlet: string;
  outletCode: string;
  supplierId: string;
  supplier: string;
  supplierPhone: string;
  status: string;
  totalAmount: number;
  notes: string | null;
  photos: string[];
  deliveryDate: string | null;
  deliveryCharge: number;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  items: OrderItem[];
  receivingCount: number;
  invoice: OrderInvoice | null;
  supplierDepositPercent: number | null;
  supplierDepositTermsDays: number | null;
};

// ── Constants ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  DRAFT: { label: "Draft", color: "bg-sunken text-text-2", icon: FileText },
  PENDING_APPROVAL: { label: "Waiting for approval", color: "bg-warn-soft text-warn-text", icon: Clock },
  APPROVED: { label: "Confirmed", color: "bg-info-soft text-info-text", icon: CheckCircle2 },
  SENT: { label: "Sent", color: "bg-info-soft text-info-text", icon: MessageCircle },
  AWAITING_DELIVERY: { label: "Awaiting delivery", color: "bg-info-soft text-info-text", icon: Truck },
  PARTIALLY_RECEIVED: { label: "Short delivered", color: "bg-warn-soft text-warn-text", icon: AlertTriangle },
  COMPLETED: { label: "Completed", color: "bg-ok-soft text-ok-text", icon: CheckCircle2 },
  CANCELLED: { label: "Cancelled", color: "bg-sunken text-text-3", icon: AlertTriangle },
};

const NEXT_ACTIONS: Record<string, { status: string; label: string; icon: typeof Clock; color: string }[]> = {
  DRAFT: [],
  PENDING_APPROVAL: [],
  APPROVED: [],
  SENT: [],
  AWAITING_DELIVERY: [],
  // A short-delivered PO stays open (chased) until the balance arrives; when
  // the supplier won't deliver the rest, closing SHORT is the correct exit —
  // the total already reflects what arrived, so the payable stays right.
  // (Cancel is blocked once goods are received: it would delete the payable.)
  PARTIALLY_RECEIVED: [
    { status: "COMPLETED", label: "Close short (no more coming)", icon: CheckCircle2, color: "bg-ink text-on-ink hover:bg-ink-hover" },
  ],
  COMPLETED: [],
  CANCELLED: [],
};

// ── Component ─────────────────────────────────────────────────────────────

export default function OrdersPage() {
  // Table state
  const [tab, setTab] = useState("active");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 500);
    return () => clearTimeout(t);
  }, [search]);
  // Deep-link from the Purchase Orders workspace: ?search=<supplier> pre-fills the search so the
  // rail's "Open POs" card lands on this supplier's POs. window.location avoids a Suspense boundary.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("search");
    if (q) {
      setSearch(q);
      setDebouncedSearch(q);
    }
  }, []);
  // Created-date range filter — mirrors the invoices page pattern.
  const [showFilters, setShowFilters] = useState(false);
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const activeOrderFilterCount = [createdFrom, createdTo].filter(Boolean).length;
  const url = (() => {
    const params = new URLSearchParams({ tab });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (createdFrom) params.set("createdFrom", createdFrom);
    if (createdTo) params.set("createdTo", createdTo);
    return `/api/inventory/orders?${params.toString()}`;
  })();
  type OrdersResponse = { orders: Order[]; summary: { total: number; draft: number; active: number; completed: number; totalValue: number } };
  const { data, isLoading: loading, mutate: loadOrders } = useFetch<OrdersResponse>(url);
  const orders: Order[] = data?.orders ?? [];
  const summary = data?.summary ?? { total: 0, draft: 0, active: 0, completed: 0, totalValue: 0 };
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Edit dialog state — modal logic lives in EditOrderModal now.
  // We keep just the trigger here: which order is being edited (null =
  // closed) and whether the modal opens in confirm/upload-invoice mode.
  const [editOrder, setEditOrder] = useState<Order | null>(null);
  const [editConfirmMode, setEditConfirmMode] = useState(false);
  const openEditDialog = (order: Order, confirmMode = false) => {
    setEditConfirmMode(confirmMode);
    setEditOrder(order);
  };

  // ── Status update ───────────────────────────────────────────────────────

  const deleteOrder = async (orderId: string) => {
    if (!confirm("Delete this order permanently?")) return;
    setUpdatingId(orderId);
    try {
      const res = await fetch(`/api/inventory/orders/${orderId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to delete order");
        return;
      }
      loadOrders();
    } finally {
      setUpdatingId(null);
    }
  };

  const updateStatus = async (orderId: string, newStatus: string) => {
    setUpdatingId(orderId);
    try {
      const res = await fetch(`/api/inventory/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        alert(body.error || "Failed to update order status");
        return;
      }
      loadOrders();
    } finally {
      setUpdatingId(null);
    }
  };

  const buildWhatsAppUrl = (order: Order) => {
    const items = order.items.map((i) => `• ${i.product} (${i.uom || i.package}) × ${i.quantity}`).join("\n");
    const msg = `Hi, this is Celsius Coffee.\n\nPO: ${order.orderNumber}\nOutlet: ${order.outlet}\n${order.deliveryDate ? `Delivery: ${order.deliveryDate}\n` : ""}\nOrder:\n${items}\n\nTotal: ${formatRM(order.totalAmount)}\n\n${order.notes ? `Notes: ${order.notes}\n\n` : ""}Thank you!`;
    const phone = order.supplierPhone.replace(/[^0-9]/g, "");
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  };

  // ── Computed from API-filtered results ───────────────────────────────────


  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-brand-text" />
      </div>
    );
  }

  const onTheWay = orders.filter((o) => ["APPROVED", "SENT", "AWAITING_DELIVERY"].includes(o.status));
  const shortDelivered = orders.filter((o) => o.status === "PARTIALLY_RECEIVED").length;
  const waitingApproval = orders.filter((o) => o.status === "PENDING_APPROVAL").length;
  const btn = "inline-flex h-9 items-center gap-1.5 rounded-ctl px-3 text-[13px] font-medium disabled:opacity-50";

  return (
    <div className="px-4 pt-6 pb-10 md:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Supplier orders</h1>
          <p className="mt-0.5 text-sm text-text-2">Every order to a supplier: what is still to arrive, and what came short.</p>
        </div>
        <Link href="/inventory/orders/create" className="self-start">
          <Button className="bg-ink text-on-ink hover:bg-ink-hover"><Plus className="mr-1.5 h-4 w-4" />Create order</Button>
        </Link>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KeyNumber label="Open orders" value={String(summary.active)}
          note={<><b className="font-semibold text-text-2">{summary.draft}</b> {summary.draft === 1 ? "draft" : "drafts"} not sent yet</>} />
        <KeyNumber label="On the way" value={String(onTheWay.length)}
          note={<><b className="font-semibold text-text-2">{formatRM(onTheWay.reduce((a, o) => a + o.totalAmount, 0))}</b> of stock to receive</>} />
        <KeyNumber label="Short delivered" value={String(shortDelivered)} tone={shortDelivered > 0 ? "warn" : undefined}
          note={shortDelivered > 0 ? "chase the rest or close short" : "nothing came short"} />
        <KeyNumber label="Waiting for approval" value={String(waitingApproval)} tone={waitingApproval > 0 ? "warn" : undefined}
          note={<>orders in this view: <b className="font-semibold text-text-2">{formatRM(summary.totalValue)}</b></>} />
      </div>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <div className="relative w-full sm:max-w-md sm:flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
          <Input placeholder="Search by PO number, supplier or outlet..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {([["active", "Open"], ["completed", "Completed"], ["all", "All"]] as const).map(([value, label]) => (
            <button key={value} onClick={() => setTab(value)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${tab === value ? "border-text bg-raised font-semibold text-text" : "border-line text-text-2 hover:bg-sunken"}`}>
              {label}
            </button>
          ))}
          <button onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${showFilters || activeOrderFilterCount > 0 ? "border-text bg-raised font-semibold text-text" : "border-line text-text-2 hover:bg-sunken"}`}>
            <Filter className="h-3 w-3" />Dates{activeOrderFilterCount > 0 && ` (${activeOrderFilterCount})`}
          </button>
          {activeOrderFilterCount > 0 && (
            <button onClick={() => { setCreatedFrom(""); setCreatedTo(""); }} className="flex items-center gap-1 rounded-full border border-line px-3 py-1 text-xs text-text-2 hover:bg-sunken">
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
      </div>

      {showFilters && (
        <div className="mt-3 grid gap-3 rounded-card border border-line bg-surface p-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-[13px] font-medium text-text-2"><CalendarDays className="h-3.5 w-3.5" /> Created from</span>
            <input type="date" value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} className="h-10 w-full rounded-ctl border border-line bg-surface px-3 text-sm text-text focus:border-ink focus:outline-none" />
          </label>
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-[13px] font-medium text-text-2"><CalendarDays className="h-3.5 w-3.5" /> Created to</span>
            <input type="date" value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} min={createdFrom || undefined} className="h-10 w-full rounded-ctl border border-line bg-surface px-3 text-sm text-text focus:border-ink focus:outline-none" />
          </label>
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface">
        {orders.length === 0 && (
          <div className="px-4 py-12 text-center">
            <ShoppingCart className="mx-auto h-8 w-8 text-text-3" />
            <p className="mt-2 text-sm text-text-2">{!debouncedSearch && tab === "all" ? "No orders yet. Use Create order to start one." : "No orders match your filter."}</p>
          </div>
        )}
        {orders.map((order) => {
          const config = STATUS_CONFIG[order.status] ?? { label: order.status, color: "bg-sunken text-text-2", icon: Clock };
          const actions = NEXT_ACTIONS[order.status] ?? [];
          const open = expandedId === order.id;
          return (
            <div key={order.id} className="border-b border-line last:border-b-0">
              <button onClick={() => setExpandedId(open ? null : order.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-sunken/50">
                <ChevronDown className={`h-4 w-4 shrink-0 text-text-3 transition-transform ${open ? "rotate-180" : ""}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text">{order.supplier} <span className="font-normal text-text-3">· {order.outlet}</span></p>
                  <p className="mt-0.5 truncate text-[12px] text-text-3">
                    {order.orderNumber} · {order.items.length} {order.items.length === 1 ? "item" : "items"}{order.deliveryDate ? ` · delivery ${order.deliveryDate}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-mono text-sm font-semibold text-text">{formatRM(order.totalAmount)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${config.color}`}>{config.label}</span>
                </div>
              </button>
              {open && (
                <div className="border-t border-line bg-sunken/40 px-4 py-3">
                  <div className="divide-y divide-line rounded-ctl border border-line bg-surface">
                    {order.items.map((item) => (
                      <div key={item.id} className="flex items-center gap-3 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-text">{item.product}</p>
                          <p className="text-[12px] text-text-3">{item.quantity} × {item.uom || item.package} at {formatRM(item.unitPrice)}</p>
                        </div>
                        <span className="shrink-0 font-mono text-sm text-text">{formatRM(item.totalPrice)}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[12px] text-text-3">
                    Created by {order.createdBy}{order.approvedBy ? ` · approved by ${order.approvedBy}` : ""}{order.sentAt ? ` · sent ${new Date(order.sentAt).toLocaleDateString("en-MY", { day: "numeric", month: "short" })}` : ""}
                    {order.receivingCount > 0 ? ` · ${order.receivingCount} ${order.receivingCount === 1 ? "receiving" : "receivings"} linked` : ""}
                  </p>
                  {order.notes && <p className="mt-1 text-[13px] text-text-2">Note: {order.notes}</p>}
                  {order.invoice && (
                    <p className="mt-1 flex items-center gap-1.5 text-[13px] text-text-2">
                      <Receipt className="h-3.5 w-3.5 text-text-3" /> Invoice {order.invoice.invoiceNumber} · {formatRM(order.invoice.amount)} · {{ PENDING: "Payment", OVERDUE: "Initiated", PAID: "Paid" }[order.invoice.status] || order.invoice.status}{order.invoice.dueDate ? ` · due ${order.invoice.dueDate}` : ""}
                    </p>
                  )}
                  {order.photos && order.photos.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {order.photos.map((url, i) => {
                        const isRaw = url.includes("/raw/upload/") || url.endsWith(".pdf");
                        return (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="relative h-16 w-16 overflow-hidden rounded-ctl border border-line hover:border-line-2">
                            {isRaw ? <div className="flex h-full w-full items-center justify-center bg-sunken"><FileText className="h-6 w-6 text-text-3" /></div>
                              : <Image src={url} alt={`Document ${i + 1}`} fill className="object-cover" sizes="64px" />}
                          </a>
                        );
                      })}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href={`/inventory/orders/${order.id}`} className={`${btn} border border-line bg-surface text-text hover:bg-sunken`}>Open order</Link>
                    {order.supplierPhone && ["APPROVED", "SENT", "AWAITING_DELIVERY"].includes(order.status) && (
                      <a href={buildWhatsAppUrl(order)} target="_blank" className={`${btn} border border-line bg-surface text-text hover:bg-sunken`}><MessageCircle className="h-4 w-4" />WhatsApp supplier</a>
                    )}
                    {actions.map((a) => (
                      <button key={a.status} onClick={() => updateStatus(order.id, a.status)} disabled={updatingId === order.id} className={`${btn} ${a.color}`}>
                        {updatingId === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : a.label}
                      </button>
                    ))}
                    {/* Upload invoice: every in-flight PO until the invoice is paid or fully attached (dueDate set). */}
                    {["AWAITING_DELIVERY", "PARTIALLY_RECEIVED", "COMPLETED", "SENT", "APPROVED"].includes(order.status) && order.invoice?.status !== "PAID" && !order.invoice?.dueDate && (
                      <button onClick={() => openEditDialog(order)} disabled={updatingId === order.id} className={`${btn} bg-ink text-on-ink hover:bg-ink-hover`}>Upload invoice</button>
                    )}
                    {order.status === "DRAFT" && (
                      <Link href={`/inventory/orders/create?draft=${order.id}`} className={`${btn} border border-line bg-surface text-text hover:bg-sunken`}><Pencil className="h-4 w-4" />Edit draft</Link>
                    )}
                    {["SENT", "APPROVED", "AWAITING_DELIVERY"].includes(order.status) && order.invoice?.status !== "PAID" && (
                      <button onClick={() => openEditDialog(order)} disabled={updatingId === order.id} className={`${btn} border border-line bg-surface text-text hover:bg-sunken`}><Pencil className="h-4 w-4" />Edit order</button>
                    )}
                    {/* Cancel hidden once a committed invoice exists; the API enforces it too. */}
                    {["SENT", "APPROVED", "AWAITING_DELIVERY"].includes(order.status) && !["INITIATED", "DEPOSIT_PAID", "PAID"].includes(order.invoice?.status ?? "") && (
                      <button onClick={() => { if (confirm("Cancel this order?")) updateStatus(order.id, "CANCELLED"); }} disabled={updatingId === order.id} className={`${btn} border border-line bg-surface text-danger-text hover:bg-danger-soft`}>Cancel order</button>
                    )}
                    {["DRAFT", "CANCELLED"].includes(order.status) && (
                      <button onClick={() => deleteOrder(order.id)} disabled={updatingId === order.id} className={`${btn} border border-line bg-surface text-danger-text hover:bg-danger-soft`}><Trash2 className="h-4 w-4" />Delete</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Edit Order Dialog — shared component (also used in supplier-chats) */}
      <EditOrderModal
        order={editOrder}
        confirmMode={editConfirmMode}
        onClose={() => setEditOrder(null)}
        onSaved={() => { loadOrders(undefined, { revalidate: true }); }}
      />

    </div>
  );
}
