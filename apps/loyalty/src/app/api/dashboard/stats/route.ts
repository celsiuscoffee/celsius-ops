import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';
import type { DashboardStats, TopSpender } from '@/types';

// GET /api/dashboard/stats?brand_id=brand-celsius — get dashboard statistics
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get('brand_id');

    if (!brandId) {
      return NextResponse.json(
        { error: 'brand_id query parameter is required' },
        { status: 400 }
      );
    }

    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).toISOString();
    const monthStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      1
    ).toISOString();

    // 30 days ago for active members
    const thirtyDaysAgo = new Date(
      now.getTime() - 30 * 24 * 60 * 60 * 1000
    ).toISOString();

    // 6 months ago for monthly breakdowns
    const sixMonthsAgo = new Date(
      now.getFullYear(),
      now.getMonth() - 5,
      1
    ).toISOString();

    // Run all queries in parallel — gracefully handle individual failures
    const [
      totalMembersResult,
      newMembersTodayResult,
      newMembersMonthResult,
      aggregatesResult,
      totalRedemptionsResult,
      activeCampaignsResult,
      activeMembers30dResult,
      topSpendersResult,
      newMembersByMonthResult,
      redemptionsByMonthResult,
      issuedRewardsResult,
      redeemedRewardsResult,
      recentTransactionsResult,
      returningCountResult,
      newCountResult,
      eligibleCountResult,
    ] = await Promise.all([
      // Total members for this brand
      supabaseAdmin
        .from('member_brands')
        .select('*', { count: 'exact', head: true })
        .eq('brand_id', brandId),

      // New members today
      supabaseAdmin
        .from('member_brands')
        .select('*', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .gte('joined_at', todayStart),

      // New members this month
      supabaseAdmin
        .from('member_brands')
        .select('*', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .gte('joined_at', monthStart),

      // Aggregated sums via SQL (instead of fetching all 20k+ rows)
      supabaseAdmin.rpc('get_brand_aggregates', { p_brand_id: brandId }),

      // Total redemptions
      supabaseAdmin
        .from('redemptions')
        .select('*', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .neq('status', 'cancelled'),

      // Active campaigns
      supabaseAdmin
        .from('campaigns')
        .select('*', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .eq('is_active', true)
        .lte('start_date', now.toISOString())
        .gte('end_date', now.toISOString()),

      // Active members in last 30 days (had a visit)
      supabaseAdmin
        .from('member_brands')
        .select('*', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .gte('last_visit_at', thirtyDaysAgo),

      // Top 5 spenders — join member_brands with members
      supabaseAdmin
        .from('member_brands')
        .select(
          'member_id, total_spent, total_visits, total_points_earned, last_visit_at, members!inner(name, phone)'
        )
        .eq('brand_id', brandId)
        .order('total_spent', { ascending: false })
        .limit(5),

      // New members by month (last 6 months)
      supabaseAdmin
        .from('member_brands')
        .select('joined_at')
        .eq('brand_id', brandId)
        .gte('joined_at', sixMonthsAgo),

      // Redemptions by month (last 6 months)
      supabaseAdmin
        .from('redemptions')
        .select('created_at')
        .eq('brand_id', brandId)
        .neq('status', 'cancelled')
        .gte('created_at', sixMonthsAgo),

      // Total issued rewards (for redemption rate)
      supabaseAdmin
        .from('issued_rewards')
        .select('*', { count: 'exact', head: true })
        .eq('brand_id', brandId),

      // Redeemed rewards (status = 'used')
      supabaseAdmin
        .from('issued_rewards')
        .select('*', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .eq('status', 'used'),

      // Recent transactions for activity feed (last 10)
      supabaseAdmin
        .from('point_transactions')
        .select('id, type, points, created_at, member_id, members!inner(name)')
        .eq('brand_id', brandId)
        .order('created_at', { ascending: false })
        .limit(10),

      // Segment counts: returning (visits >= 2)
      supabaseAdmin
        .from('member_brands')
        .select('*', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .gte('total_visits', 2),

      // Segment counts: new (visits <= 1)
      supabaseAdmin
        .from('member_brands')
        .select('*', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .lte('total_visits', 1),

      // Segment counts: eligible to redeem (points >= 500)
      supabaseAdmin
        .from('member_brands')
        .select('*', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .gte('points_balance', 500),
    ]);

    // Use SQL-aggregated sums (falls back to 0 if RPC not available yet)
    const agg = aggregatesResult.data;
    const totalPointsIssued = agg?.total_points_earned ?? 0;
    const totalPointsRedeemed = agg?.total_points_redeemed ?? 0;
    const totalRevenueAttributed = agg?.total_spent ?? 0;
    const floatingPoints = agg?.floating_points ?? 0;

    // Average lifetime value for members
    const totalMembers = totalMembersResult.count ?? 0;
    const avgLifetimeValueMembers =
      totalMembers > 0 ? totalRevenueAttributed / totalMembers : 0;

    // Member transaction percentage (approximation: assume all tracked transactions are member transactions)
    // Since we only track member transactions in this system, set to 100 for now
    // In a real scenario this would compare member vs total POS transactions
    const memberTransactionPct = totalMembers > 0 ? 100 : 0;

    // Reward redemption rate
    const totalIssued = issuedRewardsResult.count ?? 0;
    const totalRedeemed = redeemedRewardsResult.count ?? 0;
    const rewardRedemptionRate =
      totalIssued > 0
        ? Math.round((totalRedeemed / totalIssued) * 10000) / 100
        : 0;

    // --- Top spenders with redemption counts ---
    const topSpendersRaw = topSpendersResult.data ?? [];
    const topMemberIds = topSpendersRaw.map(
      (s: { member_id: string }) => s.member_id
    );

    // Fetch redemption counts for top spenders
    let redemptionCountsMap: Record<string, number> = {};
    if (topMemberIds.length > 0) {
      const { data: redemptionData } = await supabaseAdmin
        .from('redemptions')
        .select('member_id')
        .eq('brand_id', brandId)
        .neq('status', 'cancelled')
        .in('member_id', topMemberIds);

      // Count redemptions per member
      for (const r of redemptionData ?? []) {
        redemptionCountsMap[r.member_id] =
          (redemptionCountsMap[r.member_id] || 0) + 1;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const topSpenders: TopSpender[] = (topSpendersRaw as any[]).map((s) => {
      const member = Array.isArray(s.members) ? s.members[0] : s.members;
      return {
        id: s.member_id,
        name: member?.name ?? null,
        phone: member?.phone ?? '',
        total_spent: s.total_spent,
        total_visits: s.total_visits,
        total_points_earned: s.total_points_earned,
        total_rewards_redeemed: redemptionCountsMap[s.member_id] || 0,
        last_visit_at: s.last_visit_at,
      };
    });

    // --- Monthly breakdowns ---

    // Generate last 6 month keys (YYYY-MM)
    const monthKeys: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthKeys.push(key);
    }

    // New members by month
    const newMembersByMonthMap: Record<string, number> = {};
    for (const key of monthKeys) newMembersByMonthMap[key] = 0;
    for (const row of newMembersByMonthResult.data ?? []) {
      const d = new Date(row.joined_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (key in newMembersByMonthMap) {
        newMembersByMonthMap[key]++;
      }
    }
    const newMembersByMonth = monthKeys.map((key) => ({
      month: key,
      count: newMembersByMonthMap[key],
    }));

    // Redemptions by month
    const redemptionsByMonthMap: Record<string, number> = {};
    for (const key of monthKeys) redemptionsByMonthMap[key] = 0;
    for (const row of redemptionsByMonthResult.data ?? []) {
      const d = new Date(row.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (key in redemptionsByMonthMap) {
        redemptionsByMonthMap[key]++;
      }
    }
    const redemptionsByMonth = monthKeys.map((key) => ({
      month: key,
      count: redemptionsByMonthMap[key],
    }));

    // --- Recent activity feed ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recentActivity = (recentTransactionsResult.data ?? []).map((t: any) => {
      const memberName = Array.isArray(t.members) ? t.members[0]?.name : t.members?.name;
      return {
        id: t.id,
        name: memberName || 'Unknown',
        text: t.type === 'earn'
          ? `earned ${t.points} pts`
          : t.type === 'redeem'
            ? 'redeemed a reward'
            : `received ${t.points} pts bonus`,
        type: t.type,
        date: t.created_at,
      };
    });

    // --- Build response ---
    const stats: DashboardStats = {
      // Existing stats
      total_members: totalMembers,
      new_members_today: newMembersTodayResult.count ?? 0,
      new_members_this_month: newMembersMonthResult.count ?? 0,
      total_points_issued: totalPointsIssued,
      total_points_redeemed: totalPointsRedeemed,
      total_redemptions: totalRedemptionsResult.count ?? 0,
      total_revenue_attributed: totalRevenueAttributed,
      active_campaigns: activeCampaignsResult.count ?? 0,
      // Enhanced insights
      active_members_30d: activeMembers30dResult.count ?? 0,
      floating_points: floatingPoints,
      member_transaction_pct: memberTransactionPct,
      avg_lifetime_value_members: Math.round(avgLifetimeValueMembers * 100) / 100,
      avg_lifetime_value_nonmembers: 0,
      reward_redemption_rate: rewardRedemptionRate,
      top_spenders: topSpenders,
      new_members_by_month: newMembersByMonth,
      redemptions_by_month: redemptionsByMonth,
      recent_activity: recentActivity,
      returning_count: returningCountResult.count ?? 0,
      new_count: newCountResult.count ?? 0,
      eligible_count: eligibleCountResult.count ?? 0,
    };

    return NextResponse.json(stats);
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
