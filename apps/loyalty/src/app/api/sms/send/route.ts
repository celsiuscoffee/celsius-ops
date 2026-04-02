import { NextRequest, NextResponse } from 'next/server';
import { sendSMS } from '@/lib/sms';
import { requireAuth } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const { phone, message } = await request.json();

    if (!phone || !message) {
      return NextResponse.json({ success: false, error: 'phone and message required' }, { status: 400 });
    }

    // Auto-prepend RM0 [CelsiusCoffee] prefix if not already present
    const SMS_PREFIX = 'RM0 [CelsiusCoffee] ';
    const finalMessage = message.startsWith(SMS_PREFIX) ? message : `${SMS_PREFIX}${message}`;

    const result = await sendSMS(phone, finalMessage);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Failed to send SMS' }, { status: 500 });
  }
}
