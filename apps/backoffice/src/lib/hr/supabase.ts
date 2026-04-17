import { createSupabaseClient, createSupabaseAdmin } from "@celsius/shared";

// All Celsius apps share the same Supabase project (kqdcdhpnyuwrxqhbuyfl).
// In Vercel env, the loyalty-prefixed vars are the ones actually configured.
// Fall back generic → loyalty → empty.
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_LOYALTY_SUPABASE_URL ||
  "";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_LOYALTY_SUPABASE_ANON_KEY ||
  "";
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.LOYALTY_SUPABASE_SERVICE_ROLE_KEY ||
  "";

export const hrSupabase = createSupabaseClient(supabaseUrl, supabaseAnonKey);

export const hrSupabaseAdmin = createSupabaseAdmin(
  supabaseUrl,
  supabaseServiceKey,
  supabaseAnonKey,
);
