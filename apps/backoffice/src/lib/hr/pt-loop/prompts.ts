// PT-loop prompt ledger (hr_wa_prompts) — one row per outbound WhatsApp prompt
// and its eventual reply. Gives the cron idempotency (never double-ping the
// same person for the same week/kind), the webhook a way to know WHAT an
// inbound reply answers, and the owner an audit trail. Design:
// docs/design/pt-loop.md.

import { hrSupabaseAdmin } from "@/lib/hr/supabase";

export type PromptKind = "availability" | "roster_ack" | "open_shift" | "no_show" | "digest";

export type WaPrompt = {
  id: string;
  user_id: string;
  kind: PromptKind;
  ref_id: string | null;
  week_start: string | null;
  wamid: string | null;
  payload: Record<string, unknown>;
  sent_at: string;
  responded_at: string | null;
  response: Record<string, unknown> | null;
};

export async function recordPrompt(input: {
  userId: string;
  kind: PromptKind;
  refId?: string | null;
  weekStart?: string | null;
  wamid?: string | null;
  payload?: Record<string, unknown>;
}): Promise<string | null> {
  const { data, error } = await hrSupabaseAdmin
    .from("hr_wa_prompts")
    .insert({
      user_id: input.userId,
      kind: input.kind,
      ref_id: input.refId ?? null,
      week_start: input.weekStart ?? null,
      wamid: input.wamid ?? null,
      payload: input.payload ?? {},
    })
    .select("id")
    .single();
  if (error) {
    console.error("[pt-loop] recordPrompt failed:", error.message);
    return null;
  }
  return data.id as string;
}

// Has this user already been prompted for (kind, week)? — cron idempotency.
export async function alreadyPrompted(userId: string, kind: PromptKind, weekStart: string): Promise<boolean> {
  const { data } = await hrSupabaseAdmin
    .from("hr_wa_prompts")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("week_start", weekStart)
    .limit(1);
  return (data ?? []).length > 0;
}

// The newest unanswered prompt for a user — what an inbound free-text reply is
// answering. Open-shift claims are matched by code instead (reply "TAKE n"),
// so they don't need to be the latest prompt.
export async function latestOpenPrompt(userId: string): Promise<WaPrompt | null> {
  const { data } = await hrSupabaseAdmin
    .from("hr_wa_prompts")
    .select("*")
    .eq("user_id", userId)
    .is("responded_at", null)
    .in("kind", ["availability", "roster_ack", "no_show"])
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as WaPrompt | null) ?? null;
}

export async function markResponded(promptId: string, response: Record<string, unknown>): Promise<void> {
  const { error } = await hrSupabaseAdmin
    .from("hr_wa_prompts")
    .update({ responded_at: new Date().toISOString(), response })
    .eq("id", promptId);
  if (error) console.error("[pt-loop] markResponded failed:", error.message);
}
