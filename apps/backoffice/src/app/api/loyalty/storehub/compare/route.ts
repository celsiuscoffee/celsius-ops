import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  return NextResponse.json({
    outlets: [],
    totals: { storehub_orders: 0, loyalty_claims: 0, claim_rate: 0 },
  });
}
