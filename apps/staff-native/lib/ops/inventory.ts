import { api } from "../api";

export type Package = {
  id: string;
  name: string;
  label: string;
  uom: string;
  conversion: number;
  isDefault: boolean;
};

export type Product = {
  id: string;
  name: string;
  sku: string;
  baseUom: string;
  storageArea: string;
  categoryId: string;
  category: string;
  packages: Package[];
  suppliers: { name: string; price: number; uom: string }[];
  checkFrequency: string;
};

export type ServerItem = {
  productId: string;
  productPackageId: string | null;
  countedQty: number | null;
  countedById: string | null;
  countedAt: string | null;
  countedBy: { id: string; name: string } | null;
};

export type ActiveStockCheckResponse = {
  active: { id: string; items: ServerItem[] } | null;
  submittedToday: {
    id: string;
    submittedAt: string | null;
    finalizedAt: string | null;
    finalizedBy: { name: string } | null;
    countedBy: { name: string } | null;
  } | null;
};

export type StockSaveResponse = {
  countId: string;
  items: ServerItem[];
};

export function listProducts() {
  return api<Product[]>("/api/products/options");
}

export function getActiveStockCheck(frequency: "DAILY" | "WEEKLY" | "MONTHLY") {
  return api<ActiveStockCheckResponse>(
    `/api/stock-checks/active?frequency=${frequency}`,
  );
}

export function saveStockCountItem(input: {
  frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  productId: string;
  productPackageId: string | null;
  countedQty: number | null;
  expectedPriorCountedById?: string | null;
}) {
  const { frequency, expectedPriorCountedById, ...item } = input;
  return api<StockSaveResponse>("/api/stock-checks/items", {
    method: "POST",
    body: JSON.stringify({
      frequency,
      items: [
        {
          ...item,
          ...(expectedPriorCountedById !== undefined
            ? { expectedPriorCountedById }
            : {}),
        },
      ],
    }),
  });
}

export function finalizeStockCount(countId: string) {
  return api<{ success: boolean }>(`/api/stock-checks/${countId}/finalize`, {
    method: "POST",
  });
}

export function resetStockCount(countId: string) {
  return api<{ success: boolean }>(`/api/stock-checks/${countId}`, {
    method: "DELETE",
  });
}

// ── Wastage ───
export type WastageEntry = {
  id: string;
  product: string;
  sku: string;
  adjustmentType: string;
  quantity: number;
  costAmount: number | null;
  reason: string | null;
  adjustedBy: string;
  createdAt: string;
};

export function listWastage(outletId?: string | null) {
  const q = outletId ? `?outletId=${outletId}` : "";
  return api<WastageEntry[]>(`/api/wastage${q}`);
}

export function recordWastage(input: {
  outletId: string | null;
  productId: string;
  quantity: number;
  reason: string;
  notes?: string | null;
  adjustedById: string;
  costAmount?: number | null;
}) {
  return api<{ id: string }>("/api/wastage", {
    method: "POST",
    body: JSON.stringify({
      outletId: input.outletId,
      productId: input.productId,
      adjustmentType: "WASTAGE",
      quantity: input.quantity,
      costAmount: input.costAmount ?? null,
      reason: input.reason,
      notes: input.notes ?? null,
      adjustedById: input.adjustedById,
    }),
  });
}

// ── Receiving ───
export type OrderItem = {
  id: string;
  productId: string;
  product: string;
  sku: string;
  uom: string;
  shelfLifeDays: number | null;
  package: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes: string | null;
  // Balance-receiving context: on a partially-received PO `quantity` is the
  // cumulative already received; these carry the original target + running
  // total so the receive screen prefills the REMAINING balance.
  orderedOriginalQty?: number;
  receivedSoFarQty?: number;
  remainingQty?: number;
};

export type PendingOrder = {
  id: string;
  orderNumber: string;
  supplier: string;
  supplierId: string;
  status: string;
  totalAmount: number;
  deliveryDate: string | null;
  items: OrderItem[];
};

export type ReceivingRecord = {
  id: string;
  orderNumber: string;
  supplier: string;
  receivedBy: string;
  receivedAt: string;
  status: string;
  items: {
    id: string;
    product: string;
    orderedQty: number | null;
    receivedQty: number;
  }[];
};

export type ListOrdersResponse =
  | { items: PendingOrder[] }
  | PendingOrder[];

export function listPendingOrders(limit = 100) {
  return api<ListOrdersResponse>(`/api/orders?limit=${limit}`);
}

export function listRecentReceivings(limit = 10) {
  return api<{ data?: ReceivingRecord[] } | ReceivingRecord[]>(
    `/api/receivings?limit=${limit}`,
  );
}

export type CreateReceivingInput = {
  orderId: string;
  outletId: string;
  supplierId: string;
  items: {
    productId: string;
    orderedQty: number;
    receivedQty: number;
    expiryDate?: string;
    discrepancyReason?: string;
  }[];
  notes?: string | null;
  invoicePhotos?: string[];
};

export function createReceiving(input: CreateReceivingInput) {
  return api<{ id: string }>("/api/receivings", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ── Transfers ───
export type Transfer = {
  id: string;
  fromOutlet: string;
  toOutlet: string;
  status: string;
  transferredBy: string;
  notes: string | null;
  createdAt: string;
  items: { id: string; product: string; sku: string; quantity: number }[];
};

export function listTransfers(outletId?: string | null) {
  const q = outletId ? `?outletId=${outletId}` : "";
  return api<Transfer[]>(`/api/transfers${q}`);
}
