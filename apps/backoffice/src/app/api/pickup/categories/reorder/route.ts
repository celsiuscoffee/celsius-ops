import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth } from "@/lib/auth";

// POST /api/pickup/categories/reorder
// Body: { ids: string[] } — assigns positions 1..N in the given order.
// Categories NOT in the list keep their existing position (e.g. hidden
// categories that the admin UI doesn't show stay parked at the end).
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const body = await request.json() as { ids?: unknown };
  if (!Array.isArray(body.ids) || body.ids.some((x) => typeof x !== "string")) {
    return NextResponse.json({ error: "ids must be an array of strings" }, { status: 400 });
  }
  const ids = body.ids as string[];

  const supabase = getSupabaseAdmin();

  // Park unlisted categories above the listed ones by giving the listed
  // ones a high base (1000+). Then in a second pass, give listed ones
  // positions 1..N and unlisted ones N+1..N+M (preserving their relative
  // order). Single-pass approach risks position collisions during the
  // update if positions overlap.
  const { data: existing, error: fetchErr } = await supabase
    .from("categories")
    .select("id, position")
    .order("position");
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  const listedSet = new Set(ids);
  const unlisted = (existing ?? [])
    .filter((c) => !listedSet.has(c.id as string))
    .map((c) => c.id as string);

  // categories.position has no unique constraint in our schema, so we
  // can directly write final values without a two-phase update.
  const updates = [
    ...ids.map((id, i) =>
      supabase.from("categories").update({ position: i + 1 }).eq("id", id)
    ),
    ...unlisted.map((id, i) =>
      supabase.from("categories").update({ position: ids.length + 1 + i }).eq("id", id)
    ),
  ];

  const results = await Promise.all(updates);
  const firstError = results.find((r) => (r as { error?: unknown }).error);
  if (firstError) {
    return NextResponse.json(
      { error: (firstError as { error: { message: string } }).error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, count: ids.length });
}
