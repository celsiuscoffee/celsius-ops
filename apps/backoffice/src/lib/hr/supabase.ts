import { createSupabaseClient, createSupabaseAdmin } from "@celsius/shared";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const hrSupabase = createSupabaseClient(supabaseUrl, supabaseAnonKey);

export const hrSupabaseAdmin = createSupabaseAdmin(
  supabaseUrl,
  supabaseServiceKey,
  supabaseAnonKey,
);
