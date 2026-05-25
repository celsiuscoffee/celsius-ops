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
  status: InvoiceStatus;
  paymentType: "SUPPLIER" | "STAFF_CLAIM" | "PAYMENT_REQUEST" | "TRANSFER" | null;
  dueDate: string | null;
  paidAt: string | null;
  createdAt: string;
  photos: string[];
  supplierName: string | null;
  orderId: string | null;
  orderNumber: string | null;
  outletName: string | null;
};

// `tab` and `cardFilter` are independent — the latter wins server-side
// when both are set (the user clicked a summary card). Native list
// screen drives this via tab pills + the GRNI card.
export function listInvoices(opts: {
  tab?: "unpaid" | "paid" | "all" | "pending_invoice";
  cardFilter?:
    | "paid"
    | "overdue"
    | "payable"
    | "due_today"
    | "pending_invoice";
  search?: string;
} = {}) {
  const params = new URLSearchParams();
  if (opts.tab) params.set("tab", opts.tab);
  if (opts.cardFilter) params.set("cardFilter", opts.cardFilter);
  if (opts.search) params.set("search", opts.search);
  const q = params.toString();
  return api<{ items: InvoiceListItem[] }>(
    `/api/invoices${q ? `?${q}` : ""}`,
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
