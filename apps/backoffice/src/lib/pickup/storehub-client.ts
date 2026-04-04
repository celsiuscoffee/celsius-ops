/**
 * StoreHub REST API client (READ-ONLY) — for pickup sync-storehub route.
 * Auth: Basic Auth — username: store subdomain, password: API token
 * Rate limit: 3 requests/second
 */

const STOREHUB_API_BASE = "https://api.storehubhq.com";
const API_KEY = process.env.STOREHUB_API_KEY?.trim();

function getAuthHeader(): string {
  if (!API_KEY) throw new Error("STOREHUB_API_KEY not set");
  return `Basic ${Buffer.from(API_KEY).toString("base64")}`;
}

async function storehubFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${STOREHUB_API_BASE}${path}`, {
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    next: { revalidate: 600 },
  });

  if (!res.ok) {
    throw new Error(`StoreHub API error: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

export interface StoreHubVariantOption {
  id: string;
  optionValue: string;
  isDefault: boolean;
  priceDifference: number;
}

export interface StoreHubVariantGroup {
  id: string;
  name: string;
  options: StoreHubVariantOption[];
}

export interface StoreHubProduct {
  id: string;
  name: string;
  sku?: string;
  barcode?: string;
  category: string;
  subCategory?: string;
  tags?: string[];
  priceType: "Fixed" | "Variable";
  unitPrice: number;
  cost?: number | null;
  trackStockLevel: boolean;
  isParentProduct: boolean;
  variantGroups?: StoreHubVariantGroup[];
  parentProductId?: string;
}

export interface StoreHubInventory {
  productId: string;
  quantityOnHand: number;
  warningStock?: number;
  idealStock?: number;
}

export async function getProducts(): Promise<StoreHubProduct[]> {
  return storehubFetch<StoreHubProduct[]>("/products");
}

export async function getInventory(storeId: string): Promise<StoreHubInventory[]> {
  return storehubFetch<StoreHubInventory[]>(`/inventory/${storeId}`);
}
