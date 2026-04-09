/**
 * StoreHub REST API client (READ-ONLY)
 * Docs: StoreHub APIs - Public Version.pdf
 * Auth: Basic Auth — username: store subdomain, password: API token
 * Rate limit: 3 requests/second
 * Host: api.storehubhq.com (no version prefix)
 */

const STOREHUB_API_BASE = "https://api.storehubhq.com";
// .trim() guards against accidental trailing newlines in env var values
const API_KEY = process.env.STOREHUB_API_KEY?.trim();

function getAuthHeader(): string {
  if (!API_KEY) throw new Error("STOREHUB_API_KEY not set");
  // API_KEY format: "username:password"
  return `Basic ${Buffer.from(API_KEY).toString("base64")}`;
}

async function storehubFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${STOREHUB_API_BASE}${path}`, {
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    next: { revalidate: 600 }, // cache 10 min
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
  priceDifference: number; // added to unitPrice to get variant price
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
  category: string;        // category NAME (not ID)
  subCategory?: string;
  tags?: string[];
  priceType: "Fixed" | "Variable";
  unitPrice: number;       // in RM
  cost?: number | null;
  trackStockLevel: boolean;
  isParentProduct: boolean;
  variantGroups?: StoreHubVariantGroup[];  // only on parent products
  parentProductId?: string;               // only on child products
}

export interface StoreHubStore {
  id: string;
  name: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  phone?: string;
  email?: string;
  website?: string;
}

export interface StoreHubInventory {
  productId: string;
  quantityOnHand: number;
  warningStock?: number;
  idealStock?: number;
}

/**
 * Returns flat array of products directly (no wrapper object).
 * Transfer-Encoding is chunked per the docs.
 */
export async function getProducts(): Promise<StoreHubProduct[]> {
  return storehubFetch<StoreHubProduct[]>("/products");
}

export async function getStores(): Promise<StoreHubStore[]> {
  return storehubFetch<StoreHubStore[]>("/stores");
}

export async function getInventory(storeId: string): Promise<StoreHubInventory[]> {
  return storehubFetch<StoreHubInventory[]>(`/inventory/${storeId}`);
}
