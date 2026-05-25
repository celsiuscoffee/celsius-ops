import { api } from "../api";

export type InvoiceStatus =
  | "DRAFT"
  | "INITIATED"
  | "PENDING"
  | "PARTIALLY_PAID"
  | "DEPOSIT_PAID"
  | "OVERDUE"
  | "PAID"
  | "CANCELLED";

export type InvoiceListItem = {
  id: string;
  invoiceNumber: string;
  amount: number;
  amountPaid: number;
  depositAmount: number;
  // Phase 9b — extra fields so the list can fire Send POP inline
  // without a detail fetch.
  depositPercent: number | null;
  depositRef: string | null;
  paymentRef: string | null;
  popShortLink: string | null;
  // Phase 10 — null means the supplier hasn't been sent the POP yet.
  // Used to render the "POP sent" pill and the unsent-only filter.
  popSentAt: string | null;
  status: InvoiceStatus;
  paymentType: "SUPPLIER" | "STAFF_CLAIM" | "PAYMENT_REQUEST" | "TRANSFER" | null;
  dueDate: string | null;
  paidAt: string | null;
  createdAt: string;
  photos: string[];
  supplierName: string | null;
  supplierPhone: string | null;
  orderId: string | null;
  orderNumber: string | null;
  outletName: string | null;
};

// `tab` and `cardFilter` are independent — the latter wins server-side
// when both are set (the user clicked a summary card). Native list
// screen drives this via tab pills + the GRNI card.
//
// Phase 10 adds optional filters layered on top:
//   - popStatus:  "sent" | "not_sent"  — narrow by POP-sent state
//   - supplierId: drill into one supplier
//   - outletId:   manager-only outlet override (non-managers stay
//                 scoped to their assigned outlet server-side)
//   - dateFrom / dateTo: ISO yyyy-mm-dd, filters on issueDate
export type InvoiceListFilters = {
  tab?: "unpaid" | "paid" | "all" | "pending_invoice";
  cardFilter?:
    | "paid"
    | "overdue"
    | "payable"
    | "due_today"
    | "pending_invoice";
  search?: string;
  popStatus?: "sent" | "not_sent";
  supplierId?: string;
  outletId?: string;
  dateFrom?: string;
  dateTo?: string;
};

export function listInvoices(opts: InvoiceListFilters = {}) {
  const params = new URLSearchParams();
  if (opts.tab) params.set("tab", opts.tab);
  if (opts.cardFilter) params.set("cardFilter", opts.cardFilter);
  if (opts.search) params.set("search", opts.search);
  if (opts.popStatus) params.set("popStatus", opts.popStatus);
  if (opts.supplierId) params.set("supplierId", opts.supplierId);
  if (opts.outletId) params.set("outletId", opts.outletId);
  if (opts.dateFrom) params.set("dateFrom", opts.dateFrom);
  if (opts.dateTo) params.set("dateTo", opts.dateTo);
  const q = params.toString();
  return api<{ items: InvoiceListItem[] }>(
    `/api/invoices${q ? `?${q}` : ""}`,
  );
}

// Stamp popSentAt on the server right after the user fires the Send
// POP WhatsApp deeplink. Fire-and-forget on the client — failure here
// just leaves the row without a "POP sent" pill until next sync; the
// supplier still got the message.
export function markPopSent(id: string) {
  return api<{ popSentAt: string | null }>(
    `/api/invoices/${id}/pop-sent`,
    { method: "POST" },
  );
}

export function getInvoice(id: string) {
  return api<Record<string, unknown>>(`/api/invoices/${id}`);
}

// Attach a real supplier invoice to a GRNI placeholder. Updates the
// invoice number (from the auto-generated INV-NNNN), due date, and
// optionally amount + photos. Status stays PENDING until paid.
export function attachInvoice(
  id: string,
  input: {
    invoiceNumber: string;
    dueDate: string;
    amount?: number;
    photos?: string[];
    notes?: string;
  },
) {
  return api<{ id: string; invoiceNumber: string; dueDate: string }>(
    `/api/invoices/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

// Mint (or fetch existing) a short link to the latest invoice photo —
// used as the "Receipt: <url>" line in POP WhatsApp messages so the
// supplier opens one canonical URL instead of a 200-char Supabase
// signed link. Proxies to backoffice (single generator).
export function fetchPopShortlink(id: string) {
  return api<{ shortLink: string }>(
    `/api/invoices/${id}/shortlink`,
    { method: "POST" },
  );
}

// Status-aware POP message used for the WhatsApp deeplink.
// PAID            → full payment confirmation
// DEPOSIT_PAID    → deposit paid + balance line
// PARTIALLY_PAID  → partial paid + outstanding line
// Mirrors backoffice `buildPopMessage` in apps/backoffice/.../invoices/page.tsx.
export function buildPopMessage(
  inv: {
    invoiceNumber: string;
    amount: number;
    amountPaid?: number | null;
    depositAmount?: number | null;
    depositPercent?: number | null;
    depositRef?: string | null;
    paymentRef?: string | null;
    dueDate?: string | null;
    status: string;
  },
  receiptUrl: string,
): string {
  const fmt = (n: number) => `RM ${n.toFixed(2)}`;
  const paid = inv.amountPaid ?? 0;
  const balance = Math.max(0, inv.amount - paid);
  const dueLine = inv.dueDate
    ? ` due ${new Date(inv.dueDate).toLocaleDateString([], {
        day: "numeric",
        month: "short",
      })}`
    : "";

  if (inv.status === "DEPOSIT_PAID") {
    const depAmt = paid || (inv.depositAmount ?? 0);
    const pctTag = inv.depositPercent ? ` (${inv.depositPercent}%)` : "";
    return [
      `Hi, deposit of ${fmt(depAmt)}${pctTag} has been paid for invoice ${inv.invoiceNumber}.`,
      `Ref: ${inv.depositRef ?? "N/A"}`,
      balance > 0 ? `Balance ${fmt(balance)}${dueLine} will follow.` : "",
      ``,
      `Receipt: ${receiptUrl}`,
      ``,
      `Thank you.`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (inv.status === "PARTIALLY_PAID") {
    return [
      `Hi, partial payment of ${fmt(paid)} has been made for invoice ${inv.invoiceNumber} (total ${fmt(inv.amount)}).`,
      `Ref: ${inv.paymentRef ?? inv.depositRef ?? "N/A"}`,
      balance > 0 ? `Outstanding ${fmt(balance)}${dueLine}.` : "",
      ``,
      `Receipt: ${receiptUrl}`,
      ``,
      `Thank you.`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  // PAID (default) — full payment
  return `Hi, payment has been made for invoice ${inv.invoiceNumber} — ${fmt(inv.amount)}.\nRef: ${inv.paymentRef ?? "N/A"}\n\nReceipt: ${receiptUrl}\n\nThank you.`;
}
