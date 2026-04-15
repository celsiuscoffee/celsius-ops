import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/loyalty/supabase';
import { requireAuth } from '@/lib/auth';

// GET /api/loyalty/sms/messages?brand_id=brand-celsius
// Returns distinct SMS messages grouped by message text with sent counts
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get('brand_id') || 'brand-celsius';

    // Fetch all SMS logs, then group client-side (Supabase doesn't support GROUP BY in REST)
    const { data, error } = await supabaseAdmin
      .from('sms_logs')
      .select('message, created_at')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .limit(5000);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Group by message text
    const grouped = new Map<string, { sent_count: number; last_sent_at: string }>();
    for (const row of data || []) {
      const msg = row.message;
      const existing = grouped.get(msg);
      if (existing) {
        existing.sent_count++;
        if (row.created_at > existing.last_sent_at) {
          existing.last_sent_at = row.created_at;
        }
      } else {
        grouped.set(msg, { sent_count: 1, last_sent_at: row.created_at });
      }
    }

    // Strip RM0 prefix for display, keep original for matching
    const results = Array.from(grouped.entries())
      .map(([message, stats]) => ({
        message,
        display: message.replace(/^RM0\s+\S+\s*/, ''),
        sent_count: stats.sent_count,
        last_sent_at: stats.last_sent_at,
      }))
      .sort((a, b) => b.last_sent_at.localeCompare(a.last_sent_at));

    return NextResponse.json(results);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
