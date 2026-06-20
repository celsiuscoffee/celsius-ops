// Thin back-compat shim. The promotion engine now lives in @celsius/shared
// (packages/shared/src/loyalty/promo-engine.ts) so every surface — POS,
// pickup/order checkout, and this app's own API routes — runs the identical
// discount maths in-process against the shared Supabase, instead of proxying
// to loyalty.celsiuscoffee.com.
//
// This module binds the loyalty app's own service-role client to the shared
// functions and re-exports them under their original names + signatures, so
// the /api/promotions/{evaluate,apply} routes (and any old deployed build of
// them) keep working unchanged.

import { supabaseAdmin } from "@/lib/supabase";
import {
  evaluateCart as evaluateCartShared,
  recordApplications as recordApplicationsShared,
  type CartLine as SharedCartLine,
  type CartContext as SharedCartContext,
  type EvaluatedCart as SharedEvaluatedCart,
  type AppliedDiscount as SharedAppliedDiscount,
  type Promotion as SharedPromotion,
} from "@celsius/shared/src/loyalty/promo-engine";

export type CartLine = SharedCartLine;
export type CartContext = SharedCartContext;
export type EvaluatedCart = SharedEvaluatedCart;
export type AppliedDiscount = SharedAppliedDiscount;
export type Promotion = SharedPromotion;

/** Evaluate the discount stack against a cart. Same signature as before the
 *  engine moved to @celsius/shared — binds this app's supabaseAdmin. */
export function evaluateCart(lines: CartLine[], ctx: CartContext): Promise<EvaluatedCart> {
  return evaluateCartShared(supabaseAdmin, lines, ctx);
}

/** Record applied promotions to the ledger + bump uses_count. */
export function recordApplications(args: {
  evaluated: EvaluatedCart;
  brand_id: string;
  member_id?: string | null;
  outlet_id?: string | null;
  reference_id: string;
}): Promise<void> {
  return recordApplicationsShared(supabaseAdmin, args);
}
