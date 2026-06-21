// ==========================================
// SMS Provider Interface
// Pluggable SMS gateway. The active provider is resolved at runtime from the
// `app_settings.sms_provider` row (see resolveSmsProvider) so it can be toggled
// from the backoffice without a redeploy; the SMS_PROVIDER env var is the
// fallback default.
// ==========================================

// Type-only import — erased at compile time, so this never pulls the Supabase
// client into Edge/middleware bundles.
import type { SupabaseClient } from '@supabase/supabase-js';

export type SMSProviderName = 'smsniaga' | 'sms123' | 'console';

export interface SMSProvider {
  sendSMS(phone: string, message: string, opts?: { senderId?: string }): Promise<{ success: boolean; messageId?: string; error?: string }>;
}

// ─── Console Provider (Development) ──────────────────
// Logs SMS to console instead of sending — for development/testing
class ConsoleSMSProvider implements SMSProvider {
  async sendSMS(phone: string, message: string) {
    console.log(`\n📱 SMS to ${phone}:\n${message}\n`);
    return { success: true, messageId: `dev-${Date.now()}` };
  }
}

// ─── SMS Niaga Provider ────────────────────────────────
// Malaysian SMS gateway — https://smsniaga.com
class SMSNiagaProvider implements SMSProvider {
  private apiUrl: string;
  private apiKey: string;
  private senderId: string;

  constructor() {
    // SMS Niaga v2 REST API. Auth is a single Bearer token created at
    // manage.smsniaga.com → Profile → API Token. Endpoint + contract:
    // https://smsniaga.stoplight.io/docs/api-reference (POST /api/send).
    this.apiUrl = process.env.SMSNIAGA_API_URL || 'https://manage.smsniaga.com/api/send';
    this.apiKey = process.env.SMSNIAGA_API_KEY || '';
    // Leave blank to use the account's default registered Sender ID
    // (e.g. "CELSIUS COFFEE SDN. BHD."). Must match a registered Sender ID.
    this.senderId = process.env.SMSNIAGA_SENDER_ID || '';
  }

  // SMS Niaga expects MSISDN in 60XXXXXXXXX form (no leading +).
  private formatPhone(phone: string): string {
    let cleaned = phone.replace(/[\s\-()]/g, '');
    if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
    if (cleaned.startsWith('60')) return cleaned;
    if (cleaned.startsWith('0')) return `60${cleaned.slice(1)}`;
    return cleaned;
  }

  async sendSMS(phone: string, message: string, opts?: { senderId?: string }) {
    if (!this.apiKey) {
      console.error('SMS Niaga: Missing SMSNIAGA_API_KEY');
      return { success: false, error: 'SMS Niaga API token not configured' };
    }

    const to = this.formatPhone(phone);
    const senderId = opts?.senderId || this.senderId;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          body: message,
          phones: [to],
          // preview must be 0 to actually send; 1 = dry-run preview only.
          preview: 0,
          ...(senderId ? { sender_id: senderId } : {}),
        }),
      });

      const rawBody = await response.text();
      let data: {
        data?: { uuid?: string; total_charge?: number; credit_balance_after?: string };
        message?: string;
        error?: string;
      } = {};
      try {
        data = JSON.parse(rawBody);
      } catch {
        // Non-JSON response — keep rawBody for the error string below.
      }

      if (!response.ok) {
        const detail = data.message || data.error || `HTTP ${response.status}: ${rawBody.slice(0, 200)}`;
        console.error(`SMS Niaga error (${response.status}): ${detail}`);
        return { success: false, error: `SMS Niaga: ${detail}` };
      }

      const messageId = data.data?.uuid;
      console.log(
        `SMS Niaga: sent (uuid: ${messageId}, charge: ${data.data?.total_charge}, balance after: ${data.data?.credit_balance_after})`,
      );
      return { success: true, messageId };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error(`SMS Niaga: Failed to send SMS — ${errorMessage}`);
      return { success: false, error: `SMS Niaga request failed: ${errorMessage}` };
    }
  }
}

// ─── SMS123 Provider ─────────────────────────────────
// Malaysian SMS gateway — https://www.sms123.net
class SMS123Provider implements SMSProvider {
  private apiKey: string;
  private senderId: string;

  constructor() {
    this.apiKey = process.env.SMS123_API_KEY || '';
    this.senderId = process.env.SMS123_SENDER_ID || 'CelsiusCoffee';
  }

  private formatPhone(phone: string): string {
    let cleaned = phone.replace(/[\s\-()]/g, '');
    if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
    if (cleaned.startsWith('60')) return cleaned;
    if (cleaned.startsWith('0')) return `60${cleaned.slice(1)}`;
    return cleaned;
  }

  async sendSMS(phone: string, message: string, opts?: { senderId?: string }) {
    if (!this.apiKey) {
      console.error('SMS123: Missing SMS123_API_KEY');
      return { success: false, error: 'SMS123 API key not configured' };
    }

    const to = this.formatPhone(phone);
    const refId = `cel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sid = opts?.senderId || this.senderId;

    try {
      const params = new URLSearchParams({
        apiKey: this.apiKey,
        recipients: to,
        messageContent: message,
        referenceID: refId,
        ...(sid ? { senderID: sid } : {}),
      });

      const response = await fetch(`https://www.sms123.net/api/send.php?${params.toString()}`, {
        method: 'POST',
      });

      const rawBody = await response.text();
      let data: { status?: string; statusMsg?: string; msgCode?: string | number; balance?: string; referenceID?: string[] } = {};
      try {
        data = JSON.parse(rawBody);
      } catch {
        // Non-JSON response — keep rawBody for the error string below.
      }

      // SMS123 has been observed returning success with non-`ok` status strings
      // (e.g. `OK`, `success`) while the message is still queued. Treat any
      // response that returned a referenceID as a successful send, and log the
      // full payload otherwise so failures are diagnosable.
      const lowerStatus = (data.status ?? '').toLowerCase();
      const succeeded = lowerStatus === 'ok' || lowerStatus === 'success' || (Array.isArray(data.referenceID) && data.referenceID.length > 0);

      if (succeeded) {
        const msgId = data.referenceID?.[0] || refId;
        console.log(`SMS123: Message sent successfully (ID: ${msgId}, balance: ${data.balance})`);
        return { success: true, messageId: msgId };
      }

      const errorDetail = data.statusMsg
        ? `${data.statusMsg} (code ${data.msgCode ?? '?'}, status ${data.status ?? '?'})`
        : `HTTP ${response.status}: ${rawBody.slice(0, 200)}`;
      console.error(`SMS123 error: ${errorDetail}`);
      return { success: false, error: `SMS123: ${errorDetail}` };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error(`SMS123: Failed to send SMS — ${errorMessage}`);
      return { success: false, error: `SMS123 request failed: ${errorMessage}` };
    }
  }
}

// ─── Provider Factory ────────────────────────────────
export function getSMSProvider(name?: string): SMSProvider {
  // Explicit name (from the app_settings toggle) wins; else fall back to env.
  const provider = (name || process.env.SMS_PROVIDER || 'console').trim().toLowerCase();

  switch (provider) {
    case 'smsniaga':
      return new SMSNiagaProvider();
    case 'sms123':
      return new SMS123Provider();
    default:
      if (provider !== 'console') {
        console.warn(`Unknown SMS_PROVIDER "${provider}", falling back to console`);
      }
      return new ConsoleSMSProvider();
  }
}

// ─── Convenience function ────────────────────────────
// opts.provider overrides which gateway to use (from the app_settings toggle);
// without it, getSMSProvider falls back to the SMS_PROVIDER env var.
export async function sendSMS(
  phone: string,
  message: string,
  opts?: { senderId?: string; provider?: string },
) {
  const provider = getSMSProvider(opts?.provider);
  return provider.sendSMS(phone, message, opts);
}

// ─── Sender-prefix behaviour ─────────────────────────
// SMS Niaga prepends "RM0.00 <SenderID>:" to every message body at the gateway,
// and only accepts a registered Sender ID. So on SMS Niaga, app code must NOT
// add its own "RM0 [label]" prefix (it would double up) and must NOT pass a
// free-text sender label. Other providers (e.g. SMS123) still need the app to
// add the "RM0 [label]" prefix itself. Pass the active provider name (from the
// toggle); falls back to the SMS_PROVIDER env var.
export function providerAutoPrependsSender(provider?: string): boolean {
  return (provider || process.env.SMS_PROVIDER || 'console').trim().toLowerCase() === 'smsniaga';
}

// ─── Active-provider resolver ────────────────────────
// Reads the `app_settings.sms_provider` row (set from the backoffice
// Integrations toggle) and returns the active gateway name. Falls back to the
// SMS_PROVIDER env var, then 'console'. Pass the Supabase admin client the
// caller already holds — keeps this package free of a runtime Supabase import.
export async function resolveSmsProvider(supabase: SupabaseClient): Promise<SMSProviderName> {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'sms_provider')
      .maybeSingle();
    const v = (data?.value ?? '').toString().trim().toLowerCase();
    if (v === 'smsniaga' || v === 'sms123' || v === 'console') return v;
  } catch {
    // fall through to env default
  }
  const env = (process.env.SMS_PROVIDER || 'console').trim().toLowerCase();
  return env === 'smsniaga' || env === 'sms123' ? env : 'console';
}
