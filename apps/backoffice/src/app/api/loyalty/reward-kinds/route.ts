import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/loyalty/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/loyalty/reward-kinds
 *
 * Lists the five fundamental reward shapes the engagement engine
 * understands (voucher / bean_multiplier / flat_beans / no_bonus /
 * surprise_in_store). The `id` values are stable enum-like strings
 * referenced by the mission/mystery/birthday handlers in code — only
 * the label / description / active flag / sort_order are
 * admin-editable here.
 */
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("reward_kinds")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PUT /api/loyalty/reward-kinds
 * Body: { id: string, label?: string, description?: string,
 *         category?: string, sort_order?: number, is_active?: boolean }
 *
 * The id field is the primary key and is NOT editable — renaming it
 * would orphan rows in mystery_pool / mission completions that
 * reference the old value.
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const body = (await request.json()) as Record<string, unknown>;
    const id = body.id as string | undefined;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const allowedKeys = ["label", "description", "category", "sort_order", "is_active", "color", "illustration_url"];
    const updates: Record<string, unknown> = {};
    for (const key of allowedKeys) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No editable fields supplied" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("reward_kinds")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
