import { NextRequest, NextResponse } from 'next/server';
import { sendSMS, getSMSProvider } from '@/lib/loyalty/sms';
import { supabaseAdmin } from '@/lib/loyalty/supabase';
import { requireAuth } from '@/lib/auth';

// POST /api/loyalty/sms/test — send a single test SMS and return detailed diagnostics
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const { phone, message, sender_id } = await request.json();

    if (!phone || !message) {
      return NextResponse.json({ success: false, error: 'phone and message required' }, { status: 400 });
    }

    const provider = (process.env.SMS_PROVIDER || 'console').trim();
    const apiKey = process.env.SMS123_API_KEY;
    const email = process.env.SMS123_EMAIL;

    // Diagnostics object
    const diagnostics = {
      provider,
      api_key_set: !!apiKey,
      api_key_prefix: apiKey ? `${apiKey.slice(0, 4)}...` : null,
      email_set: !!email,
      sender_id: sender_id || process.env.SMS123_SENDER_ID || 'CelsiusCoffee',
      sms123_balance: null as number | null,
      balance_error: null as string | null,
    };

    // Check SMS123 balance if configured
    if (apiKey && email) {
      try {
        const params = new URLSearchParams({ apiKey, email });
        const res = await fetch(`https://www.sms123.net/api/getBalance.php?${params.toString()}`);
        const data = await res.json();
        if (data.status === 'ok' && data.balance != null) {
          diagnostics.sms123_balance = parseFloat(String(data.balance).replace(/,/g, ''));
        } else {
          diagnostics.balance_error = data.statusMsg || 'Unknown error';
        }
      } catch (err) {
        diagnostics.balance_error = err instanceof Error ? err.message : 'Failed to fetch balance';
      }
    }

    // Auto-prepend RM0 prefix
    const senderLabel = sender_id || 'CelsiusCoffee';
    const SMS_PREFIX = `RM0 [${senderLabel}] `;
    const finalMessage = message.startsWith('RM0 ') ? message : `${SMS_PREFIX}${message}`;

    // Send the test SMS
    const result = await sendSMS(phone, finalMessage, sender_id ? { senderId: sender_id } : undefined);

    // Log to sms_logs
    await supabaseAdmin.from('sms_logs').insert({
      id: `sms-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      brand_id: 'brand-celsius',
      campaign_id: null,
      phone,
      message: finalMessage,
      status: result.success ? 'sent' : 'failed',
      provider: provider,
      provider_message_id: result.messageId || null,
      error: result.error || null,
    });

    return NextResponse.json({
      ...result,
      message_sent: finalMessage,
      diagnostics,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// GET /api/loyalty/sms/test — return SMS config diagnostics without sending
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const provider = (process.env.SMS_PROVIDER || 'console').trim();
    const apiKey = process.env.SMS123_API_KEY;
    const email = process.env.SMS123_EMAIL;

    const diagnostics: Record<string, unknown> = {
      provider,
      provider_raw_length: (process.env.SMS_PROVIDER || '').length,
      provider_trimmed_length: provider.length,
      api_key_set: !!apiKey,
      api_key_prefix: apiKey ? `${apiKey.slice(0, 4)}...` : null,
      email_set: !!email,
      email_value: email || null,
      sender_id: process.env.SMS123_SENDER_ID || '(default: CelsiusCoffee)',
      sms123_balance: null,
      balance_error: null,
    };

    // Check SMS123 balance
    if (apiKey && email) {
      try {
        const params = new URLSearchParams({ apiKey, email });
        const res = await fetch(`https://www.sms123.net/api/getBalance.php?${params.toString()}`);
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          if (data.status === 'ok' && data.balance != null) {
            diagnostics.sms123_balance = parseFloat(String(data.balance).replace(/,/g, ''));
          } else {
            diagnostics.balance_error = data.statusMsg || 'Unknown error';
          }
          diagnostics.balance_raw_response = data;
        } catch {
          diagnostics.balance_error = `Non-JSON response: ${text.slice(0, 200)}`;
        }
      } catch (err) {
        diagnostics.balance_error = err instanceof Error ? err.message : 'Request failed';
      }
    } else {
      diagnostics.balance_error = 'SMS123_API_KEY or SMS123_EMAIL not configured';
    }

    // Recent test SMS logs
    const { data: recentTests } = await supabaseAdmin
      .from('sms_logs')
      .select('*')
      .like('id', 'sms-test-%')
      .order('created_at', { ascending: false })
      .limit(10);

    diagnostics.recent_test_logs = recentTests ?? [];

    return NextResponse.json(diagnostics);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
