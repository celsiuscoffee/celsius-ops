import { NextRequest, NextResponse } from 'next/server';
import { sendSMS, providerAutoPrependsSender, getActiveSmsProvider } from '@/lib/loyalty/sms';
import { requireAuth } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const { phone, message, sender_id } = await request.json();

    if (!phone || !message) {
      return NextResponse.json({ success: false, error: 'phone and message required' }, { status: 400 });
    }

    // Active gateway from the backoffice toggle (app_settings → env fallback).
    const provider = await getActiveSmsProvider();

    // Auto-prepend RM0 [<SenderID>] prefix if not already present.
    // SMS Niaga adds its own "RM0.00 <SenderID>:" at the gateway, so skip ours there.
    const senderLabel = sender_id || 'CelsiusCoffee';
    const SMS_PREFIX = `RM0 [${senderLabel}] `;
    const finalMessage =
      providerAutoPrependsSender(provider) || message.startsWith('RM0 ') ? message : `${SMS_PREFIX}${message}`;

    const result = await sendSMS(phone, finalMessage, { provider });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Failed to send SMS' }, { status: 500 });
  }
}
