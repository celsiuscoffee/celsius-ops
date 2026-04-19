/**
 * Google Ads API client
 *
 * Wraps the `google-ads-api` package with Celsius env-var conventions.
 *
 * Env vars required (Vercel):
 *   GOOGLE_ADS_DEVELOPER_TOKEN   — from API Center (MCC 415-243-7144)
 *   GOOGLE_ADS_CLIENT_ID         — reuse "Celsius Backoffice" OAuth client
 *   GOOGLE_ADS_CLIENT_SECRET
 *   GOOGLE_ADS_REFRESH_TOKEN     — generated once via OAuth Playground with adwords scope
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID — MCC customer id, digits only: "4152437144"
 */

import { GoogleAdsApi, Customer } from "google-ads-api";

let cachedApi: GoogleAdsApi | null = null;

export function getAdsApi(): GoogleAdsApi {
  if (cachedApi) return cachedApi;

  const { GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET } = process.env;

  if (!GOOGLE_ADS_DEVELOPER_TOKEN || !GOOGLE_ADS_CLIENT_ID || !GOOGLE_ADS_CLIENT_SECRET) {
    throw new Error(
      "Google Ads credentials missing: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET",
    );
  }

  cachedApi = new GoogleAdsApi({
    client_id: GOOGLE_ADS_CLIENT_ID,
    client_secret: GOOGLE_ADS_CLIENT_SECRET,
    developer_token: GOOGLE_ADS_DEVELOPER_TOKEN,
  });
  return cachedApi;
}

/**
 * Get a Customer object scoped to a specific Ads account.
 * Always passes login_customer_id = MCC, so dev token is valid.
 */
export function getCustomer(customerId: string): Customer {
  const { GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_LOGIN_CUSTOMER_ID } = process.env;
  if (!GOOGLE_ADS_REFRESH_TOKEN || !GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    throw new Error(
      "Google Ads OAuth missing: GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_LOGIN_CUSTOMER_ID",
    );
  }

  return getAdsApi().Customer({
    customer_id: customerId.replace(/-/g, ""),
    login_customer_id: GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    refresh_token: GOOGLE_ADS_REFRESH_TOKEN,
  });
}

/**
 * The MCC Customer itself — used to list child accounts.
 */
export function getMccCustomer(): Customer {
  const { GOOGLE_ADS_LOGIN_CUSTOMER_ID } = process.env;
  if (!GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    throw new Error("GOOGLE_ADS_LOGIN_CUSTOMER_ID missing");
  }
  return getCustomer(GOOGLE_ADS_LOGIN_CUSTOMER_ID);
}

// ─── Helpers ──────────────────────────────────────────────

/** Convert micros (bigint) to MYR number. */
export function microsToMYR(micros: bigint | number | null | undefined): number {
  if (micros == null) return 0;
  const n = typeof micros === "bigint" ? Number(micros) : micros;
  return n / 1_000_000;
}

/** Convert Google Ads date string (YYYY-MM-DD or YYYYMMDD) to Date. */
export function parseAdsDate(s: string): Date {
  if (s.includes("-")) return new Date(s + "T00:00:00Z");
  return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`);
}
