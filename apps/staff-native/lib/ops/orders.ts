import { api } from "../api";

export type OrderStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "SENT"
  | "AWAITING_DELIVERY"
  | "PARTIALLY_RECEIVED"
  | "COMPLETED"
  | "CANCELLED";

export type OrderListItem = {
  id: string;
  orderNumber: string;
  outlet: string;
  outletCode: string;
  supplierId: string;
  supplier: string;
  supplierPhone: string;
  status: OrderStatus;
  totalAmount: number;
  notes: string | null;
  deliveryDate: string | null;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  items: Array<{
    id: string;
    productId: string;
    product: string;
    sku: string;
    uom: string;
    package: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    notes: string | null;
  }>;
  receivingCount: number;
};

export type OrderDetail = OrderListItem & {
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    amount: number;
    status: string;
    dueDate: string | null;
    paidAt: string | null;
  }>;
};

// List POs scoped to caller's outlet (server-side filter via session
// when no outletId param is sent, mirrors web staff app).
export function listOrders(opts: {
  status?: string;
  search?: string;
  outletId?: string;
  limit?: number;
} = {}) {
  const params = new URLSearchParams();
  if (opts.status) params.set("status", opts.status);
  if (opts.search) params.set("search", opts.search);
  if (opts.outletId) params.set("outletId", opts.outletId);
  if (opts.limit) params.set("limit", String(opts.limit));
  const q = params.toString();
  return api<{ items: OrderListItem[]; total: number }>(
    `/api/orders${q ? `?${q}` : ""}`,
  );
}

export function getOrder(id: string) {
  // Backoffice response shape is a single order with includes — cast
  // through the OrderDetail surface; native screens only read the
  // fields they need.
  return api<OrderDetail & Record<string, unknown>>(`/api/orders/${id}`);
}

export type CreateOrderInput = {
  outletId: string;
  supplierId: string;
  items: Array<{
    productId: string;
    productPackageId?: string | null;
    quantity: number;
    unitPrice: number;
    notes?: string;
  }>;
  notes?: string;
  deliveryDate?: string;
};

export function createOrder(input: CreateOrderInput) {
  return api<{ id: string; orderNumber: string }>("/api/orders", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateOrderStatus(id: string, status: OrderStatus) {
  return api<{ id: string; status: OrderStatus }>(`/api/orders/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

// Convenience aliases — the underlying PATCH is the same.
export function approveOrder(id: string) {
  return updateOrderStatus(id, "APPROVED");
}

// "Send to supplier" = transition to AWAITING_DELIVERY. The legacy
// SENT state was retired in the new flow; sentAt is stamped on either
// transition by the API.
export function sendOrder(id: string) {
  return updateOrderStatus(id, "AWAITING_DELIVERY");
}

export function cancelOrder(id: string) {
  return updateOrderStatus(id, "CANCELLED");
}
