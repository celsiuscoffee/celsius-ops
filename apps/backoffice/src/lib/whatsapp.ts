/**
 * WhatsApp Cloud API client for Celsius BackOffice.
 *
 * Official Meta WhatsApp Business Platform (Cloud API) — used for the internal
 * "looping": staff alerts, two-way customer-service replies, and POS/inventory
 * event notifications. App "Celsius Coffee Ops" + WABA under Celsius Coffee HQ.
 *
 * Env vars:
 *   WHATSAPP_PHONE_NUMBER_ID  – sender number's Phone Number ID (Graph path segment)
 *   WHATSAPP_ACCESS_TOKEN     – permanent System User token (whatsapp_business_messaging)
 *   WHATSAPP_WABA_ID          – WhatsApp Business Account id (template management)
 *   WHATSAPP_APP_SECRET       – Meta app secret, verifies inbound X-Hub-Signature-256
 *   WHATSAPP_VERIFY_TOKEN     – random string echoed back during webhook verification
 *
 * Setup state + ids: see memory/whatsapp-cloud-api-setup.md.
 */
import { createHmac, timingSafeEqual } from "crypto";

// Graph API version. v23.0 verified working against the Celsius WABA (2026-06).
const GRAPH_API_VERSION = "v23.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export function isWhatsAppConfigured(): boolean {
  return !!(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN);
}

/**
 * Verify Meta's X-Hub-Signature-256 over the RAW request body, keyed on the app
 * secret. The header format is "sha256=<hex>". Returns false when unconfigured
 * or mismatched. Timing-safe so a failed compare never leaks the expected value.
 */
export function verifyWhatsAppSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !signatureHeader) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  // timingSafeEqual throws on length mismatch — guard first.
  if (signatureHeader.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

export interface WhatsAppSendResult {
  ok: boolean;
  status: number;
  messageId?: string;
  error?: string;
}

export interface WhatsAppMedia {
  bytes: Buffer;
  mimeType: string;
}

/**
 * Download an inbound media object (invoice PDF, PoP image, …) by its media id.
 * Two-step per the Cloud API: GET /{media-id} returns a short-lived URL, which
 * must then be fetched with the same bearer token. Returns null on any failure
 * so callers can degrade gracefully (the agent falls back to a provisional
 * capture rather than throwing inside the webhook).
 */
export async function fetchWhatsAppMedia(mediaId: string): Promise<WhatsAppMedia | null> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token || !mediaId) return null;
  try {
    const metaRes = await fetch(`${GRAPH_BASE}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaRes.ok) return null;
    const meta = (await metaRes.json().catch(() => ({}))) as { url?: string; mime_type?: string };
    if (!meta.url) return null;
    // The media URL itself also requires the bearer token.
    const binRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!binRes.ok) return null;
    const arrayBuf = await binRes.arrayBuffer();
    return {
      bytes: Buffer.from(arrayBuf),
      mimeType: meta.mime_type?.split(";")[0]?.trim() || "application/octet-stream",
    };
  } catch {
    return null;
  }
}

async function postMessage(body: Record<string, unknown>): Promise<WhatsAppSendResult> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !token) {
    return {
      ok: false,
      status: 0,
      error: "WhatsApp not configured (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN)",
    };
  }
  const res = await fetch(`${GRAPH_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    messages?: Array<{ id: string }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    return { ok: false, status: res.status, error: json.error?.message || `HTTP ${res.status}` };
  }
  return { ok: true, status: res.status, messageId: json.messages?.[0]?.id };
}

/**
 * Send a free-form text message. ONLY valid inside an open 24-hour customer
 * service window (the recipient messaged us within the last 24h). For
 * business-initiated messages outside that window, use sendWhatsAppTemplate.
 * `to` may be passed in any human format ("+60 12-345 6789") — it's normalised.
 */
export function sendWhatsAppText(to: string, body: string): Promise<WhatsAppSendResult> {
  return postMessage({
    recipient_type: "individual",
    to: normalizeMsisdn(to),
    type: "text",
    text: { preview_url: false, body },
  });
}

/**
 * Send a pre-approved template message (business-initiated, works outside the
 * 24h window). `templateName` must be APPROVED in WhatsApp Manager. `components`
 * carries header/body variable substitutions per the Cloud API template schema.
 */
export function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  languageCode = "en",
  components?: unknown[],
): Promise<WhatsAppSendResult> {
  return postMessage({
    to: normalizeMsisdn(to),
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components && components.length ? { components } : {}),
    },
  });
}

/** Strip everything but digits so callers can pass "+60 12-345 6789". */
function normalizeMsisdn(to: string): string {
  return to.replace(/[^0-9]/g, "");
}
