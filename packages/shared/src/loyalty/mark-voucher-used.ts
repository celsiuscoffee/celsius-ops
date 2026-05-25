// Shared, canonical "mark voucher used" write — single source of
// truth used by BOTH apps/order (Pickup) and apps/pos. Replaces three
// near-duplicate UPDATE statements that had drifted:
//
//   1. apps/pos /api/loyalty/mark-used         — sets status + redeemed_at,
//                                                filters by id + member_id
//                                                + brand_id + status='active'
//                                                (idempotent — re-calls no-op)
//   2. apps/order lib/loyalty/v2.ts            — sets status + redeemed_at,
//                                                filters by id + member_id ONLY
//                                                (could double-stamp redeemed_at
//                                                if called twice)
//   3. apps/order lib/loyalty/points.ts        — sets status ONLY, filters by id
//                                                (loses redeemed_at timestamp)
//
// The canonical behaviour matches POS's idempotent guard: only flip
// rows that are currently active, always stamp redeemed_at, optionally
// scope to member_id + brand_id for defensive correctness.

import type { SupabaseClient } from "@supabase/supabase-js";

export type MarkVoucherUsedResult =
  | { ok: true; alreadyUsed: false; voucherId: string }
  // No row matched — either the voucher was already used / expired,
  // or the (member_id, brand_id) scoping rejected it. Treat as a
  // benign no-op so the caller can stay idempotent.
  | { ok: true; alreadyUsed: true; voucherId: string }
  | { ok: false; error: string };

/** Flip an active wallet voucher to status='used' and stamp
 *  redeemed_at = now. Idempotent — calling this on an already-used
 *  voucher returns alreadyUsed:true without erroring, so payment
 *  retries don't blow up the order completion path.
 *
 *  Optional scoping via memberId / brandId — POS passes both,
 *  Pickup checkout passes just memberId. Both are recommended for
 *  defence-in-depth (a stale walletVoucherId can't burn someone
 *  else's voucher even if the route auth is bypassed). */
export async function markVoucherUsed(args: {
  supabase: SupabaseClient;
  voucherId: string;
  memberId?: string;
  brandId?: string;
}): Promise<MarkVoucherUsedResult> {
  let q = args.supabase
    .from("issued_rewards")
    .update({
      status: "used",
      redeemed_at: new Date().toISOString(),
    })
    .eq("id", args.voucherId)
    .eq("status", "active");

  if (args.memberId) q = q.eq("member_id", args.memberId);
  if (args.brandId)  q = q.eq("brand_id",  args.brandId);

  const { data, error } = await q.select("id").maybeSingle();
  if (error) {
    return { ok: false, error: error.message };
  }
  return data
    ? { ok: true, alreadyUsed: false, voucherId: args.voucherId }
    : { ok: true, alreadyUsed: true,  voucherId: args.voucherId };
}
