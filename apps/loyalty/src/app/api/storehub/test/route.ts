import { NextRequest, NextResponse } from "next/server";
import { testConnection } from "@/lib/storehub";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/storehub/test
 * Test the StoreHub API connection
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const result = await testConnection();
  return NextResponse.json(result);
}
