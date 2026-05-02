import { createClient, SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;

// Service-role Supabase client for the finance module. Bypasses RLS — only
// use server-side. All fin_* table writes go through this client so the
// audit trigger captures the actor we set.
export function getFinanceClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_LOYALTY_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.LOYALTY_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars missing for finance module");
  cachedClient = createClient(url, key, { auth: { persistSession: false } });
  return cachedClient;
}

// Sets the audit actor for the current Postgres session. Every fin_* write
// must run after this so fin_audit_log.actor is populated correctly.
//
// For agents: pass the agent name + version, e.g. "matcher-v1".
// For human edits via the inbox: pass the User.id.
export async function setActor(client: SupabaseClient, actor: string): Promise<void> {
  // Supabase JS doesn't expose set_config directly; use rpc with a helper or
  // raw SQL via PostgREST. We expose a tiny SQL function for this in the
  // migration; until that's added, callers should use a transaction wrapper.
  const { error } = await client.rpc("fin_set_actor", { p_actor: actor });
  if (error && error.code !== "42883") {
    // 42883 = function does not exist; first deploy may not have it yet.
    throw error;
  }
}
