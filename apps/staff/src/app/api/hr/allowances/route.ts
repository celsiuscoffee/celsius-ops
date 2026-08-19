import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { computeAllowances } from "@/lib/hr/allowances";
import { getMYTToday } from "@/lib/hr/constants";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Month from MYT, not UTC — on the 1st before 08:00 MYT a UTC "now" is still
  // last month, so the allowance card would show the wrong month.
  const [y, m] = getMYTToday().split("-").map(Number);
  const breakdown = await computeAllowances(session.id, y, m);
  return NextResponse.json({ breakdown });
}
