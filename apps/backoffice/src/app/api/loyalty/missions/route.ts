import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/loyalty/supabase";
import { requireAuth } from "@/lib/auth";

// GET /api/loyalty/missions?brand_id=X
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const brandId = new URL(request.url).searchParams.get("brand_id");
  if (!brandId) return NextResponse.json({ error: "brand_id is required" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("reward_missions")
    .select("*")
    .eq("brand_id", brandId)
    .order("difficulty", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach each mission's cash-loop verdict (net cash vs baseline − reward cost),
  // computed by runMissionLoop and stored in app_settings.mission_loop_stats.
  const { data: statsRow } = await supabaseAdmin
    .from("app_settings").select("value").eq("key", "mission_loop_stats").maybeSingle();
  const stats = (statsRow?.value ?? {}) as Record<string, { net_cash_rm: number; incremental_rm: number; reward_cost_rm: number; completers_measured: number; verdict: string; retired?: boolean }>;
  const withStats = (data ?? []).map((m) => ({ ...m, cash: stats[m.id] ?? null }));
  return NextResponse.json(withStats);
}

// POST /api/loyalty/missions — create
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const body = await request.json();
  const {
    brand_id, title, description, icon, difficulty, goal,
    reward_voucher_template_ids = [],
    referee_reward_voucher_template_ids = [],
    reward_bonus_beans = 0,
    cooldown_weeks = 4, is_active = true, starts_at, ends_at,
  } = body;

  if (!brand_id || !title || !description || !difficulty || !goal) {
    return NextResponse.json({ error: "missing required fields" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("reward_missions")
    .insert({
      brand_id, title, description,
      icon: icon ?? "sparkle",
      difficulty, goal,
      reward_voucher_template_ids,
      referee_reward_voucher_template_ids,
      reward_bonus_beans,
      cooldown_weeks, is_active, starts_at, ends_at,
      created_by: auth.user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

// PUT /api/loyalty/missions — update
export async function PUT(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const body = await request.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("reward_missions")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE /api/loyalty/missions?id=X
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("reward_missions")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
