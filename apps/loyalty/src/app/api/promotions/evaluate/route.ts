import { NextRequest, NextResponse } from 'next/server';
import { evaluateCart, type CartContext, type CartLine } from '@/lib/promotions';

// POST /api/promotions/evaluate
// Body: { brand_id, lines: [...], member_id?, outlet_id?, member_tier_id?, promo_code?, reward_promotion_ids? }
// Public — used by POS / pickup app at checkout to compute the discount stack.
//
// Returns the evaluated cart with subtotal, applied discounts, total saved,
// and final total. Does NOT record the promotion as used — call /apply
// after the order is committed for that.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.brand_id || !Array.isArray(body.lines)) {
      return NextResponse.json(
        { error: 'brand_id and lines are required' },
        { status: 400 }
      );
    }

    const lines = body.lines as CartLine[];
    for (const l of lines) {
      if (
        typeof l.product_id !== 'string' ||
        typeof l.quantity !== 'number' ||
        typeof l.unit_price !== 'number' ||
        l.quantity <= 0 ||
        l.unit_price < 0
      ) {
        return NextResponse.json({ error: 'invalid line' }, { status: 400 });
      }
    }

    const ctx: CartContext = {
      brand_id: body.brand_id,
      member_id: body.member_id ?? null,
      outlet_id: body.outlet_id ?? null,
      member_tier_id: body.member_tier_id ?? null,
      promo_code: body.promo_code ?? null,
      reward_promotion_ids: body.reward_promotion_ids ?? [],
    };

    const result = await evaluateCart(lines, ctx);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
