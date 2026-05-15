import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/loyalty/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * PATCH /api/loyalty/push-campaigns/[key]
 *
 * Updates the editable fields on a single campaign — primarily the
 * on/off toggle, but also the frequency cap, send window, and any
 * trigger_config tweaks an admin wants to make without a deploy.
 *
 * Why scoped to whitelisted fields rather than a generic merge:
 * trigger_config is free-form jsonb but the cron branches read
 * specific keys; letting the API write arbitrary structure would
 * silently break sweeps. Each branch is responsible for documenting
 * what keys it reads (see loyalty-pushes/route.ts comments).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const { key } = await params;
    const body = await request.json();

    const updates: Record<string, unknown> = {};
    if (typeof body.enabled === "boolean") updates.enabled = body.enabled;
    if (typeof body.frequency_cap_count === "number" && body.frequency_cap_count >= 0) {
      updates.frequency_cap_count = body.frequency_cap_count;
    }
    if (typeof body.frequency_cap_days === "number" && body.frequency_cap_days >= 0) {
      updates.frequency_cap_days = body.frequency_cap_days;
    }
    if (typeof body.send_window_start_hour === "number" && body.send_window_start_hour >= 0 && body.send_window_start_hour < 24) {
      updates.send_window_start_hour = body.send_window_start_hour;
    }
    if (typeof body.send_window_end_hour === "number" && body.send_window_end_hour > 0 && body.send_window_end_hour <= 24) {
      updates.send_window_end_hour = body.send_window_end_hour;
    }
    if (body.trigger_config && typeof body.trigger_config === "object" && !Array.isArray(body.trigger_config)) {
      updates.trigger_config = body.trigger_config;
    }
    if (typeof body.name === "string" && body.name.trim().length > 0) {
      updates.name = body.name.trim();
    }
    if (typeof body.description === "string") {
      updates.description = body.description;
    }
    // Phase 2 — admin-editable copy. Empty string clears back to
    // "use default" (renderer reads NULL as "fall back to legacy
    // notify*"). Trim trailing whitespace so a paste-with-newline
    // doesn't quietly produce a notification with a hanging blank.
    if (typeof body.title_template === "string") {
      const trimmed = body.title_template.trim();
      updates.title_template = trimmed.length > 0 ? trimmed : null;
    }
    if (typeof body.body_template === "string") {
      const trimmed = body.body_template.trim();
      updates.body_template = trimmed.length > 0 ? trimmed : null;
    }
    if (typeof body.deeplink_path === "string") {
      const trimmed = body.deeplink_path.trim();
      updates.deeplink_path = trimmed.length > 0 ? trimmed : null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No editable fields supplied" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("notification_campaigns")
      .update(updates)
      .eq("key", key)
      .select()
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    console.error("[push-campaigns PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
