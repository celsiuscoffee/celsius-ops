// Order number format: CC-{OUTLET_CODE}-{SEQUENCE}
export function generateOrderNumber(outletCode: string, sequence: number): string {
  return `CC-${outletCode}-${String(sequence).padStart(4, "0")}`;
}

// Outlet codes derived from outlet names
export const OUTLET_CODES: Record<string, string> = {
  "Celsius Coffee IOI Conezion": "IOI",
  "Celsius Coffee Nilai": "NLI",
  "Celsius Coffee Shah Alam": "SHA",
  "Celsius Coffee Tamarind": "TMR",
};

export const STORAGE_AREAS = ["Fridge", "Dry Store", "Counter", "Display", "Back Store"] as const;
export type StorageArea = (typeof STORAGE_AREAS)[number];

export const ADJUSTMENT_REASONS = [
  "Wastage/Spillage",
  "Breakage",
  "Expired",
  "Used but not recorded",
  "Theft/Loss",
  "Other",
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  SENT: "Sent to Supplier",
  AWAITING_DELIVERY: "Awaiting Delivery",
  PARTIALLY_RECEIVED: "Partially Received",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

// Format WhatsApp order message
export function formatWhatsAppOrder(params: {
  outletName: string;
  orderNumber: string;
  date: string;
  items: Array<{ name: string; quantity: number; uom: string }>;
  deliveryDate?: string;
  address?: string;
}): string {
  const { outletName, orderNumber, date, items, deliveryDate, address } = params;

  let message = `📋 *Order from ${outletName}*\n`;
  message += `Date: ${date}\n`;
  message += `PO #: ${orderNumber}\n\n`;

  items.forEach((item, i) => {
    message += `${i + 1}. ${item.name} — ${item.quantity} ${item.uom}\n`;
  });

  if (deliveryDate) {
    message += `\nDelivery: ${deliveryDate}`;
  }
  if (address) {
    message += `\nOutlet: ${address}`;
  }

  message += `\n\nThank you! 🙏`;
  return message;
}

// Calculate variance percentage
export function calcVariance(expected: number, actual: number): { amount: number; percentage: number } {
  const amount = actual - expected;
  const percentage = expected > 0 ? (amount / expected) * 100 : 0;
  return { amount, percentage };
}

// Determine urgency based on stock vs par levels
export type StockUrgency = "URGENT" | "RESTOCK_SOON" | "OK" | "OVERSTOCK";

export function getStockUrgency(
  currentStock: number,
  reorderPoint: number,
  parLevel: number,
  maxLevel: number | null,
  avgDailyUsage: number
): StockUrgency {
  if (maxLevel && currentStock > maxLevel) return "OVERSTOCK";
  if (currentStock < avgDailyUsage) return "URGENT";
  if (currentStock < reorderPoint) return "RESTOCK_SOON";
  return "OK";
}
