// ==========================================
// StoreHub POS API Client
// Connects to StoreHub to pull transaction data
// for auto-awarding loyalty points
// ==========================================

export interface StoreHubTransaction {
  _id: string;
  transactionTime: string; // ISO timestamp
  total: number;
  totalAmount?: number;
  grandTotal?: number;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
  }>;
  isCancelled: boolean;
  transactionType: string; // "Sale", "Refund", etc.
  payments: Array<{
    type: string;
    amount: number;
  }>;
  tableId?: string;
  storeId: string;
}

export interface StoreHubMatchResult {
  success: boolean;
  transaction?: StoreHubTransaction;
  amount?: number;
  points_awarded?: number;
  message?: string;
}

const API_URL = process.env.STOREHUB_API_URL || "https://api.storehubhq.com";
const USERNAME = process.env.STOREHUB_USERNAME || "";
const API_KEY = process.env.STOREHUB_API_KEY || "";

function getAuthHeader(): string {
  const credentials = Buffer.from(`${USERNAME}:${API_KEY}`).toString("base64");
  return `Basic ${credentials}`;
}

/**
 * Fetch recent transactions from a StoreHub store
 * @param storeId - StoreHub store ID
 * @param minutesBack - How many minutes back to look (default 10)
 */
export async function fetchRecentTransactions(
  storeId: string,
  minutesBack = 10
): Promise<StoreHubTransaction[]> {
  const now = new Date();
  const from = new Date(now.getTime() - minutesBack * 60 * 1000);

  // Format dates for StoreHub API (YYYY-MM-DD)
  const fromDate = from.toISOString().split("T")[0];
  const toDate = now.toISOString().split("T")[0];

  const url = `${API_URL}/transactions?storeId=${storeId}&from=${fromDate}&to=${toDate}&includeOnline=false`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: getAuthHeader(),
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000), // 15s timeout
    });

    if (!response.ok) {
      console.error(
        `StoreHub API error: ${response.status} ${response.statusText}`
      );
      return [];
    }

    const data = await response.json();
    const transactions: StoreHubTransaction[] = Array.isArray(data)
      ? data
      : data.transactions || [];

    // Filter: only valid sales within the time window
    const cutoff = from.getTime();
    return transactions.filter((txn) => {
      if (txn.isCancelled) return false;
      if (txn.transactionType !== "Sale") return false;
      const txnTime = new Date(txn.transactionTime).getTime();
      if (txnTime < cutoff) return false;
      return true;
    });
  } catch (error) {
    console.error("StoreHub API fetch error:", error);
    return [];
  }
}

/**
 * Get the transaction amount (handles different StoreHub field names)
 */
export function getTransactionAmount(txn: StoreHubTransaction): number {
  return txn.grandTotal ?? txn.totalAmount ?? txn.total ?? 0;
}

/**
 * Test the StoreHub API connection
 */
export async function testConnection(): Promise<{
  connected: boolean;
  message: string;
}> {
  try {
    // Try fetching transactions for any store to test auth
    const response = await fetch(`${API_URL}/transactions?limit=1`, {
      headers: {
        Authorization: getAuthHeader(),
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      return { connected: true, message: "Connected to StoreHub" };
    } else {
      return {
        connected: false,
        message: `Auth failed: ${response.status}`,
      };
    }
  } catch (error) {
    return {
      connected: false,
      message: `Connection error: ${error}`,
    };
  }
}

/**
 * Fetch transaction count for a store on a given date range
 * Used for comparing POS orders vs loyalty registrations
 */
export async function fetchTransactionCount(
  storeId: string,
  fromDate: string,
  toDate: string
): Promise<{ count: number; total_sales: number }> {
  const url = `${API_URL}/transactions?storeId=${storeId}&from=${fromDate}&to=${toDate}&includeOnline=false`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: getAuthHeader(),
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000), // 15s timeout
    });

    if (!response.ok) return { count: 0, total_sales: 0 };

    const data = await response.json();
    const transactions: StoreHubTransaction[] = Array.isArray(data)
      ? data
      : data.transactions || [];

    const validSales = transactions.filter(
      (txn) => !txn.isCancelled && txn.transactionType === "Sale"
    );

    const total_sales = validSales.reduce(
      (sum, txn) => sum + getTransactionAmount(txn),
      0
    );

    return { count: validSales.length, total_sales };
  } catch {
    return { count: 0, total_sales: 0 };
  }
}

// ─── Matched transaction tracking (Supabase-backed) ──────
// Prevents the same StoreHub transaction from being matched twice
// Uses point_transactions.reference_id to check if a StoreHub txn was already used

export async function isTransactionMatched(txnId: string): Promise<boolean> {
  const { supabaseAdmin } = await import('./supabase');
  const { count } = await supabaseAdmin
    .from('point_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('reference_id', txnId);
  return (count ?? 0) > 0;
}

export function markTransactionMatched(_txnId: string): void {
  // No-op: the transaction is "marked" when the point_transaction record is created
  // with reference_id = txnId in the award endpoint
}
