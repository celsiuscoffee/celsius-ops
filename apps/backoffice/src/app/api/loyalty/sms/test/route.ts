import { NextRequest, NextResponse } from 'next/server';
import { sendSMS, providerAutoPrependsSender, getActiveSmsProvider } from '@/lib/loyalty/sms';
import { supabaseAdmin } from '@/lib/loyalty/supabase';
import { requireAuth } from '@/lib/auth';

// Build provider-aware config diagnostics for whichever gateway is active
// (resolved from the app_settings.sms_provider toggle). Used by both the GET
// diagnostics endpoint and the POST send response.
async function buildDiagnostics(provider: string): Promise<Record<string, unknown>> {
  const d: Record<string, unknown> = {
    provider,
    configured: false,
    api_key_set: false,
    api_key_prefix: null as string | null,
    sender_id: '',
    balance: null as string | null,
    balance_error: null as string | null,
    email_set: false,
    email_value: null as string | null,
    endpoint: null as string | null,
  };

  if (provider === 'smsniaga') {
    const apiKey = process.env.SMSNIAGA_API_KEY;
    d.api_key_set = !!apiKey;
    d.api_key_prefix = apiKey ? `${apiKey.slice(0, 4)}...` : null;
    d.sender_id = process.env.SMSNIAGA_SENDER_ID || 'CELSIUSCOFFEE (account default)';
    d.endpoint = process.env.SMSNIAGA_API_URL || 'https://manage.smsniaga.com/api/send';
    d.configured = !!apiKey;
    if (apiKey) {
      try {
        const res = await fetch('https://manage.smsniaga.com/api/balance', {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        });
        const data = await res.json().catch(() => ({}));
        // { balance: { cents, human: "RM36.80", currency: "MYR" } }
        if (res.ok && data?.balance?.human) {
          d.balance = String(data.balance.human);
        } else {
          d.balance_error = data?.message || `HTTP ${res.status}`;
        }
      } catch (err) {
        d.balance_error = err instanceof Error ? err.message : 'Failed to fetch balance';
      }
    } else {
      d.balance_error = 'SMSNIAGA_API_KEY not configured';
    }
  } else if (provider === 'sms123') {
    const apiKey = process.env.SMS123_API_KEY;
    const email = process.env.SMS123_EMAIL;
    d.api_key_set = !!apiKey;
    d.api_key_prefix = apiKey ? `${apiKey.slice(0, 4)}...` : null;
    d.email_set = !!email;
    d.email_value = email || null;
    d.sender_id = process.env.SMS123_SENDER_ID || 'CelsiusCoffee (default)';
    d.endpoint = 'https://www.sms123.net/api/send.php';
    d.configured = !!(apiKey && email);
    if (apiKey && email) {
      try {
        const params = new URLSearchParams({ apiKey, email });
        const res = await fetch(`https://www.sms123.net/api/getBalance.php?${params.toString()}`);
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          if (data.status === 'ok' && data.balance != null) {
            d.balance = `${parseFloat(String(data.balance).replace(/,/g, '')).toLocaleString()} credits`;
          } else {
            d.balance_error = data.statusMsg || 'Unknown error';
          }
        } catch {
          d.balance_error = `Non-JSON response: ${text.slice(0, 120)}`;
        }
      } catch (err) {
        d.balance_error = err instanceof Error ? err.message : 'Request failed';
      }
    } else {
      d.balance_error = 'SMS123_API_KEY or SMS123_EMAIL not configured';
    }
  } else {
    // console (dev)
    d.configured = true;
    d.sender_id = '(dev console — logs only)';
    d.balance = 'n/a (console)';
  }

  const { data: recentTests } = await supabaseAdmin
    .from('sms_logs')
    .select('*')
    .like('id', 'sms-test-%')
    .order('created_at', { ascending: false })
    .limit(10);
  d.recent_test_logs = recentTests ?? [];

  return d;
}

// POST /api/loyalty/sms/test — send a single test SMS and return diagnostics
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const { phone, message, sender_id } = await request.json();

    if (!phone || !message) {
      return NextResponse.json({ success: false, error: 'phone and message required' }, { status: 400 });
    }

    const provider = await getActiveSmsProvider();

    // Auto-prepend RM0 prefix for providers that need it (SMS123). SMS Niaga
    // adds its own "RM0 <SenderID>:" at the gateway, so skip ours there.
    const senderLabel = sender_id || 'CelsiusCoffee';
    const SMS_PREFIX = `RM0 [${senderLabel}] `;
    const finalMessage =
      providerAutoPrependsSender(provider) || message.startsWith('RM0 ') ? message : `${SMS_PREFIX}${message}`;

    // SMS Niaga needs a registered Sender ID, so don't forward a free-text label.
    const result = await sendSMS(phone, finalMessage, {
      provider,
      ...(!providerAutoPrependsSender(provider) && sender_id ? { senderId: sender_id } : {}),
    });

    await supabaseAdmin.from('sms_logs').insert({
      id: `sms-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      brand_id: 'brand-celsius',
      campaign_id: null,
      phone,
      message: finalMessage,
      status: result.success ? 'sent' : 'failed',
      provider,
      provider_message_id: result.messageId || null,
      error: result.error || null,
    });

    return NextResponse.json({
      ...result,
      message_sent: finalMessage,
      diagnostics: await buildDiagnostics(provider),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// GET /api/loyalty/sms/test — return active-provider config diagnostics (no send)
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const provider = await getActiveSmsProvider();
    return NextResponse.json(await buildDiagnostics(provider));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
