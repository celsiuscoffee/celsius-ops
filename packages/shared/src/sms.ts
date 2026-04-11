// ==========================================
// SMS Provider Interface
// Pluggable SMS gateway — swap providers by changing SMS_PROVIDER env var
// ==========================================

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
  private username: string;
  private apiKey: string;
  private senderId: string;

  constructor() {
    this.apiUrl = process.env.SMSNIAGA_API_URL || 'https://api.smsniaga.com/v1/send';
    this.username = process.env.SMSNIAGA_USERNAME || '';
    this.apiKey = process.env.SMSNIAGA_API_KEY || '';
    this.senderId = process.env.SMSNIAGA_SENDER_ID || 'CelsiusCoffee';
  }

  private formatPhone(phone: string): string {
    let cleaned = phone.replace(/[\s\-()]/g, '');
    if (cleaned.startsWith('+60')) return cleaned;
    if (cleaned.startsWith('60')) return `+${cleaned}`;
    if (cleaned.startsWith('0')) return `+60${cleaned.slice(1)}`;
    return cleaned;
  }

  async sendSMS(phone: string, message: string) {
    if (!this.username || !this.apiKey) {
      console.error('SMS Niaga: Missing SMSNIAGA_USERNAME or SMSNIAGA_API_KEY');
      return { success: false, error: 'SMS Niaga credentials not configured' };
    }

    const to = this.formatPhone(phone);
    const authToken = Buffer.from(`${this.username}:${this.apiKey}`).toString('base64');

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authToken}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          to,
          message,
          from: this.senderId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error(`SMS Niaga error (${response.status}): ${errorText}`);
        return { success: false, error: `SMS Niaga error: ${response.status}` };
      }

      const data = await response.json();
      console.log(`SMS Niaga: Message sent successfully (ID: ${data.message_id})`);
      return { success: true, messageId: data.message_id };
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

      const data = await response.json();

      if (data.status === 'ok') {
        const msgId = data.referenceID?.[0] || refId;
        console.log(`SMS123: Message sent successfully (ID: ${msgId}, balance: ${data.balance})`);
        return { success: true, messageId: msgId };
      } else {
        console.error(`SMS123 error: ${data.statusMsg} (${data.msgCode})`);
        return { success: false, error: `SMS123: ${data.statusMsg}` };
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error(`SMS123: Failed to send SMS — ${errorMessage}`);
      return { success: false, error: `SMS123 request failed: ${errorMessage}` };
    }
  }
}

// ─── Provider Factory ────────────────────────────────
export function getSMSProvider(): SMSProvider {
  const provider = (process.env.SMS_PROVIDER || 'console').trim().toLowerCase();

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
export async function sendSMS(phone: string, message: string, opts?: { senderId?: string }) {
  const provider = getSMSProvider();
  return provider.sendSMS(phone, message, opts);
}
