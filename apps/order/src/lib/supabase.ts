import { createSupabaseClient, createSupabaseAdmin } from "@celsius/shared";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Browser client (for client components) -- uses anon key
export const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey);

// Server/admin client (for API routes) -- uses service role key for full access
export const supabaseAdmin = createSupabaseAdmin(
  supabaseUrl,
  supabaseServiceKey,
  supabaseAnonKey,
);
