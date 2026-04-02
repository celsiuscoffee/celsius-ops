import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';

// GET /api/admin/ai-insights?brand_id=brand-celsius
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const brandId = searchParams.get('brand_id') || 'brand-celsius';

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();

    // Fetch all data in parallel
    const [
      membersResult,
      rewardsResult,
      redemptionsResult,
      transactionsResult,
      issuedRewardsResult,
    ] = await Promise.all([
      // All members with tier, points, visit data
      supabaseAdmin
        .from('member_brands')
        .select('member_id, points_balance, total_spent, total_visits, last_visit_at, joined_at, tier')
        .eq('brand_id', brandId),

      // All active rewards
      supabaseAdmin
        .from('rewards')
        .select('id, name, description, points_required, category, stock, reward_type')
        .eq('brand_id', brandId)
        .eq('is_active', true),

      // All redemptions with reward info
      supabaseAdmin
        .from('redemptions')
        .select('id, reward_id, member_id, status, created_at, rewards(name, category, points_required)')
        .eq('brand_id', brandId)
        .neq('status', 'cancelled')
        .gte('created_at', sixMonthsAgo),

      // Point transactions for earn/redeem patterns
      supabaseAdmin
        .from('point_transactions')
        .select('member_id, type, points, created_at')
        .eq('brand_id', brandId)
        .gte('created_at', sixMonthsAgo),

      // Issued rewards for redemption rate per reward
      supabaseAdmin
        .from('issued_rewards')
        .select('reward_id, status, member_id, created_at')
        .eq('brand_id', brandId),
    ]);

    const members = membersResult.data ?? [];
    const rewards = rewardsResult.data ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const redemptions = (redemptionsResult.data ?? []) as any[];
    const transactions = transactionsResult.data ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const issuedRewards = (issuedRewardsResult.data ?? []) as any[];

    // ─── Member Segmentation ───────────────────────────────────────────
    const totalMembers = members.length;
    const activeMembers = members.filter(m => m.last_visit_at && m.last_visit_at >= thirtyDaysAgo);
    const inactiveMembers = members.filter(m => !m.last_visit_at || m.last_visit_at < ninetyDaysAgo);
    const newMembers = members.filter(m => m.total_visits <= 1);
    const vipMembers = members.filter(m => m.tier === 'gold' || m.tier === 'platinum' || m.total_spent >= 500);

    // High points, no recent redemption
    const recentRedeemerIds = new Set(
      redemptions
        .filter(r => r.created_at >= thirtyDaysAgo)
        .map((r: { member_id: string }) => r.member_id)
    );
    const highPointsNoRedeem = members.filter(
      m => m.points_balance >= 300 && !recentRedeemerIds.has(m.member_id)
    );

    const avgPoints = totalMembers > 0
      ? Math.round(members.reduce((s, m) => s + (m.points_balance || 0), 0) / totalMembers)
      : 0;

    const totalFloatingPoints = members.reduce((s, m) => s + (m.points_balance || 0), 0);

    // ─── Reward Redemption Analysis ────────────────────────────────────
    // Count redemptions per reward
    const redemptionCountByReward: Record<string, number> = {};
    const redemptionDates: Record<string, string[]> = {};

    for (const r of redemptions) {
      const rid = r.reward_id;
      redemptionCountByReward[rid] = (redemptionCountByReward[rid] || 0) + 1;
      if (!redemptionDates[rid]) redemptionDates[rid] = [];
      redemptionDates[rid].push(r.created_at);
    }

    // Count issued rewards per reward (for redemption rate)
    const issuedCountByReward: Record<string, number> = {};
    const usedCountByReward: Record<string, number> = {};
    for (const ir of issuedRewards) {
      issuedCountByReward[ir.reward_id] = (issuedCountByReward[ir.reward_id] || 0) + 1;
      if (ir.status === 'used') {
        usedCountByReward[ir.reward_id] = (usedCountByReward[ir.reward_id] || 0) + 1;
      }
    }

    // Enrich rewards with analytics
    const rewardsWithStats = rewards.map(r => {
      const redeemCount = redemptionCountByReward[r.id] || 0;
      const issuedCount = issuedCountByReward[r.id] || 0;
      const usedCount = usedCountByReward[r.id] || 0;
      const redemptionRate = issuedCount > 0 ? Math.round((usedCount / issuedCount) * 100) : 0;
      return { ...r, redeemCount, issuedCount, usedCount, redemptionRate };
    });

    const sortedByRedemptions = [...rewardsWithStats].sort((a, b) => b.redeemCount - a.redeemCount);
    const topRewards = sortedByRedemptions.slice(0, 3);
    const lowRewards = sortedByRedemptions.filter(r => r.redeemCount === 0 || r.redemptionRate < 20);

    // ─── Category Analysis ─────────────────────────────────────────────
    const categoryCounts: Record<string, number> = {};
    for (const r of redemptions) {
      const cat = r.rewards?.category || 'unknown';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    }

    const rewardCategories = new Set(rewards.map(r => r.category));
    const allCategories = ['drink', 'food', 'voucher', 'merch'];
    const missingCategories = allCategories.filter(c => !rewardCategories.has(c));

    // Most popular category not well-served by rewards
    const sortedCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
    const topCategory = sortedCategories[0]?.[0] ?? null;

    // ─── Points Pricing Recommendations ───────────────────────────────
    // Compute the median points required across active rewards
    const pointsValues = rewards.map(r => r.points_required).sort((a, b) => a - b);
    const medianPoints = pointsValues.length > 0
      ? pointsValues[Math.floor(pointsValues.length / 2)]
      : 300;

    // Avg spend per visit for high-value customers
    const avgSpendPerVisit = members.length > 0
      ? Math.round(
          members
            .filter(m => m.total_visits > 0)
            .reduce((s, m) => s + (m.total_spent / m.total_visits), 0) /
          Math.max(1, members.filter(m => m.total_visits > 0).length)
        )
      : 0;

    // Typical points per visit (assume 1 pt per RM1 spent)
    const avgPointsPerVisit = avgSpendPerVisit;
    const visitsToRedeem = medianPoints > 0 && avgPointsPerVisit > 0
      ? Math.round(medianPoints / avgPointsPerVisit)
      : 10;

    // Engagement velocity: redemptions per week
    const totalRedemptionsInPeriod = redemptions.length;
    const weeksInPeriod = 26; // 6 months
    const weeklyRedemptionRate = Math.round((totalRedemptionsInPeriod / weeksInPeriod) * 10) / 10;

    // ─── Timing Analysis ──────────────────────────────────────────────
    // Redemption distribution by day of week
    const dayOfWeekCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    for (const r of redemptions) {
      const day = new Date(r.created_at).getDay();
      dayOfWeekCounts[day]++;
    }
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const peakDay = Object.entries(dayOfWeekCounts).sort((a, b) => b[1] - a[1])[0];
    const peakDayName = peakDay ? dayNames[parseInt(peakDay[0])] : null;

    // ─── Earn vs Redeem Balance ────────────────────────────────────────
    const totalEarned = transactions
      .filter(t => t.type === 'earn' || t.type === 'bonus')
      .reduce((s, t) => s + (t.points || 0), 0);
    const totalRedeemed = transactions
      .filter(t => t.type === 'redeem')
      .reduce((s, t) => s + Math.abs(t.points || 0), 0);
    const earnRedeemRatio = totalEarned > 0
      ? Math.round((totalRedeemed / totalEarned) * 100)
      : 0;

    // ─── Build Insights ────────────────────────────────────────────────
    const insights = {
      generated_at: now.toISOString(),
      brand_id: brandId,

      summary: {
        total_members: totalMembers,
        active_members_30d: activeMembers.length,
        inactive_members_90d: inactiveMembers.length,
        new_members: newMembers.length,
        vip_members: vipMembers.length,
        avg_points_balance: avgPoints,
        total_floating_points: totalFloatingPoints,
        earn_redeem_ratio_pct: earnRedeemRatio,
        weekly_redemption_rate: weeklyRedemptionRate,
        total_active_rewards: rewards.length,
        peak_redemption_day: peakDayName,
      },

      member_insights: [
        {
          type: 'opportunity',
          priority: 'high',
          title: 'High Points, Not Redeeming',
          metric: highPointsNoRedeem.length,
          metric_label: 'members',
          description: `${highPointsNoRedeem.length} members have 300+ points but haven't redeemed in 30 days. They're ready to redeem — send them a nudge.`,
          recommendation: 'Run a targeted SMS campaign reminding them of available rewards. Include the specific reward they can get with their current balance.',
          data: {
            avg_points: highPointsNoRedeem.length > 0
              ? Math.round(highPointsNoRedeem.reduce((s, m) => s + m.points_balance, 0) / highPointsNoRedeem.length)
              : 0,
          },
        },
        {
          type: 'risk',
          priority: inactiveMembers.length > totalMembers * 0.3 ? 'high' : 'medium',
          title: 'Inactive Members (90+ Days)',
          metric: inactiveMembers.length,
          metric_label: 'members',
          description: `${inactiveMembers.length} members (${Math.round((inactiveMembers.length / Math.max(1, totalMembers)) * 100)}% of base) haven't visited in over 90 days.`,
          recommendation: 'Create a win-back campaign with a limited-time bonus points offer (e.g., "Visit this week, earn double points"). Set urgency with a 7-day window.',
          data: {
            pct_of_base: Math.round((inactiveMembers.length / Math.max(1, totalMembers)) * 100),
          },
        },
        {
          type: 'growth',
          priority: 'medium',
          title: 'New Member Conversion',
          metric: newMembers.length,
          metric_label: 'members with ≤1 visit',
          description: `${newMembers.length} members joined but have only visited once or never. Converting them to regulars is your biggest growth lever.`,
          recommendation: 'Auto-trigger a "Welcome Back" reward after their second visit. Consider a new member bonus campaign to incentivize a second purchase.',
          data: {
            conversion_opportunity: Math.round((newMembers.length / Math.max(1, totalMembers)) * 100),
          },
        },
        {
          type: 'vip',
          priority: 'medium',
          title: 'VIP Member Base',
          metric: vipMembers.length,
          metric_label: 'VIP / top spenders',
          description: `${vipMembers.length} VIP members drive disproportionate revenue. Keeping them happy is critical.`,
          recommendation: 'Ensure you have exclusive, high-value rewards (merch, special experiences) that appeal to VIPs. Consider a VIP-only reward or early access perk.',
          data: {
            pct_of_base: Math.round((vipMembers.length / Math.max(1, totalMembers)) * 100),
          },
        },
      ],

      reward_insights: [
        {
          type: 'top_performer',
          priority: 'info',
          title: 'Best Performing Rewards',
          description: topRewards.length > 0
            ? `"${topRewards[0]?.name}" leads with ${topRewards[0]?.redeemCount} redemptions. These are proven crowd-pleasers.`
            : 'No redemptions recorded yet — consider promoting your rewards actively.',
          recommendation: 'Keep these rewards stocked and visible. Consider featuring them on the member portal home page.',
          rewards: topRewards.map(r => ({
            id: r.id,
            name: r.name,
            category: r.category,
            points_required: r.points_required,
            redeemCount: r.redeemCount,
            redemptionRate: r.redemptionRate,
          })),
        },
        {
          type: 'underperformer',
          priority: lowRewards.length > 0 ? 'medium' : 'info',
          title: 'Underperforming Rewards',
          description: lowRewards.length > 0
            ? `${lowRewards.length} reward${lowRewards.length > 1 ? 's have' : ' has'} zero or very low redemptions. These may be priced too high or lack visibility.`
            : 'All rewards are getting redemptions.',
          recommendation: lowRewards.length > 0
            ? 'Consider reducing the points price, improving reward descriptions, or replacing low-performers with more appealing alternatives.'
            : 'Maintain current reward mix.',
          rewards: lowRewards.slice(0, 3).map(r => ({
            id: r.id,
            name: r.name,
            category: r.category,
            points_required: r.points_required,
            redeemCount: r.redeemCount,
            redemptionRate: r.redemptionRate,
          })),
        },
        {
          type: 'category_gap',
          priority: missingCategories.length > 0 ? 'medium' : 'info',
          title: 'Reward Category Gaps',
          description: missingCategories.length > 0
            ? `You have no active rewards in: ${missingCategories.join(', ')}. A diverse reward catalogue drives broader appeal.`
            : 'You have rewards across all major categories.',
          recommendation: missingCategories.includes('food')
            ? 'Food rewards have high perceived value and encourage upselling. Consider adding a free pastry or snack reward.'
            : missingCategories.includes('voucher')
              ? 'Voucher rewards (e.g., RM5 off next visit) drive repeat purchases and are easy to implement.'
              : 'Expand your reward mix to include the missing categories above.',
          missing_categories: missingCategories,
          existing_categories: Array.from(rewardCategories),
        },
      ],

      pricing_insights: {
        title: 'Points Pricing Recommendations',
        current_median_points: medianPoints,
        avg_points_per_visit: avgPointsPerVisit,
        avg_visits_to_redeem: visitsToRedeem,
        recommendations: [
          {
            label: 'Entry-Level Reward',
            suggested_points: Math.max(100, Math.round(avgPointsPerVisit * 3)),
            rationale: `Achievable in ~3 visits. Keeps new members engaged early.`,
          },
          {
            label: 'Mid-Tier Reward',
            suggested_points: Math.max(250, Math.round(avgPointsPerVisit * 6)),
            rationale: `~6 visits to earn. Rewards regulars without being out of reach.`,
          },
          {
            label: 'Premium Reward',
            suggested_points: Math.max(500, Math.round(avgPointsPerVisit * 12)),
            rationale: `12+ visits. Aspirational for VIPs, drives long-term loyalty.`,
          },
        ],
        insight: earnRedeemRatio < 20
          ? 'Your earn-to-redeem ratio is low — members are accumulating points but not spending them. Consider lowering reward thresholds or running a limited-time "points sale".'
          : earnRedeemRatio > 70
            ? 'High redemption activity — your rewards are popular. Ensure stock levels can sustain demand.'
            : 'Your earn-to-redeem ratio looks healthy. Members are engaging with the program at a sustainable rate.',
      },

      product_recommendations: [
        ...(topCategory && rewards.filter(r => r.category === topCategory).length < 2
          ? [{
              priority: 'high' as const,
              title: `Add More ${topCategory.charAt(0).toUpperCase() + topCategory.slice(1)} Rewards`,
              description: `"${topCategory}" is the most redeemed category but you only have ${rewards.filter(r => r.category === topCategory).length} active reward(s) in it.`,
              recommendation: `Introduce 1–2 additional ${topCategory} rewards at different price points to give members more choice in the most popular category.`,
            }]
          : []),
        ...(missingCategories.includes('food')
          ? [{
              priority: 'medium' as const,
              title: 'Introduce a Food Reward',
              description: 'Food items have high perceived value and encourage upselling when members come in to redeem.',
              recommendation: 'A free croissant or muffin at 200–300 points is an easy win. Pair with a drink purchase requirement to drive basket size.',
            }]
          : []),
        ...(missingCategories.includes('voucher')
          ? [{
              priority: 'medium' as const,
              title: 'Add a Discount Voucher Reward',
              description: 'Voucher rewards (e.g., RM5 off) are universally appealing and drive repeat visits.',
              recommendation: 'Set at 400–500 points with a 30-day expiry. The urgency of expiry drives faster repeat visits.',
            }]
          : []),
        {
          priority: 'low' as const,
          title: 'Seasonal / Limited-Time Reward',
          description: 'Seasonal rewards create excitement and urgency, spiking engagement during quieter periods.',
          recommendation: `Consider a limited-time reward for ${now.getMonth() >= 10 ? 'the year-end holiday season' : now.getMonth() >= 5 ? 'mid-year' : 'the upcoming season'}. Run it for 3–4 weeks only.`,
        },
      ],

      quick_actions: [
        ...(highPointsNoRedeem.length > 10
          ? [{ action: 'sms_blast', label: `SMS ${highPointsNoRedeem.length} "points-ready" members`, href: '/admin/notifications', priority: 'high' }]
          : []),
        ...(inactiveMembers.length > 20
          ? [{ action: 'campaign', label: 'Create a Win-Back campaign for inactive members', href: '/admin/campaigns', priority: 'high' }]
          : []),
        ...(lowRewards.length > 0
          ? [{ action: 'rewards', label: `Review ${lowRewards.length} underperforming reward(s)`, href: '/admin/rewards', priority: 'medium' }]
          : []),
        ...(missingCategories.length > 0
          ? [{ action: 'rewards', label: `Add rewards in: ${missingCategories.join(', ')}`, href: '/admin/rewards', priority: 'medium' }]
          : []),
        ...(newMembers.length > 20
          ? [{ action: 'campaign', label: 'Set up a New Member Welcome campaign', href: '/admin/campaigns', priority: 'medium' }]
          : []),
        { action: 'members', label: 'View full member segments and engagement', href: '/admin/members', priority: 'low' },
      ],
    };

    return NextResponse.json(insights);
  } catch (err) {
    console.error('[ai-insights]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
