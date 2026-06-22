import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/loyalty/supabase';
import { requireAuth } from '@/lib/auth';
import { getActiveSmsProvider } from '@/lib/loyalty/sms';

// GET /api/sms/credits?brand_id=X — get credit balance from SMS123 + usage stats
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get('brand_id') || 'brand-celsius';

    const provider = await getActiveSmsProvider();

    // Balance is only meaningful for the active gateway. SMS123 exposes a balance
    // API; SMS Niaga doesn't have one wired here, so we report null (no false
    // SMS123 number when SMS Niaga is live).
    let balance: number | null = null;
    if (provider === 'sms123') {
      const apiKey = process.env.SMS123_API_KEY;
      const email = process.env.SMS123_EMAIL;
      if (apiKey && email) {
        try {
          const params = new URLSearchParams({ apiKey, email });
          const res = await fetch(`https://www.sms123.net/api/getBalance.php?${params.toString()}`, {
            next: { revalidate: 0 },
          });
          const data = await res.json();
          if (data.status === 'ok' && data.balance != null) {
            // SMS123 returns formatted numbers like "2,000.00" — strip commas before parsing
            balance = parseFloat(String(data.balance).replace(/,/g, ''));
          }
        } catch (err) {
          console.error('Failed to fetch SMS123 balance:', err);
        }
      }
    }

    // Get usage stats from our DB
    const { count: totalSent } = await supabaseAdmin
      .from('sms_logs')
      .select('*', { count: 'exact', head: true })
      .eq('brand_id', brandId);

    const { count: sentThisMonth } = await supabaseAdmin
      .from('sms_logs')
      .select('*', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());

    // Get recent send history
    const { data: history } = await supabaseAdmin
      .from('sms_logs')
      .select('*')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .limit(50);

    return NextResponse.json({
      balance,
      provider,
      total_sent: totalSent ?? 0,
      sent_this_month: sentThisMonth ?? 0,
      history: history ?? [],
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
