import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Singleton browser client — avoids duplicate WebSocket connections
let _client: ReturnType<typeof createClient<Database>> | null = null;

export function getSupabaseClient() {
  if (!_client) {
    _client = createClient<Database>(url, anon);
  }
  return _client;
}
