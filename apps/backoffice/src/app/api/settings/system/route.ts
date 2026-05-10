import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

// GET /api/settings/system — system settings (PIN length is fixed at 6)
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  return NextResponse.json({ id: "default", pinLength: 6 });
}
