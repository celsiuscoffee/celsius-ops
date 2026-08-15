import { createClient, SupabaseClient } from "@supabase/supabase-js";

// One cached client per actor: the actor rides on every PostgREST request as
// the `x-fin-actor` header, which fin_audit() reads inside the same
// transaction as the write (migration 095). This replaces the old
// fin_set_actor() rpc dance, which set a transaction-local GUC in its OWN
// request and therefore never survived to the write — every audit row said
// 'system'. Keyed cache so hot paths don't rebuild clients per call.
const clientsByActor = new Map<string, SupabaseClient>();

// Service-role Supabase client for the finance module. Bypasses RLS — only
// use server-side. Pass the acting agent or user so every fin_* write is
// attributed in fin_audit_log:
//   - agents:      name + version, e.g. getFinanceClient("categorizer-v1")
//   - human edits: the User.id from requireAuth
// Omitting the actor is allowed for READ paths; writes through an actorless
// client audit as 'system', which the warehouse check suite flags.
export function getFinanceClient(actor?: string): SupabaseClient {
  const cacheKey = actor ?? "";
  const cached = clientsByActor.get(cacheKey);
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_LOYALTY_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.LOYALTY_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars missing for finance module");
  const client = createClient(url, key, {
    auth: { persistSession: false },
    ...(actor ? { global: { headers: { "x-fin-actor": actor } } } : {}),
  });
  clientsByActor.set(cacheKey, client);
  return client;
}
