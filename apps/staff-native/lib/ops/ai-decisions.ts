import { api } from "../api";

export type ReorderItem = {
  productId: string;
  productName: string;
  packageId: string | null;
  packageName: string | null;
  packageLabel: string | null;
  currentQty: number;
  parLevel: number;
  reorderQty: number;
  daysUntilStockout: number;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  baseUom: string;
};

export type PORecommendation = {
  type: "purchase_order";
  outletId: string;
  outletName: string;
  outletCode: string;
  supplierId: string;
  supplierName: string;
  leadTimeDays: number;
  items: ReorderItem[];
  totalAmount: number;
  urgency: "critical" | "low" | "restock";
};

export type AIDecisionsResponse = {
  purchaseOrders: PORecommendation[];
  transfers: unknown[];
  wastageAlerts: unknown[];
  summary: {
    totalPOsToCreate: number;
    totalReorderValue: number;
    criticalPOs: number;
    transfersNeeded: number;
    wastageAlertCount: number;
  };
};

// Pulls Smart-order recommendations from the backoffice via the staff
// proxy. Native PO create surfaces these as a tappable list, tap one
// to pre-fill the cart with the supplier + items.
export function fetchAIDecisions(outletId?: string) {
  const params = new URLSearchParams();
  if (outletId) params.set("outletId", outletId);
  const q = params.toString();
  return api<AIDecisionsResponse>(`/api/ai-decisions${q ? `?${q}` : ""}`);
}
