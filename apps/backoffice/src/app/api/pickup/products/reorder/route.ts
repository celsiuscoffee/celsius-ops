import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth } from "@/lib/auth";

// POST /api/pickup/products/reorder
// Body: { ids: string[], field?: "position" | "featured_position" }
// Assigns positions 1..N to the listed product ids in the given order.
// Use `field: "featured_position"` to reorder the Best Sellers list
// independently of per-category position.
//
// Products NOT in the list are untouched — for category reorders, the
// caller passes only that category's products; for Best Sellers, only
// the featured ones. We never want to clobber unrelated rows.
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const body = await request.json() as { ids?: unknown; field?: unknown };
  if (!Array.isArray(body.ids) || body.ids.some((x) => typeof x !== "string")) {
    return NextResponse.json({ error: "ids must be an array of strings" }, { status: 400 });
  }
  const field = body.field === "featured_position" ? "featured_position" : "position";
  const ids = body.ids as string[];

  const supabase = getSupabaseAdmin();
  const updates = ids.map((id, i) =>
    supabase.from("products").update({ [field]: i + 1 }).eq("id", id)
  );
  const results = await Promise.all(updates);
  const firstError = results.find((r) => (r as { error?: unknown }).error);
  if (firstError) {
    return NextResponse.json(
      { error: (firstError as { error: { message: string } }).error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, count: ids.length, field });
}
