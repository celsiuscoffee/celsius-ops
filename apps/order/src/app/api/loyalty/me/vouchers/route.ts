// GET /api/loyalty/me/vouchers — caller's voucher wallet (active only).
//
// Thin wrapper around the canonical fetchActiveVouchersForMember
// helper in @celsius/shared. The same helper powers POS's wallet
// query so both surfaces always read identical data.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { resolveMember } from "@/lib/loyalty/v2-auth";
import { fetchActiveVouchersForMember } from "@celsius/shared";

export async function GET(req: NextRequest) {
  const r = await resolveMember(req);
  if (r.error) return r.error as unknown as NextResponse;

  try {
    const vouchers = await fetchActiveVouchersForMember({
      supabase: getSupabaseAdmin(),
      memberId: r.member.memberId,
    });
    return NextResponse.json(vouchers);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
