import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/loyalty/supabase';
import { requireAuth } from '@/lib/auth';

// GET /api/loyalty/dashboard/segments?brand_id=brand-celsius&period=monthly|weekly|yearly
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get('brand_id');
    const period = searchParams.get('period') || 'monthly';

    if (!brandId) {
      return NextResponse.json(
        { error: 'brand_id query parameter is required' },
        { status: 400 }
      );
    }

    const now = new Date();

    // Calculate period start date
    let periodStart: Date;
    let periodLabel: string;
    let weeksInPeriod: number;

    switch (period) {
      case 'weekly': {
        // Start of current week (Monday)
        const day = now.getDay();
        const diff = day === 0 ? 6 : day - 1; // Monday = 0
        periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
        periodLabel = 'This Week';
        const daysElapsed = Math.max(1, (now.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000));
        weeksInPeriod = Math.max(1, daysElapsed / 7);
        break;
      }
      case 'yearly': {
        periodStart = new Date(now.getFullYear(), 0, 1);
        periodLabel = 'This Year';
        const daysElapsed = Math.max(1, (now.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000));
        weeksInPeriod = Math.max(1, daysElapsed / 7);
        break;
      }
      default: {
        // monthly
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        periodLabel = 'This Month';
        const daysElapsed = Math.max(1, (now.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000));
        weeksInPeriod = Math.max(1, daysElapsed / 7);
        break;
      }
    }

    const periodStartISO = periodStart.toISOString();

    // Fetch earn transactions in period + member data for LTV in parallel
    const [txResult, totalMembersResult, memberBrandsResult] = await Promise.all([
      supabaseAdmin
        .from('point_transactions')
        .select('member_id, points, description, created_at')
        .eq('brand_id', brandId)
        .eq('type', 'earn')
        .gte('created_at', periodStartISO),
      supabaseAdmin
        .from('member_brands')
        .select('*', { count: 'exact', head: true })
        .eq('brand_id', brandId),
      // For LTV: need total_spent, total_visits, joined_at per active member
      supabaseAdmin
        .from('member_brands')
        .select('member_id, total_spent, total_visits, joined_at, last_visit_at')
        .eq('brand_id', brandId)
        .gte('total_visits', 1),
    ]);

    type TxRow = { member_id: string; points: number; description: string; created_at: string };
    const txs = (txResult.data ?? []) as TxRow[];
    const totalMembers = totalMembersResult.count ?? 0;

    // Aggregate per member
    const memberStats = new Map<string, { visits: number; spend: number }>();
    for (const tx of txs) {
      const existing = memberStats.get(tx.member_id) || { visits: 0, spend: 0 };
      existing.visits++;
      const spendMatch = tx.description?.match(/RM\s*([\d,.]+)/);
      if (spendMatch) existing.spend += parseFloat(spendMatch[1].replace(/,/g, '')) || 0;
      memberStats.set(tx.member_id, existing);
    }

    const activeMembers = Array.from(memberStats.values());
    const activeMemberCount = activeMembers.length;

    let repeatCount = 0;
    let frequentCount = 0;
    let totalSpend = 0;
    const spends: number[] = [];

    for (const m of activeMembers) {
      totalSpend += m.spend;
      spends.push(m.spend);

      // Repeat: 2+ visits in period
      if (m.visits >= 2) repeatCount++;

      // Frequent: 1+ visit per week in period
      const visitsPerWeek = m.visits / weeksInPeriod;
      if (visitsPerWeek >= 1) frequentCount++;
    }

    const avgSpend = activeMemberCount > 0 ? totalSpend / activeMemberCount : 0;

    // LTV calculation: avg_spend_per_visit × visit_frequency_per_month × avg_lifespan_months
    // Computed from member_brands lifetime data (not period-restricted)
    type MbRow = { member_id: string; total_spent: number; total_visits: number; joined_at: string; last_visit_at: string | null };
    const mbRows = (memberBrandsResult.data ?? []) as MbRow[];

    let ltvSum = 0;
    let ltvCount = 0;
    const ltvValues: number[] = [];

    // First pass: calculate avg lifespan across all members
    let totalLifespanMonths = 0;
    for (const mb of mbRows) {
      const joined = new Date(mb.joined_at);
      const lastVisit = mb.last_visit_at ? new Date(mb.last_visit_at) : now;
      const months = Math.max(1, (lastVisit.getTime() - joined.getTime()) / (30 * 24 * 60 * 60 * 1000));
      totalLifespanMonths += months;
    }
    const avgLifespanMonths = mbRows.length > 0 ? totalLifespanMonths / mbRows.length : 1;
    // Project lifespan: use 12 months or avg, whichever is higher
    const projectedLifespan = Math.max(12, Math.round(avgLifespanMonths));

    // Second pass: calculate per-customer LTV
    for (const mb of mbRows) {
      if (mb.total_visits < 1) continue;
      const joined = new Date(mb.joined_at);
      const lastVisit = mb.last_visit_at ? new Date(mb.last_visit_at) : now;
      const monthsActive = Math.max(1, (lastVisit.getTime() - joined.getTime()) / (30 * 24 * 60 * 60 * 1000));

      const spendPerVisit = mb.total_spent / mb.total_visits;
      const visitsPerMonth = mb.total_visits / monthsActive;
      const ltv = spendPerVisit * visitsPerMonth * projectedLifespan;

      ltvValues.push(ltv);
      ltvSum += ltv;
      ltvCount++;
    }

    const avgLtv = ltvCount > 0 ? ltvSum / ltvCount : 0;

    // Churned: had 2+ lifetime visits but NOT active in this period
    const { count: churnedCount } = await supabaseAdmin
      .from('member_brands')
      .select('*', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .gte('total_visits', 2)
      .lt('last_visit_at', periodStartISO);

    return NextResponse.json({
      period: periodLabel,
      period_start: periodStartISO,
      total_members: totalMembers,
      active_this_period: activeMemberCount,
      repeat: repeatCount,
      frequent: frequentCount,
      ltv: Math.round(avgLtv * 100) / 100,
      ltv_projected_months: projectedLifespan,
      churned: churnedCount ?? 0,
      avg_spend: Math.round(avgSpend * 100) / 100,
      total_spend: Math.round(totalSpend * 100) / 100,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
