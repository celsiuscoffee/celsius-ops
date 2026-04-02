import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";

// GET - check current session from JWT cookie
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({ user });
}
