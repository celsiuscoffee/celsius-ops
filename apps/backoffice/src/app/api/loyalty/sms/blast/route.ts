import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/loyalty/supabase';
import { sendSMS } from '@/lib/loyalty/sms';
import { requireAuth } from '@/lib/auth';

const BATCH_SIZE = 10; // Send 10 SMS concurrently per batch

// POST /api/sms/blast — send SMS to a list of phone numbers
// Body: { brand_id, campaign_id?, phones: string[], message: string }
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { brand_id = 'brand-celsius', campaign_id, phones, message, sender_id } = body;

    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return NextResponse.json({ error: 'phones array is required' }, { status: 400 });
    }
    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    // Deduplicate and filter invalid phones
    const validPhones = [...new Set(phones.filter((p: string) => p && p.replace(/\D/g, '').length >= 10))];

    // PDPA: Filter out members who have opted out of SMS marketing
    let uniquePhones = validPhones;
    try {
      const { data: optedOut } = await supabaseAdmin
        .from('members')
        .select('phone')
        .eq('sms_opt_out', true);
      if (optedOut && optedOut.length > 0) {
        const optedOutSet = new Set(optedOut.map((m: { phone: string }) => m.phone));
        uniquePhones = validPhones.filter((p) => !optedOutSet.has(p));
      }
    } catch {
      // If column doesn't exist yet, continue with all phones
    }

    // Check SMS123 balance before sending
    const apiKey = process.env.SMS123_API_KEY;
    const email = process.env.SMS123_EMAIL;
    if (apiKey && email) {
      try {
        const params = new URLSearchParams({ apiKey, email });
        const res = await fetch(`https://www.sms123.net/api/getBalance.php?${params.toString()}`);
        const data = await res.json();
        if (data.status === 'ok') {
          const balance = parseFloat(String(data.balance).replace(/,/g, ''));
          // Balance is in message credits (1 credit = 1 SMS)
          if (balance < uniquePhones.length) {
            return NextResponse.json({
              error: `Insufficient SMS123 credits. Need ${uniquePhones.length}, have ${Math.floor(balance)}. Top up at sms123.net.`,
              balance: Math.floor(balance),
              needed: uniquePhones.length,
            }, { status: 400 });
          }
        }
      } catch {
        // Continue even if balance check fails
      }
    }

    // Auto-prepend RM0 [<SenderID>] prefix if not already present
    const senderLabel = sender_id || 'CelsiusCoffee';
    const SMS_PREFIX = `RM0 [${senderLabel}] `;
    const finalMessage = message.startsWith('RM0 ') ? message : `${SMS_PREFIX}${message}`;

    // Send SMS in parallel batches of BATCH_SIZE
    let sent = 0;
    let failed = 0;
    const allLogs: {
      id: string;
      brand_id: string;
      campaign_id: string | null;
      phone: string;
      message: string;
      status: string;
      provider: string;
      provider_message_id: string | null;
      error: string | null;
    }[] = [];

    for (let i = 0; i < uniquePhones.length; i += BATCH_SIZE) {
      const batch = uniquePhones.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map((phone) => sendSMS(phone, finalMessage, sender_id ? { senderId: sender_id } : undefined))
      );

      for (let j = 0; j < batch.length; j++) {
        const result = batchResults[j];
        if (result.success) {
          sent++;
        } else {
          failed++;
        }

        allLogs.push({
          id: `sms-${Date.now()}-${i + j}-${Math.random().toString(36).slice(2, 6)}`,
          brand_id,
          campaign_id: campaign_id || null,
          phone: batch[j],
          message: finalMessage,
          status: result.success ? 'sent' : 'failed',
          provider: process.env.SMS_PROVIDER || 'console',
          provider_message_id: result.messageId || null,
          error: result.error || null,
        });
      }
    }

    // Batch insert all logs at once
    if (allLogs.length > 0) {
      await supabaseAdmin.from('sms_logs').insert(allLogs);
    }

    // Update campaign SMS count if applicable (atomic via RPC or safe increment)
    if (campaign_id && sent > 0) {
      // Use a single update that reads + increments atomically via SQL
      await supabaseAdmin.rpc('increment_sms_count', {
        p_campaign_id: campaign_id,
        p_count: sent,
      }).then(null, async () => {
        // Fallback if RPC doesn't exist: read-then-update (non-atomic)
        const { data: campaign } = await supabaseAdmin
          .from('campaigns')
          .select('sms_sent_count')
          .eq('id', campaign_id)
          .single();
        await supabaseAdmin
          .from('campaigns')
          .update({
            sms_sent_count: (campaign?.sms_sent_count || 0) + sent,
            sms_sent_at: new Date().toISOString(),
          })
          .eq('id', campaign_id);
      });
    }

    return NextResponse.json({
      success: true,
      sent,
      failed,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
