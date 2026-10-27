// NTT Data payment gateway client for Celsius Coffee
// Supports three merchant locations with independent API keys

import { createHmac } from "crypto";

// Per-outlet NTT Data merchant keys. Each Celsius location has its own
// merchant ID for NTT Data, enabling independent transaction routing
// and settlement to the correct entity's bank account.
//
// Keys are our orders.store_id slugs; values are NTT Data merchant IDs.
// Store IDs can be overridden via NTT_DATA_MERCHANT_MAP environment variable (JSON).
const PROD_MERCHANT_MAP: Record<string, string> = {
  "shah-alam": "A43o3PgA4V",    // CELSIUS COFFEE SDN. BHD.
  "conezion":  "9PGYL7OoVg",    // CELSIUS COFFEE CONEZION
  "tamarind":  "1laPVe4zde",    // CELSIUS COFFEE TAMARIND
};

// NTT Data API configuration
const NTT_DATA_BASE_URL = (process.env.NTT_DATA_BASE_URL || "https://api.nttdata.my").trim();
const NTT_DATA_API_KEY = (process.env.NTT_DATA_API_KEY || "").trim();

// Timeout for NTT Data requests (milliseconds)
const NTT_DATA_TIMEOUT_MS = 8000;

function resolveNttDataMerchantId(appStoreId: string): string {
  if (process.env.NTT_DATA_MERCHANT_MAP) {
    try {
      const map = JSON.parse(process.env.NTT_DATA_MERCHANT_MAP) as Record<string, string>;
      if (map[appStoreId]) return map[appStoreId];
    } catch {
      console.warn("[ntt-data] NTT_DATA_MERCHANT_MAP is not valid JSON — ignoring");
    }
  }
  return PROD_MERCHANT_MAP[appStoreId] || PROD_MERCHANT_MAP["shah-alam"];
}

export interface NttDataPaymentRequest {
  amount: number; // Amount in smallest currency unit (sen for MYR)
  currency: string; // e.g., "MYR"
  orderId: string;
  description: string;
  customerEmail?: string;
  customerPhone?: string;
  returnUrl?: string;
  notificationUrl?: string;
}

export interface NttDataPaymentResponse {
  success: boolean;
  transactionId?: string;
  paymentUrl?: string;
  redirectUrl?: string;
  status?: string;
  error?: string;
}

/**
 * Create a payment request with NTT Data
 * Routes to the correct merchant based on the store ID
 */
export async function createNttDataPayment(
  storeId: string,
  paymentRequest: NttDataPaymentRequest
): Promise<NttDataPaymentResponse> {
  const merchantId = resolveNttDataMerchantId(storeId);

  if (!NTT_DATA_API_KEY) {
    throw new Error("NTT_DATA_API_KEY is not configured");
  }

  try {
    const response = await fetch(`${NTT_DATA_BASE_URL}/v1/payments/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NTT_DATA_API_KEY}`,
        "X-Merchant-Id": merchantId,
      },
      body: JSON.stringify({
        amount: paymentRequest.amount,
        currency: paymentRequest.currency,
        orderId: paymentRequest.orderId,
        description: paymentRequest.description,
        customerEmail: paymentRequest.customerEmail,
        customerPhone: paymentRequest.customerPhone,
        returnUrl: paymentRequest.returnUrl,
        notificationUrl: paymentRequest.notificationUrl,
      }),
      signal: AbortSignal.timeout(NTT_DATA_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error(`[ntt-data] Payment creation failed: ${response.status}`, errorText);
      throw new Error(`NTT Data payment failed: ${response.status} ${errorText.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      success?: boolean;
      transactionId?: string;
      paymentUrl?: string;
      redirectUrl?: string;
      status?: string;
      error?: string;
    };

    return {
      success: data.success ?? false,
      transactionId: data.transactionId,
      paymentUrl: data.paymentUrl,
      redirectUrl: data.redirectUrl,
      status: data.status,
      error: data.error,
    };
  } catch (error) {
    console.error("[ntt-data] Payment creation error:", error);
    throw error;
  }
}

/**
 * Query payment status from NTT Data
 */
export async function queryNttDataPaymentStatus(
  storeId: string,
  transactionId: string
): Promise<{ status: string; success: boolean; error?: string }> {
  const merchantId = resolveNttDataMerchantId(storeId);

  if (!NTT_DATA_API_KEY) {
    throw new Error("NTT_DATA_API_KEY is not configured");
  }

  try {
    const response = await fetch(
      `${NTT_DATA_BASE_URL}/v1/payments/${transactionId}/status`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${NTT_DATA_API_KEY}`,
          "X-Merchant-Id": merchantId,
        },
        signal: AbortSignal.timeout(NTT_DATA_TIMEOUT_MS),
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`NTT Data status query failed: ${response.status} ${errorText.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      status?: string;
      success?: boolean;
      error?: string;
    };

    return {
      status: data.status || "unknown",
      success: data.success ?? false,
      error: data.error,
    };
  } catch (error) {
    console.error("[ntt-data] Status query error:", error);
    throw error;
  }
}

/**
 * Verify webhook signature from NTT Data
 * This should be called before processing webhook events
 */
export function verifyNttDataWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return signature === expectedSignature;
}
