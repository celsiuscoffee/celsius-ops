import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { isAuthorizedCron } from '@/lib/benefits';
import {
  evaluateCart,
  recordApplications,
  type CartContext,
  type CartLine,
} from '@/lib/promotions';

// POST /api/promotions/apply
// Body: same as /evaluate plus reference_id (order id / POS txn id)
// Auth required — only POS / pickup backend should call this.
//
// Re-evaluates the cart server-side (don't trust client-side discount math)
// and records each applied promotion to the ledger so usage caps and
// reporting work correctly.
export async function POST(request: NextRequest) {
  try {
    // Either staff-session auth (admin UI) or server-secret auth (the
    // pickup web app calling us server-to-server at order commit).
    if (!isAuthorizedCron(request)) {
      const auth = await requireAuth(request);
      if (auth.error) return auth.error;
    }

    const body = await request.json();

    if (
      !body.brand_id ||
      !Array.isArray(body.lines) ||
      typeof body.reference_id !== 'string'
    ) {
      return NextResponse.json(
        { error: 'brand_id, lines, and reference_id are required' },
        { status: 400 }
      );
    }

    const lines = body.lines as CartLine[];
    const ctx: CartContext = {
      brand_id: body.brand_id,
      member_id: body.member_id ?? null,
      outlet_id: body.outlet_id ?? null,
      member_tier_id: body.member_tier_id ?? null,
      promo_code: body.promo_code ?? null,
      reward_promotion_ids: body.reward_promotion_ids ?? [],
    };

    const result = await evaluateCart(lines, ctx);

    await recordApplications({
      evaluated: result,
      brand_id: body.brand_id,
      member_id: ctx.member_id,
      outlet_id: ctx.outlet_id,
      reference_id: body.reference_id,
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
