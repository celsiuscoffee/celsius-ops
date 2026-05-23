import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth } from "@/lib/auth";

// POST /api/pickup/splash-posters/reorder
// body: { orderedIds: string[] }
//
// Writes a fresh sort_order for the given posters by their position in
// the array (10, 20, 30, ...) so insertions can slot in between later
// without rewriting everything. Single transaction in spirit — we run
// the updates as a parallel batch; any failure surfaces immediately.
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  const orderedIds: unknown = body?.orderedIds;
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return NextResponse.json(
      { error: "orderedIds (string[]) required" },
      { status: 400 },
    );
  }
  if (!orderedIds.every((v) => typeof v === "string" && v.length > 0)) {
    return NextResponse.json(
      { error: "orderedIds must be non-empty strings" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();

  // Step in increments of 10 so the operator can later drop a new poster
  // between two adjacent positions without bumping the whole list.
  const updates = (orderedIds as string[]).map((id, idx) =>
    supabase
      .from("splash_posters")
      .update({ sort_order: (idx + 1) * 10 } as Record<string, unknown>)
      .eq("id", id),
  );

  const results = await Promise.all(updates);
  const firstError = results.find((r) => r.error)?.error;
  if (firstError) {
    return NextResponse.json({ error: firstError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
