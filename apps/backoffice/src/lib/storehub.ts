/**
 * StoreHub BackOffice API client.
 *
 * Base URL: https://api.storehubhq.com
 * Auth: Basic HTTP (accountId:apiKey)
 * Rate limit: 3 req/s → 350ms delay between calls
 * Max 5000 transactions per call → chunk large date ranges into 2-week windows
 */

const BASE_URL = "https://api.storehubhq.com";
const MAX_TXN_PER_CALL = 5000;
const CHUNK_DAYS = 14; // 2-week windows to stay under 5000 limit
const RATE_LIMIT_MS = 350;

function getAuthHeader(): string {
  const accountId = process.env.STOREHUB_ACCOUNT_ID;
  const apiKey = process.env.STOREHUB_API_KEY;
  if (!accountId || !apiKey) {
    throw new Error("Missing STOREHUB_ACCOUNT_ID or STOREHUB_API_KEY env vars");
  }
  const encoded = Buffer.from(`${accountId}:${apiKey}`).toString("base64");
  return `Basic ${encoded}`;
}

async function apiFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, BASE_URL);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`StoreHub API ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Format date as YYYY-MM-DD in MYT (UTC+8) */
function formatDate(d: Date): string {
  const myt = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return myt.toISOString().split("T")[0];
}

// ─── Types ───────────────────────────────────────────────────

export interface StoreHubTransactionItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  total: number;
  productId?: string;
}

export interface StoreHubTransaction {
  refId: string;
  total: number;
  subTotal: number;
  items: StoreHubTransactionItem[];
  channel?: string;
  isCancelled?: boolean;
  transactionTime?: string;
  createdAt?: string;
  completedAt?: string;
}

export interface StoreHubStore {
  id: string;
  name: string;
}

export interface StoreHubProduct {
  id: string;
  name: string;
  sku?: string;
  barcode?: string;
  category?: string;
  unitPrice?: number;
  cost?: number;
}

// ─── API Methods ─────────────────────────────────────────────

/** List all stores/outlets */
export async function getStores(): Promise<StoreHubStore[]> {
  return apiFetch<StoreHubStore[]>("/stores");
}

/** List all products from StoreHub catalog */
export async function getProducts(): Promise<StoreHubProduct[]> {
  return apiFetch<StoreHubProduct[]>("/products");
}

/**
 * Fetch transactions for a date range, auto-chunking into 2-week windows
 * to stay under the 5000-per-call limit.
 */
export async function getTransactions(
  storeId: string,
  from: Date,
  to: Date,
): Promise<StoreHubTransaction[]> {
  const all: StoreHubTransaction[] = [];
  let windowStart = new Date(from);

  while (windowStart < to) {
    const windowEnd = new Date(windowStart);
    windowEnd.setDate(windowEnd.getDate() + CHUNK_DAYS);
    if (windowEnd > to) windowEnd.setTime(to.getTime());

    const chunk = await apiFetch<StoreHubTransaction[]>("/transactions", {
      storeId,
      from: formatDate(windowStart),
      to: formatDate(windowEnd),
    });

    const valid = chunk.filter((t) => !t.isCancelled);
    all.push(...valid);

    // Warn if we hit the limit — data may be truncated
    if (chunk.length >= MAX_TXN_PER_CALL) {
      console.warn(
        `⚠️  Hit ${MAX_TXN_PER_CALL} transaction limit for ${formatDate(windowStart)}–${formatDate(windowEnd)}. Some data may be missing.`,
      );
    }

    windowStart = new Date(windowEnd);
    windowStart.setDate(windowStart.getDate() + 1);
    await sleep(RATE_LIMIT_MS);
  }

  return all;
}
