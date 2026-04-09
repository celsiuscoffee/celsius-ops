import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Return session directly — no DB query needed for basic auth check
  return NextResponse.json(session, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
